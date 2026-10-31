import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { Engine, Representation, SourceDocument, TaskContext } from '@safehandoff/core-interface';
import { TaskStore, TaskStoreError } from './task-store.ts';
import type { DecisionInput } from './task-store.ts';
import { deny, WorkflowHTTPError, WorkflowSessions } from './workflow-session.ts';
import type { WorkflowAccess } from './workflow-session.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) deny(400, 'INVALID_TASK_INPUT');
  const v = value as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => ![...required, ...optional].includes(k))) deny(400, 'INVALID_TASK_INPUT');
  return v;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) deny(400, 'INVALID_TASK_INPUT'); return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) deny(400, 'INVALID_TASK_INPUT'); return value;
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') deny(415, 'JSON_REQUIRED');
  let size = 0; const buffers: Buffer[] = [];
  for await (const chunk of request) {
    const b = Buffer.from(chunk); size += b.length; if (size <= 1536 * 1024) buffers.push(b);
  }
  if (size > 1536 * 1024) deny(413, 'BODY_TOO_LARGE');
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); } catch { return deny(400, 'INVALID_TASK_INPUT'); }
}
function send(response: ServerResponse, status: number, data: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
function aggregate(store: TaskStore, id: string) {
  const task = store.get(id), candidates = store.analysis.candidates(id);
  const decisions = Object.fromEntries(store.decisions(id).map(d => {
    const preview = d.preview_id ? store.getPreview(id, d.preview_id) : null;
    return [d.candidate_id, { ...d, representation: preview?.representation ?? { kind: 'fact_summary', transform_id: '', parameters: {} },
      projection_sha256: preview?.projection_sha256 ?? '', revoked: d.revoked_at !== null }];
  }));
  return { ...task, sources: store.analysis.sources(id), evidence: store.analysis.evidence(id),
    candidates: candidates.map(c => ({ ...c, required: c.relevance === 'required', conflict_group: c.conflicts[0]?.id ?? '',
      conflict_reason: c.conflicts.map(g => g.reason).join('\n') })), decisions,
    scope: { project_id: id, purpose_id: hash(task.context.purpose), recipient_id: hash(task.context.recipient),
      audience: 'named_external', skill_set_hash: task.skill_set_hash } };
}
function fieldList(store: TaskStore, id: string, candidateId: string) {
  const candidate = store.analysis.candidates(id).find(c => c.id === candidateId);
  if (!candidate) deny(400, 'INVALID_CANDIDATE');
  const evidence = store.analysis.evidence(id).filter(e => candidate.evidence_ids.includes(e.id)).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!evidence.length || evidence.length !== candidate.evidence_ids.length || new Set(evidence.map(e => e.source_version_id)).size !== 1) deny(422, 'UNSUPPORTED_FIELDS');
  const source = store.analysis.sources(id).find(s => s.id === evidence[0]!.source_version_id)!;
  if (!['csv', 'json'].includes(source.format) || evidence.some(e => e.locator.kind !== (source.format === 'csv' ? 'csv_cell' : 'json_pointer'))) deny(422, 'UNSUPPORTED_FIELDS');
  return { candidate_id: candidateId, input_revision: store.get(id).revision, source_version_id: source.id,
    fields: [...new Set(evidence.map(e => source.format === 'csv' ? e.locator.column! : e.locator.pointer!))], reusable: false };
}

export function createWorkflowHandler(store: TaskStore, engine: Engine, access: WorkflowAccess) {
  store.recoverJobs();
  const environment = { provider_origin: access.analysisProviderOrigin ?? null,
    approval_status: 'operator_confirmation_required', verified_at: null };
  const sessionData = (data: unknown) => ({ ...(data as Record<string, unknown>), analysis_environment: environment,
    capabilities: { tasks: true, selected_fields: true, reusable_rules: false, approved_excerpt: false } });
  const sessions = new WorkflowSessions(access), controllers = new Map<string, AbortController>(), pending = new Set<Promise<void>>();
  const launch = (jobId: string, work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController(); controllers.set(jobId, controller);
    const promise = work(controller.signal).catch(() => {}).finally(() => { controllers.delete(jobId); pending.delete(promise); });
    pending.add(promise);
  };
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      const parts = path.split('/').slice(3).map(decodeURIComponent), write = request.method !== 'GET';
      if (parts.join('/') === 'session') {
        if (request.method === 'POST') {
          sessions.checkBoundary(request, true);
          const input = object(await body(request), ['token']); send(response, 200, { data: sessionData(sessions.open(request, response, input.token)) }); return;
        }
        if (request.method === 'GET') { send(response, 200, { data: sessionData(sessions.require(request, false)) }); return; }
        deny(405, 'METHOD_NOT_ALLOWED');
      }
      sessions.require(request, write);
      if (request.method === 'GET') {
        if (parts.length === 2 && parts[0] === 'tasks') send(response, 200, { data: aggregate(store, parts[1]!) });
        else if (parts.length === 4 && parts[0] === 'tasks' && parts[2] === 'jobs') {
          const { snapshot: _snapshot, ...job } = store.analysis.job(parts[1]!, parts[3]!);
          send(response, 200, { data: { ...job, kind: 'analyze', input_revision: job.revision } });
        } else if (parts.length === 5 && parts[0] === 'tasks' && parts[2] === 'candidates' && parts[4] === 'fields') {
          send(response, 200, { data: fieldList(store, parts[1]!, parts[3]!) });
        } else if (parts.length === 2 && parts[0] === 'jobs') send(response, 200, { data: store.disclosureJob(parts[1]!) });
        else deny(404, 'ENDPOINT_NOT_FOUND');
        return;
      }
      const key = string(request.headers['idempotency-key']);
      if (key.length > 200) deny(400, 'INVALID_IDEMPOTENCY_KEY');
      const input = await body(request);
      if (request.method === 'POST' && parts.join('/') === 'tasks') {
        const v = object(input, ['context']);
        object(v.context, ['purpose', 'recipient'], ['goal_variant', 'output_language']);
        const result = store.request('create-task', key, input, () => store.create(v.context as unknown as TaskContext, hash('[]'), hash('[]')));
        send(response, 201, { data: result.result }); return;
      }
      if (parts[0] !== 'tasks' || parts.length < 2) deny(404, 'ENDPOINT_NOT_FOUND');
      const id = parts[1]!, action = parts.slice(2).join('/');
      // Only known endpoints can consume a mutation key.
      const operation = `${request.method}:${id}:${action}`;
      if (request.method === 'DELETE' && !action) {
        const v = object(input, ['expected_revision']);
        const result = store.request(operation, key, input, () => { store.delete(id, revision(v.expected_revision)); return { id, deleted: true }; });
        send(response, 200, { data: result.result }); return;
      }
      if (request.method === 'PUT' && action === 'sources') {
        const v = object(input, ['expected_revision', 'sources']);
        const result = store.request(operation, key, input, () => store.analysis.replaceSources(id, revision(v.expected_revision), v.sources as SourceDocument[]));
        send(response, 200, { data: result.result }); return;
      }
      if (request.method !== 'POST') deny(405, 'METHOD_NOT_ALLOWED');
      if (action === 'manual-candidates') {
        const v = object(input, ['expected_revision', 'candidate'], ['evidence_ids', 'user_note']);
        const { expected_revision, ...manual } = v;
        const result = store.request(operation, key, input, () => store.analysis.addManual(id, revision(expected_revision), manual as never));
        send(response, 201, { data: result.result }); return;
      }
      if (action === 'jobs') {
        const v = object(input, ['expected_revision', 'kind'], ['arguments']);
        const rev = revision(v.expected_revision);
        if (pending.size >= 4 && !store.replay(operation, key, input)) deny(429, 'JOB_LIMIT');
        if (v.kind === 'analyze') {
          if (v.arguments !== undefined) object(v.arguments, []);
          const result = store.request(operation, key, input, () => {
            const job = store.analysis.start(id, rev); const { snapshot: _snapshot, ...summary } = job; return summary;
          });
          if (!result.replayed) launch(result.result.id, async signal => {
            const job = store.analysis.job(id, result.result.id);
            try {
              const value = await engine.analyze({ task: job.snapshot.task, sources: job.snapshot.sources }, { signal });
              if (signal.aborted) { store.analysis.cancel(id, job.id); return; }
              store.analysis.complete(id, job.id, value);
            } catch (error) { store.analysis.fail(id, job.id, error instanceof CoreError || error instanceof ModelError ? error.code : 'ANALYSIS_FAILED'); }
          });
          send(response, 202, { data: { ...result.result, kind: 'analyze', input_revision: result.result.revision } }); return;
        }
        if (v.kind !== 'interpret_disclosure') deny(422, 'FEATURE_NOT_IMPLEMENTED');
        const args = object(v.arguments, ['candidate_id', 'text']), candidateId = string(args.candidate_id), condition = string(args.text);
        const result = store.request(operation, key, input, () => {
          store.assertRevision(id, rev);
          if (!store.analysis.candidates(id).some(c => c.id === candidateId)) deny(400, 'INVALID_CANDIDATE');
          return { id: store.createDisclosureJob(id, rev) };
        });
        if (!result.replayed) launch(result.result.id, async signal => {
          try {
            const task = store.assertRevision(id, rev), c = store.analysis.candidates(id).find(c => c.id === candidateId)!;
            const proposal = await engine.proposeDisclosure({ ...c, local_key: c.id }, task.context, { condition, signal });
            store.finishDisclosureJob(result.result.id, proposal, null);
          } catch (error) { store.finishDisclosureJob(result.result.id, null, error instanceof CoreError || error instanceof ModelError ? error.code : 'DISCLOSURE_FAILED'); }
        });
        send(response, 202, { data: store.disclosureJob(result.result.id) }); return;
      }
      if (parts.length === 5 && parts[2] === 'jobs' && parts[4] === 'cancel') {
        const v = object(input, ['expected_revision']);
        const result = store.request(operation, key, input, () => { store.assertRevision(id, revision(v.expected_revision));
          store.analysis.job(id, parts[3]!);
          const cancelled = store.analysis.cancel(id, parts[3]!);
          if (cancelled) controllers.get(parts[3]!)?.abort();
          return { cancelled }; });
        send(response, 200, { data: result.result }); return;
      }
      if (action === 'disclosure-previews') {
        const v = object(input, ['expected_revision', 'candidate_id', 'representation']);
        const rev = revision(v.expected_revision), candidateId = string(v.candidate_id);
        const previous = store.replay(operation, key, input);
        if (previous) { send(response, 200, { data: previous.result }); return; }
        store.assertRevision(id, rev);
        // Calculation is pure, and the transaction rechecks revision before storing it.
        const c = store.analysis.candidates(id).find(c => c.id === candidateId);
        if (!c) deny(400, 'INVALID_CANDIDATE');
        const preview = await engine.preview({ ...c, local_key: c.id }, v.representation as Representation, rev,
          { sources: store.analysis.sources(id), evidence: store.analysis.evidence(id) });
        const result = store.request(operation, key, input, () => store.storePreview(id, rev, preview));
        send(response, 200, { data: result.result }); return;
      }
      if (action === 'decision-batches') {
        const v = object(input, ['expected_revision', 'operations', 'accept_scope_reduction']);
        if (typeof v.accept_scope_reduction !== 'boolean' || !Array.isArray(v.operations) || !v.operations.length || v.operations.length > 100) deny(400, 'INVALID_DECISION');
        const rev = revision(v.expected_revision);
        const result = store.request(operation, key, input, () => {
          store.assertRevision(id, rev);
          const inputs: DecisionInput[] = (v.operations as unknown[]).map(value => {
            const op = object(value, ['candidate_id', 'disposition'], ['preview_id', 'projection_sha256', 'representation', 'save_reusable_rule', 'expires_at']);
            string(op.candidate_id);
            if (!['allow', 'exclude', 'defer'].includes(String(op.disposition)) || typeof op.disposition !== 'string' ||
              (op.expires_at !== undefined && op.expires_at !== null && typeof op.expires_at !== 'string')) deny(400, 'INVALID_DECISION');
            if (op.save_reusable_rule !== undefined && op.save_reusable_rule !== false) deny(422, 'RULE_REUSE_NOT_IMPLEMENTED');
            if (op.disposition === 'allow') {
              const preview = store.getPreview(id, string(op.preview_id));
              if (preview.candidate_id !== op.candidate_id || JSON.stringify(preview.representation) !== JSON.stringify(op.representation)) deny(400, 'INVALID_DECISION');
            } else if (op.representation !== undefined || op.save_reusable_rule !== undefined) deny(400, 'INVALID_DECISION');
            const { representation: _rep, save_reusable_rule: _rule, ...decision } = op;
            return decision as unknown as DecisionInput;
          });
          const candidates = store.analysis.candidates(id);
          if (!v.accept_scope_reduction && inputs.some(i => i.disposition === 'exclude' && candidates.some(c => c.id === i.candidate_id && c.relevance === 'required'))) deny(400, 'SCOPE_REDUCTION_REQUIRED');
          return store.applyDecisionBatch(id, rev, inputs, key);
        });
        send(response, 200, { data: result.result }); return;
      }
      if (parts.length === 5 && parts[2] === 'decisions' && parts[4] === 'revoke') {
        const v = object(input, ['expected_revision']);
        const result = store.request(operation, key, input, () => store.revoke(id, revision(v.expected_revision), parts[3]!));
        send(response, 200, { data: result.result }); return;
      }
      deny(404, 'ENDPOINT_NOT_FOUND');
    } catch (error) {
      if (error instanceof WorkflowHTTPError) send(response, error.status, { error: error.message });
      else if (error instanceof TaskStoreError) send(response, ['REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error.message) ? 409 :
        ['TASK_NOT_FOUND', 'ANALYSIS_NOT_FOUND'].includes(error.message) ? 404 : 400, { error: error.message });
      else if (error instanceof CoreError || error instanceof ModelError) send(response, error.code === 'INVALID_CORE_INPUT' ? 400 :
        error.code === 'CORE_NOT_IMPLEMENTED' ? 422 : 503, { error: error.code });
      else send(response, 500, { error: 'STORAGE_FAILED' });
    }
  };
  handler.close = async () => { for (const controller of controllers.values()) controller.abort(); await Promise.all(pending); };
  return handler;
}
