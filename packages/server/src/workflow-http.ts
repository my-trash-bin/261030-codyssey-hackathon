import { extendedWorkflowRoutes } from './workflow-routes.ts';
import { object, string, revision, body, send } from './workflow-http-utils.ts';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CoreError, ModelError } from '@safehandoff/core-interface';
import type { Engine, Representation, SourceDocument, TaskContext } from '@safehandoff/core-interface';
import { TaskStore, TaskStoreError } from './task-store.ts';
import type { DecisionInput } from './task-store.ts';
import { deny, WorkflowHTTPError, WorkflowSessions } from './workflow-session.ts';
import type { WorkflowAccess } from './workflow-session.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function aggregate(store: TaskStore, id: string, controllers?: Map<string, AbortController>, jobTasks?: Map<string, string>) {
  const task = store.get(id), candidates = store.analysis.candidates(id);
  const ruleBindings = store.workflow.rules.bindings(id);
  const decisions = Object.fromEntries(store.decisions(id).map(d => {
    const preview = d.preview_id ? store.getPreview(id, d.preview_id) : null;
    const bound = ruleBindings.filter(r => r.decision_id === d.id);
    return [d.candidate_id, { ...d, applied_rule_id: bound[0]?.rule_id ?? '', applied_rule_version: bound[0]?.rule_version ?? 0,
      applied_rule_refs: bound, representation: preview?.representation ?? { kind: 'fact_summary', transform_id: '', parameters: {} },
      projection_sha256: preview?.projection_sha256 ?? '', revoked: d.revoked_at !== null }];
  }));
  const cancelling = [...(jobTasks ?? [])].find(([job, taskId]) => taskId === id && controllers?.get(job)?.signal.aborted);
  return { ...task, sources: store.analysis.sources(id).map(({ raw_bytes: _raw, ...source }) => source), evidence: store.analysis.evidence(id),
    candidates: candidates.map(c => ({ ...c, selector: store.workflow.rules.selector(id, c), required: c.relevance === 'required', conflict_group: c.conflicts[0]?.id ?? '',
      conflict_reason: c.conflicts.map(g => g.reason).join('\n') })), decisions,
    ...store.workflow.status(id), ...(cancelling ? { phase: 'processing', current_job_id: cancelling[0], cancellation_requested: true } : {}), intake: store.workflow.rules.intake(id), scope: store.workflow.rules.scope(id) };
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

// `sessions` defaults to a private instance for callers (tests) that only exercise the
// workflow API; app.ts's legacy routes (/api/sharing, /api/analysis, /api/documents) need the
// *same* instance passed in explicitly so a session opened via POST /api/v1/session also
// covers them -- see app.ts's GUARDED_PATHS and packages/app/src/main.ts.
export function createWorkflowHandler(store: TaskStore, engine: Engine, access: WorkflowAccess, sessions: WorkflowSessions = new WorkflowSessions(access)) {
  store.recoverJobs();
  const environment = { provider_origin: access.analysisProviderOrigin ?? null,
    approval_status: 'operator_confirmation_required', verified_at: null };
  const sessionData = (data: unknown) => ({ ...(data as Record<string, unknown>), analysis_environment: environment,
    capabilities: { tasks: true, selected_fields: true, reusable_rules: true, artifacts: true, exports: true, approved_excerpt: false } });
  const controllers = new Map<string, AbortController>(), deletingTasks = new Set<string>(), streams = new Set<ServerResponse>(), pending = new Set<Promise<void>>(), jobTasks = new Map<string, string>(), jobPromises = new Map<string, Promise<void>>();
  const launch = (jobId: string, taskId: string, work: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController(); controllers.set(jobId, controller); jobTasks.set(jobId, taskId);
    const promise = work(controller.signal).catch(() => {}).finally(() => { controllers.delete(jobId); jobTasks.delete(jobId); jobPromises.delete(jobId); pending.delete(promise); });
    pending.add(promise); jobPromises.set(jobId, promise);
  };
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      const parts = path.split('/').slice(3).map(decodeURIComponent), write = request.method !== 'GET';
      if (parts.join('/') === 'session') {
        if (request.method === 'POST') {
          sessions.checkBoundary(request, true);
          object(await body(request), []); send(response, 200, { data: sessionData(sessions.open(request, response)) }); return;
        }
        if (request.method === 'GET') { send(response, 200, { data: sessionData(sessions.require(request, false)) }); return; }
        if (request.method === 'DELETE') {
          string(request.headers['idempotency-key']); sessions.logout(request, response); send(response, 200, { data: { logged_out: true } }); return;
        }
        deny(405, 'METHOD_NOT_ALLOWED');
      }
      sessions.require(request, write);
      if (await extendedWorkflowRoutes({ store, engine, access, launch, controllers, jobTasks, jobPromises, streams, pending, deletingTasks, authorize: () => { sessions.require(request, false); } }, request, response, parts)) return;
      if (request.method === 'GET') {
        if (parts.length === 2 && parts[0] === 'tasks') send(response, 200, { data: aggregate(store, parts[1]!, controllers, jobTasks) });
        else if (parts.length === 4 && parts[0] === 'tasks' && parts[2] === 'jobs') {
          const { snapshot: _snapshot, ...job } = store.analysis.job(parts[1]!, parts[3]!);
          send(response, 200, { data: { ...job, kind: 'analyze', input_revision: job.revision,
            status: controllers.get(job.id)?.signal.aborted ? 'cancel_requested' : job.status } });
        } else if (parts.length === 5 && parts[0] === 'tasks' && parts[2] === 'candidates' && parts[4] === 'fields') {
          send(response, 200, { data: fieldList(store, parts[1]!, parts[3]!) });
        } else if (parts.length === 2 && parts[0] === 'jobs') {
          try { send(response, 200, { data: store.disclosureJob(parts[1]!) }); }
          catch (error) { if (!(error instanceof TaskStoreError) || error.message !== 'ANALYSIS_NOT_FOUND') throw error;
            const job = store.analysis.summary(parts[1]!); send(response, 200, { data: { ...job, status: controllers.get(job.id)?.signal.aborted ? 'cancel_requested' : job.status } }); }
        }
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
      if (deletingTasks.has(id) && !(request.method === 'DELETE' && !action)) deny(409, 'TASK_DELETING');
      if (request.method === 'DELETE' && !action) {
        const v = object(input, ['expected_revision', 'confirmation', 'acknowledge_saved_rules_retained']);
        if (v.confirmation !== 'DELETE' || v.acknowledge_saved_rules_retained !== true) deny(400, 'DELETE_CONFIRMATION_REQUIRED');
        const replay = store.replay(operation, key, input); if (replay) { send(response, 200, { data: replay.result }); return; }
        store.assertRevision(id, revision(v.expected_revision));
        deletingTasks.add(id);
        try {
        const waits: Promise<void>[] = [];
        for (const [job, task] of jobTasks) if (task === id) {
          controllers.get(job)?.abort(); const promise = jobPromises.get(job); if (promise) waits.push(promise);
        }
        await Promise.all(waits);
        const result = store.request(operation, key, input, () => { store.delete(id, revision(v.expected_revision)); return { id, deleted: true }; });
        send(response, 200, { data: result.result }); return;
        } finally { deletingTasks.delete(id); }
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
          if (!result.replayed) launch(result.result.id, id, async signal => {
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
        if (!result.replayed) launch(result.result.id, id, async signal => {
          try {
            const task = store.assertRevision(id, rev), c = store.analysis.candidates(id).find(c => c.id === candidateId)!;
            const proposal = await engine.proposeDisclosure({ ...c, local_key: c.id }, task.context, { condition, signal });
            store.finishDisclosureJob(result.result.id, signal.aborted ? null : proposal, signal.aborted ? 'CORE_CANCELLED' : null);
          } catch (error) { store.finishDisclosureJob(result.result.id, null, error instanceof CoreError || error instanceof ModelError ? error.code : 'DISCLOSURE_FAILED'); }
        });
        send(response, 202, { data: store.disclosureJob(result.result.id) }); return;
      }
      if (parts.length === 5 && parts[2] === 'jobs' && parts[4] === 'cancel') {
        const v = object(input, ['expected_revision']);
        const result = store.request(operation, key, input, () => { store.assertRevision(id, revision(v.expected_revision));
          let cancelled: boolean;
          try { store.analysis.job(id, parts[3]!); cancelled = store.analysis.cancel(id, parts[3]!); }
          catch (error) { if (!(error instanceof TaskStoreError) || error.message !== 'ANALYSIS_NOT_FOUND') throw error;
            cancelled = store.cancelDisclosureJob(id, parts[3]!); }
          if (cancelled) controllers.get(parts[3]!)?.abort();
          return { cancel_requested: cancelled, job_id: parts[3]! }; });
        send(response, 202, { data: result.result }); return;
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
            if (op.save_reusable_rule !== undefined && typeof op.save_reusable_rule !== 'boolean') deny(400, 'INVALID_DECISION');
            if (op.disposition === 'allow') {
              const preview = store.getPreview(id, string(op.preview_id));
              if (preview.candidate_id !== op.candidate_id || JSON.stringify(preview.representation) !== JSON.stringify(op.representation)) deny(400, 'INVALID_DECISION');
            } else if (op.representation !== undefined || op.save_reusable_rule !== undefined) deny(400, 'INVALID_DECISION');
            const { representation: _rep, save_reusable_rule: _rule, ...decision } = op;
            return decision as unknown as DecisionInput;
          });
          const candidates = store.analysis.candidates(id);
          if (!v.accept_scope_reduction && inputs.some(i => i.disposition === 'exclude' && candidates.some(c => c.id === i.candidate_id && c.relevance === 'required'))) deny(400, 'SCOPE_REDUCTION_REQUIRED');
          const task = store.applyDecisionBatch(id, rev, inputs, key);
          for (const value of v.operations as Record<string, unknown>[]) if (value.save_reusable_rule === true) {
            const decision = store.decisions(id).find(d => d.candidate_id === value.candidate_id)!;
            store.workflow.rules.save(id, task.revision, decision.id);
          }
          return task;
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
  handler.close = async () => { for (const stream of streams) stream.end(); for (const controller of controllers.values()) controller.abort(); await Promise.all(pending); };
  return handler;
}
