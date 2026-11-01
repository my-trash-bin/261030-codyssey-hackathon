import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Draft, Engine, Representation } from '@safehandoff/core-interface';
import type { TaskStore } from './task-store.ts';
import type { WorkflowAccess } from './workflow-session.ts';
import { deny } from './workflow-session.ts';
import { body, object, revision, send, string } from './workflow-http-utils.ts';
import { goals, intakeContext, purposes } from './workflow-catalog.ts';
import { digest } from './artifact-render.ts';
interface Context {
  store: TaskStore; engine: Engine; access: WorkflowAccess;
  launch(id: string, task: string, work: (signal: AbortSignal) => Promise<void>): void;
  authorize(): void;
  deletingTasks: Set<string>;
  streams: Set<ServerResponse>;
  controllers: Map<string, AbortController>; jobTasks: Map<string, string>;
  jobPromises: Map<string, Promise<void>>; pending: Set<Promise<void>>;
}
function binary(response: ServerResponse, bytes: Buffer, mediaType: string, name: string, attachment: boolean): void {
  response.writeHead(200, { 'Content-Type': mediaType, 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${name}"` });
  response.end(bytes);
}
function artifactDTO(value: ReturnType<TaskStore['workflow']['artifacts']['get']>, store: TaskStore) {
  const { pack: _pack, grounding: _grounding, authorization_hash: _authorization, files, ...data } = value;
  return { ...data, files: files.map(({ bytes: _bytes, ...f }) => f), is_current: store.get(value.task_id).revision === value.revision, finalizable: store.workflow.artifacts.canFinalize(value) };
}
export async function extendedWorkflowRoutes(c: Context, request: IncomingMessage, response: ServerResponse, parts: string[]): Promise<boolean> {
  const { store, engine } = c, workflow = store.workflow, artifacts = workflow.artifacts, rules = workflow.rules;
  const path = parts.join('/'), url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'GET') {
    if (path === 'catalog') send(response, 200, { data: { projects: [], recipients: [], purposes,
      goals, skills: [], templates: [{ id: 'support-request.v1', display_name: '문의 문서' }], limits: { sources: 100, source_bytes: 262144, source_total_bytes: 1048576, evidence: 100, export_bytes: 20971520 } } });
    else if (path === 'tasks') send(response, 200, { data: workflow.list(url.searchParams.get('cursor') ?? undefined) });
    else if (parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'sources') send(response, 200, { data: { sources: store.analysis.sourceCatalog(parts[1]!) } });
    else if (path === 'rules') send(response, 200, { data: { rules: rules.list() } });
    else if (parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'events') {
      let after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
      const values = workflow.events(parts[1]!, after);
      if (!request.headers.accept?.includes('text/event-stream')) send(response, 200, { data: { events: values } });
      else {
        c.streams.add(response);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const write = (rows: typeof values) => { for (const row of rows) { response.write(`id: ${row.seq}\nevent: workflow\ndata: ${JSON.stringify(row)}\n\n`); after = Number(row.seq); } };
        write(values); response.write(': connected\n\n');
        const timer = setInterval(() => { try { c.authorize(); write(workflow.events(parts[1]!, after)); } catch { clearInterval(timer); response.end(); } }, 250);
        response.once('close', () => { clearInterval(timer); c.streams.delete(response); });
      }
    } else if (parts[0] === 'tasks' && parts.length === 3 && parts[2] === 'bundle') {
      const a = artifacts.current(parts[1]!); if (!a) deny(404, 'ARTIFACT_NOT_FOUND'); send(response, 200, { data: artifactDTO(a, store) });
    } else if (parts[0] === 'artifacts' && parts.length === 2) send(response, 200, { data: artifactDTO(artifacts.get(parts[1]!), store) });
    else if (parts[0] === 'artifacts' && parts.length === 4 && parts[2] === 'files') {
      const a = artifacts.get(parts[1]!), file = a.files.find(f => f.path === parts[3]); if (!file) deny(404, 'FILE_NOT_FOUND');
      const bytes = Buffer.from(file.bytes, 'base64'); if (digest(bytes) !== file.sha256 || bytes.length !== file.size) deny(409, 'ARTIFACT_CORRUPT');
      binary(response, bytes, file.media_type, file.path, false);
    } else if (parts[0] === 'exports' && (parts.length === 3 && parts[2] === 'archive' || parts.length === 4 && parts[2] === 'files')) {
      const result = artifacts.exported(parts[1]!);
      if (parts[2] === 'archive') binary(response, result.zip, 'application/zip', 'safehandoff.zip', true);
      else { const file = result.artifact.files.find(f => f.path === parts[3]); if (!file) deny(404, 'FILE_NOT_FOUND'); binary(response, Buffer.from(file.bytes, 'base64'), file.media_type, file.path, true); }
    } else if (parts[0] === 'jobs' && parts.length === 2 || parts[0] === 'tasks' && parts.length === 4 && parts[2] === 'jobs') {
      try { const job = artifacts.job(parts[0] === 'tasks' ? parts[3]! : parts[1]!);
        if (parts[0] === 'tasks' && job.task_id !== parts[1]) deny(404, 'JOB_NOT_FOUND');
        send(response, 200, { data: job }); } catch (error) {
        if (!(error instanceof Error) || error.message !== 'JOB_NOT_FOUND') throw error; return false;
      }
    } else return false;
    return true;
  }
  if (parts[0] === 'tasks' && parts[1] && c.deletingTasks.has(parts[1]) && !(request.method === 'DELETE' && parts.length === 2)) deny(409, 'TASK_DELETING');
  const special = parts[0] === 'artifacts' || parts[0] === 'rules' || path === 'tasks' && request.method === 'POST' ||
    parts[0] === 'tasks' && (parts[2] === 'finalize' || parts[2] === 'rules' || parts[2] === 'jobs' || parts[2] === 'sources' && request.method === 'DELETE');
  if (!special) return false;
  // The caller can pass the already read body back to the base routes without rereading the stream.
  const input = await body(request); (request as IncomingMessage & { workflowBody?: unknown }).workflowBody = input;
  const key = string(request.headers['idempotency-key']); if (key.length > 200) deny(400, 'INVALID_IDEMPOTENCY_KEY');
  const operation = `${request.method}:${parts[1] ?? ''}:${parts.slice(2).join('/')}`;
  if (path === 'tasks' && request.method === 'POST' && input && typeof input === 'object' && Object.hasOwn(input, 'intake')) {
    const v = object(input, ['intake']);
    const { intake, context } = intakeContext(v.intake);
    const result = store.request('create-task', key, input, () => { const task = store.create(context, digest('[]'), digest('[]')); rules.saveIntake(task.id, intake); return task; });
    send(response, 201, { data: result.result }); return true;
  }
  if (parts[0] === 'tasks' && parts[2] === 'sources' && parts.length === 4 && request.method === 'DELETE') {
    const v = object(input, ['expected_revision']);
    const result = store.request(operation, key, input, () => { const rev = revision(v.expected_revision); store.assertRevision(parts[1]!, rev);
      const sources = store.analysis.sources(parts[1]!); if (!sources.some(s => s.source_id === parts[3])) deny(404, 'SOURCE_NOT_FOUND');
      return store.analysis.replaceSources(parts[1]!, rev, sources.filter(s => s.source_id !== parts[3])); });
    send(response, 200, { data: result.result }); return true;
  }
  if (parts[0] === 'tasks' && parts[2] === 'jobs' && parts.length === 3 && request.method === 'POST') {
    const v = object(input, ['expected_revision', 'kind'], ['arguments']);
    if (!['compose', 'review'].includes(String(v.kind))) return false;
    const args = object(v.arguments ?? {}, [], v.kind === 'review' ? ['artifact_id', 'expected_artifact_set_hash'] : ['provisional']);
    if (args.provisional !== undefined && typeof args.provisional !== 'boolean') deny(400, 'INVALID_TASK_INPUT');
    if (v.kind === 'review') { const a = artifacts.get(string(args.artifact_id)); if (a.artifact_set_hash !== args.expected_artifact_set_hash) deny(409, 'ARTIFACT_HASH_CONFLICT'); }
    if (c.pending.size >= 4 && !store.replay(operation, key, input)) deny(429, 'JOB_LIMIT');
    const result = store.request(operation, key, input, () => artifacts.start(parts[1]!, revision(v.expected_revision), v.kind as 'compose' | 'review', args.artifact_id as string | undefined));
    if (!result.replayed) c.launch(String(result.result.id), parts[1]!, signal => artifacts.run(String(result.result.id), engine, signal));
    send(response, 202, { data: result.result }); return true;
  }
  if (parts[0] === 'tasks' && parts[2] === 'jobs' && parts.length === 5 && parts[4] === 'cancel') {
    const v = object(input, ['expected_revision']);
    try { const job = artifacts.job(parts[3]!); if (job.task_id !== parts[1]) deny(404, 'JOB_NOT_FOUND'); }
    catch (error) { if (!(error instanceof Error) || error.message !== 'JOB_NOT_FOUND') throw error; return false; }
    const result = store.request(operation, key, input, () => { store.assertRevision(parts[1]!, revision(v.expected_revision));
      const requested = artifacts.cancel(parts[3]!, false); c.controllers.get(parts[3]!)?.abort(); return { cancel_requested: requested }; });
    send(response, 202, { data: result.result }); return true;
  }
  if (parts[0] === 'tasks' && parts[2] === 'finalize' && parts.length === 3 && request.method === 'POST') {
    const v = object(input, ['expected_revision', 'artifact_id', 'expected_artifact_set_hash', 'confirmed']);
    const previous = store.replay(operation, key, input); if (previous) { send(response, 200, { data: previous.result }); return true; }
    store.assertRevision(parts[1]!, revision(v.expected_revision));
    if (v.confirmed !== true) deny(400, 'FINAL_CONFIRMATION_REQUIRED');
    const prepared = artifacts.prepareArchive(string(v.artifact_id));
    const result = store.request(operation, key, input, () => artifacts.finalize(parts[1]!, revision(v.expected_revision), string(v.artifact_id), string(v.expected_artifact_set_hash), true, prepared));
    send(response, 200, { data: result.result }); return true;
  }
  if (parts[0] === 'artifacts' && parts.length === 3 && parts[2] === 'human-review' && request.method === 'POST') {
    const v = object(input, ['expected_revision', 'target_hash', 'checklist', 'fallback_reason']);
    const artifact = artifacts.get(parts[1]!);
    if (c.deletingTasks.has(artifact.task_id)) deny(409, 'TASK_DELETING');
    const result = store.request(`${request.method}:${artifact.task_id}:artifact-${parts[1]}-human-review`, key, input, () =>
      artifacts.humanReview(parts[1]!, revision(v.expected_revision), string(v.target_hash), object(v.checklist, ['reviewed_all_files', 'approved_facts_only', 'uncertainty_preserved']) as Record<string, boolean>, string(v.fallback_reason)));
    send(response, 200, { data: artifactDTO(result.result, store) }); return true;
  }
  if (path === 'rules' && request.method === 'POST') {
    const v = object(input, ['task_id', 'expected_revision', 'decision_id']);
    const result = store.request('save-rule', key, input, () => rules.save(string(v.task_id), revision(v.expected_revision), string(v.decision_id)));
    send(response, 201, { data: result.result }); return true;
  }
  if (parts[0] === 'rules' && parts.length === 3 && request.method === 'POST') {
    if (parts[2] !== 'revoke') deny(404, 'ENDPOINT_NOT_FOUND');
    const v = object(input, ['expected_rule_version']);
    const result = store.request(`rule:${parts[1]}:${parts[2]}`, key, input, () => rules.revoke(parts[1]!, revision(v.expected_rule_version)));
    send(response, 200, { data: result.result }); return true;
  }
  if (parts[0] === 'tasks' && parts.length === 4 && parts[2] === 'rules' && parts[3] === 'apply' && request.method === 'POST') {
    const v = object(input, ['expected_revision', 'rule_refs']);
    const result = store.request(operation, key, input, () => rules.apply(parts[1]!, revision(v.expected_revision), v.rule_refs as never));
    send(response, 200, { data: result.result }); return true;
  }
  return false;
}
