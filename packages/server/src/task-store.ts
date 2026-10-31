import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Candidate, DisclosurePreview, TaskContext } from '@safehandoff/core-interface';
import { WorkflowStore } from './workflow-store.ts';
import { lifecycleSchema } from './lifecycle-schema.ts';
import { AnalysisStore } from './analysis-store.ts';
import { TaskStoreError } from './task-error.ts';
export { TaskStoreError } from './task-error.ts';
import { analysisSchema, httpSchema, taskSchema } from './task-schema.ts';

export interface StoredTask {
  id: string; revision: number; phase: 'needs_analysis' | 'needs_decisions' | 'ready_to_generate';
  context: TaskContext; source_set_hash: string; skill_set_hash: string; current_candidate_set_id: string | null;
}
export interface DecisionInput {
  candidate_id: string; disposition: 'allow' | 'exclude' | 'defer'; preview_id?: string; projection_sha256?: string; expires_at?: string | null;
}
export interface StoredDecision {
  id: string; candidate_id: string; disposition: 'allow' | 'exclude' | 'defer'; preview_id: string | null;
  created_revision: number; expires_at: string | null; revoked_at: string | null;
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 8192;
const fail = (): never => { throw new TaskStoreError('INVALID_TASK_INPUT'); };

export class TaskStore {
  readonly analysis: AnalysisStore;
  readonly workflow: WorkflowStore;
  private readonly db: DatabaseSync;
  private readonly clock: () => Date;
  constructor(path: string, clock: () => Date = () => new Date()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.clock = clock;
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
      const migrated = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_store_migrations'").get();
      if (migrated && Number(this.db.prepare('SELECT max(version) AS version FROM task_store_migrations').get()?.version) > 4) {
        throw new Error('UNSUPPORTED_TASK_SCHEMA');
      }
      this.transaction(() => { this.db.exec(taskSchema + analysisSchema + httpSchema + lifecycleSchema); });
    } catch (error) { this.db.close(); throw error; }
    this.workflow = new WorkflowStore(this.db, this, { transaction: work => this.transaction(work),
      advance: task => this.advance(task, 'needs_decisions'), now: () => this.clock().toISOString() });
    this.analysis = new AnalysisStore(this.db, {
      transaction: work => this.transaction(work), current: (id, revision) => this.current(id, revision),
      get: id => this.get(id), advance: (task, phase) => this.advance(task, phase),
      adopt: (task, candidates) => this.adoptCandidates(task, candidates),
    });
  }
  private transactionDepth = 0;
  private transaction<T>(work: () => T): T {
    if (this.transactionDepth) return work();
    this.db.exec('BEGIN IMMEDIATE'); this.transactionDepth++;
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.transactionDepth--; }
  }
  create(context: TaskContext, sourceSetHash: string, skillSetHash: string): StoredTask {
    if (!text(context.purpose) || !text(context.recipient) || !sha(sourceSetHash) || !sha(skillSetHash) ||
      Object.keys(context).some(key => !['purpose', 'recipient', 'goal_variant', 'output_language'].includes(key)) ||
      (context.goal_variant !== undefined && !['default', 'observations_only', 'ask_for_diagnostics', 'reproduction_evidence'].includes(context.goal_variant)) ||
      (context.output_language !== undefined && !['ko', 'en'].includes(context.output_language))) fail();
    return this.transaction(() => {
      const id = randomUUID(), now = this.clock().toISOString();
      this.db.prepare(`INSERT INTO workflow_tasks VALUES(?,1,'needs_analysis',?,?,?,NULL,?,?)`)
        .run(id, JSON.stringify(context), sourceSetHash, skillSetHash, now, now);
      this.snapshot(id); return this.get(id);
    });
  }
  get(id: string): StoredTask {
    const row = this.db.prepare('SELECT * FROM workflow_tasks WHERE id=?').get(id);
    if (!row) throw new TaskStoreError('TASK_NOT_FOUND');
    return { id: String(row.id), revision: Number(row.revision), phase: row.phase as StoredTask['phase'],
      context: JSON.parse(String(row.context_json)), source_set_hash: String(row.source_set_hash), skill_set_hash: String(row.skill_set_hash),
      current_candidate_set_id: row.current_candidate_set_id as string | null };
  }
  private current(id: string, revision: number): StoredTask {
    const task = this.get(id);
    if (task.revision !== revision) throw new TaskStoreError('REVISION_CONFLICT');
    return task;
  }
  private snapshot(id: string): void {
    const task = this.get(id);
    this.db.prepare('INSERT INTO workflow_snapshots VALUES(?,?,?)').run(id, task.revision,
      JSON.stringify({ ...task, decisions: this.decisions(id) }));
  }
  private advance(task: StoredTask, phase: StoredTask['phase']): StoredTask {
    this.db.prepare("UPDATE workflow_artifact_jobs SET status='stale' WHERE task_id=? AND status='running'").run(task.id);
    this.db.prepare("UPDATE workflow_analysis_jobs SET status='stale' WHERE task_id=? AND status='running'").run(task.id);
    this.db.prepare("UPDATE workflow_disclosure_jobs SET status='stale' WHERE task_id=? AND status='running'").run(task.id);
    this.db.prepare('UPDATE workflow_tasks SET revision=revision+1,phase=?,updated_at=? WHERE id=? AND revision=?')
      .run(phase, this.clock().toISOString(), task.id, task.revision);
    this.snapshot(task.id); return this.get(task.id);
  }
  installCandidates(id: string, revision: number, candidates: Candidate[]): StoredTask {
    return this.transaction(() => this.adoptCandidates(this.current(id, revision), candidates));
  }
  private adoptCandidates(task: StoredTask, candidates: Candidate[]): StoredTask {
    if (!Array.isArray(candidates) || candidates.length > 100) fail();
    const id = task.id, revision = task.revision, set = randomUUID();
    this.db.prepare('INSERT INTO workflow_candidate_sets VALUES(?,?,?)').run(id, set, revision + 1);
    for (const candidate of candidates) {
      if (!candidate || !text(candidate.local_key) || !text(candidate.statement) || typeof candidate.purpose_relevance !== 'string' ||
        candidate.purpose_relevance.length > 8192 || !['observation', 'constraint', 'hypothesis', 'unknown', 'identifier'].includes(candidate.kind) ||
        !['observed', 'reported', 'inferred', 'unknown'].includes(candidate.uncertainty) ||
        !['required', 'optional'].includes(candidate.relevance) || !Array.isArray(candidate.evidence_ids) ||
        candidate.evidence_ids.length > 100 || !candidate.evidence_ids.every(text) ||
        Object.keys(candidate).sort().join(',') !== 'evidence_ids,kind,local_key,purpose_relevance,relevance,statement,uncertainty') fail();
      this.db.prepare('INSERT INTO workflow_candidates VALUES(?,?,?,?)').run(id, set, candidate.local_key, JSON.stringify(candidate));
    }
    this.db.prepare('DELETE FROM workflow_current_decisions WHERE task_id=?').run(id);
    this.db.prepare('UPDATE workflow_tasks SET current_candidate_set_id=? WHERE id=?').run(set, id);
    this.workflow.rules.autoApply(id, revision + 1);
    return this.advance(task, 'needs_decisions');
  }
  private candidate(task: StoredTask, candidateId: string): Candidate {
    const row = this.db.prepare('SELECT payload_json FROM workflow_candidates WHERE task_id=? AND id=? AND set_id=?')
      .get(task.id, candidateId, task.current_candidate_set_id);
    if (!row) throw new TaskStoreError('INVALID_DECISION');
    return JSON.parse(String(row.payload_json));
  }
  // Internal caller provides a proposed summary; only a later human decision makes it public.
  preview(id: string, revision: number, candidateId: string, statement: string): DisclosurePreview {
    if (!text(statement)) fail();
    return this.transaction(() => {
      const task = this.current(id, revision); this.candidate(task, candidateId);
      const preview: DisclosurePreview = { schema_version: 'disclosure_preview.v1', preview_id: randomUUID(), candidate_id: candidateId,
        input_revision: revision, representation: { kind: 'fact_summary' }, projection: { statement, columns: [], rows: [] },
        projection_sha256: '', raw_grants: [] };
      const bytes = Buffer.from(JSON.stringify(preview.projection)); preview.projection_sha256 = hash(bytes);
      this.db.prepare('INSERT INTO workflow_previews VALUES(?,?,?,?,?,?,?,?)').run(id, preview.preview_id, candidateId, revision,
        bytes, preview.projection_sha256, task.source_set_hash, hash(JSON.stringify(task.context)));
      return preview;
    });
  }
  // HTTP idempotency is durable; nested store writes participate in this same transaction.
  replay<T>(operation: string, key: string, input: unknown): { result: T } | null {
    const row = this.db.prepare('SELECT request_hash,result_json FROM workflow_http_requests WHERE operation=? AND key=?').get(operation, key);
    if (!row) return null;
    if (row.request_hash !== hash(JSON.stringify(input))) throw new TaskStoreError('IDEMPOTENCY_CONFLICT');
    return { result: JSON.parse(String(row.result_json)) as T };
  }
  request<T>(operation: string, key: string, input: unknown, work: () => T): { replayed: boolean; result: T } {
    if (!text(key) || key.length > 200) fail();
    return this.transaction(() => {
      const digest = hash(JSON.stringify(input));
      const previous = this.db.prepare('SELECT * FROM workflow_http_requests WHERE operation=? AND key=?').get(operation, key);
      if (previous) {
        if (previous.request_hash !== digest) throw new TaskStoreError('IDEMPOTENCY_CONFLICT');
        return { replayed: true, result: JSON.parse(String(previous.result_json)) as T };
      }
      const result = work();
      const taskId = operation.split(':')[1];
      const exists = taskId && this.db.prepare('SELECT id FROM workflow_tasks WHERE id=?').get(taskId);
      this.db.prepare('INSERT INTO workflow_http_requests VALUES(?,?,?,?,?)').run(operation, key, digest, JSON.stringify(result), exists ? taskId : null);
      return { replayed: false, result };
    });
  }
  assertRevision(id: string, revision: number): StoredTask { return this.current(id, revision); }
  storePreview(id: string, revision: number, value: DisclosurePreview): DisclosurePreview {
    value = structuredClone(value);
    return this.transaction(() => {
      const task = this.current(id, revision); this.candidate(task, value.candidate_id);
      if (value.input_revision !== revision || value.schema_version !== 'disclosure_preview.v1' || value.raw_grants.length ||
        typeof value.projection.statement !== 'string' || !Array.isArray(value.projection.columns) || !Array.isArray(value.projection.rows) ||
        value.projection.excerpt !== undefined || JSON.stringify(value).length > 1048576) fail();
      value.preview_id = randomUUID(); value.projection_sha256 = hash(JSON.stringify(value.projection));
      this.db.prepare('INSERT INTO workflow_previews VALUES(?,?,?,?,?,?,?,?)').run(id, value.preview_id, value.candidate_id, revision,
        Buffer.from(JSON.stringify(value.projection)), value.projection_sha256, task.source_set_hash, hash(JSON.stringify(task.context)));
      this.db.prepare('INSERT INTO workflow_preview_payloads VALUES(?,?,?)').run(id, value.preview_id, JSON.stringify(value));
      return value;
    });
  }
  getPreview(id: string, previewId: string): DisclosurePreview {
    const row = this.db.prepare('SELECT payload_json FROM workflow_preview_payloads WHERE task_id=? AND id=?').get(id, previewId);
    if (!row) throw new TaskStoreError('INVALID_DECISION');
    return JSON.parse(String(row.payload_json));
  }
  recoverJobs(): void {
    this.transaction(() => {
      this.db.prepare("UPDATE workflow_artifact_jobs SET status='failed',error_code='INTERRUPTED' WHERE status IN ('running','cancel_requested')").run();
      this.db.prepare("UPDATE workflow_analysis_jobs SET status='failed',error_code='INTERRUPTED' WHERE status='running'").run();
      this.db.prepare("UPDATE workflow_disclosure_jobs SET status='failed',error_code='INTERRUPTED' WHERE status IN ('running','cancel_requested')").run();
    });
  }
  createDisclosureJob(id: string, revision: number): string {
    this.current(id, revision); const job = randomUUID();
    this.db.prepare("INSERT INTO workflow_disclosure_jobs VALUES(?,?,?,'running',NULL,NULL)").run(job, id, revision); return job;
  }
  finishDisclosureJob(job: string, result: unknown, error: string | null): void {
    const row = this.db.prepare('SELECT * FROM workflow_disclosure_jobs WHERE id=?').get(job);
    if (!row) return;
    if (row.status === 'cancel_requested') {
      this.db.prepare("UPDATE workflow_disclosure_jobs SET status='cancelled',result_json=NULL,error_code='CORE_CANCELLED' WHERE id=?").run(job); return;
    }
    if (row.status !== 'running') return;
    const stale = this.get(String(row.task_id)).revision !== row.revision;
    this.db.prepare('UPDATE workflow_disclosure_jobs SET status=?,result_json=?,error_code=? WHERE id=?').run(
      stale ? 'stale' : error ? 'failed' : 'succeeded', stale || error ? null : JSON.stringify(result), error, job);
  }
  cancelDisclosureJob(task: string, id: string): boolean {
    const job = this.disclosureJob(id); if (job.task_id !== task) throw new TaskStoreError('ANALYSIS_NOT_FOUND');
    return Number(this.db.prepare("UPDATE workflow_disclosure_jobs SET status='cancel_requested' WHERE task_id=? AND id=? AND status='running'").run(task, id).changes) > 0;
  }
  disclosureJob(id: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT * FROM workflow_disclosure_jobs WHERE id=?').get(id);
    if (!row) throw new TaskStoreError('ANALYSIS_NOT_FOUND');
    const stale = this.get(String(row.task_id)).revision !== row.revision;
    return { id, task_id: row.task_id, input_revision: row.revision, kind: 'interpret_disclosure',
      status: stale ? 'stale' : row.status, result: stale || row.result_json === null ? null : JSON.parse(String(row.result_json)), error_code: row.error_code };
  }
  applyDecisionBatch(id: string, revision: number, inputs: DecisionInput[], key: string): StoredTask {
    if (!text(key) || key.length > 200 || !Array.isArray(inputs) || !inputs.length || inputs.length > 100) fail();
    const requestHash = hash(JSON.stringify({ revision, inputs }));
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM workflow_decision_batches WHERE task_id=? AND idempotency_key=?').get(id, key);
      if (previous) {
        if (previous.request_hash !== requestHash) throw new TaskStoreError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(String(previous.result_json));
      }
      const task = this.current(id, revision), seen = new Set<string>(), now = this.clock().toISOString();
      for (const input of inputs) {
        this.candidate(task, input.candidate_id);
        if (seen.has(input.candidate_id) || !['allow', 'exclude', 'defer'].includes(input.disposition) ||
          Object.keys(input).some(field => !['candidate_id', 'disposition', 'preview_id', 'projection_sha256', 'expires_at'].includes(field))) {
          throw new TaskStoreError('INVALID_DECISION');
        }
        seen.add(input.candidate_id);
        if (input.expires_at != null && (!Number.isFinite(Date.parse(input.expires_at)) || Date.parse(input.expires_at) <= Date.parse(now))) {
          throw new TaskStoreError('INVALID_DECISION');
        }
        if (input.disposition === 'allow') {
          const preview = this.db.prepare('SELECT * FROM workflow_previews WHERE task_id=? AND id=? AND candidate_id=? AND revision=?')
            .get(id, input.preview_id ?? '', input.candidate_id, revision);
          if (!preview || preview.projection_sha256 !== input.projection_sha256 || hash(preview.projection_bytes as Uint8Array) !== input.projection_sha256 ||
            preview.source_set_hash !== task.source_set_hash || preview.scope_hash !== hash(JSON.stringify(task.context))) {
            throw new TaskStoreError('INVALID_DECISION');
          }
        } else if (input.preview_id !== undefined || input.projection_sha256 !== undefined) throw new TaskStoreError('INVALID_DECISION');
        const current = this.db.prepare('SELECT decision_id FROM workflow_current_decisions WHERE task_id=? AND candidate_id=?').get(id, input.candidate_id);
        const decision = randomUUID();
        this.db.prepare('INSERT INTO workflow_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, decision, input.candidate_id, revision + 1,
          input.disposition, input.preview_id ?? null, current?.decision_id ?? null, input.expires_at ?? null, null, now);
        this.db.prepare(`INSERT INTO workflow_current_decisions VALUES(?,?,?)
          ON CONFLICT(task_id,candidate_id) DO UPDATE SET decision_id=excluded.decision_id`).run(id, input.candidate_id, decision);
      }
      const result = this.advance(task, 'needs_decisions');
      this.db.prepare('INSERT INTO workflow_decision_batches VALUES(?,?,?,?)').run(id, key, requestHash, JSON.stringify(result));
      return result;
    });
  }
  decisions(id: string): StoredDecision[] {
    this.get(id);
    return this.db.prepare(`SELECT d.id,d.candidate_id,d.disposition,d.preview_id,d.created_revision,d.expires_at,d.revoked_at
      FROM workflow_current_decisions c JOIN workflow_decisions d ON d.task_id=c.task_id AND d.candidate_id=c.candidate_id AND d.id=c.decision_id
      WHERE c.task_id=? ORDER BY d.candidate_id`).all(id) as unknown as StoredDecision[];
  }
  effectiveAllows(id: string): StoredDecision[] {
    const now = this.clock().getTime();
    return this.decisions(id).filter(decision => decision.disposition === 'allow' && !decision.revoked_at &&
      (decision.expires_at === null || Date.parse(decision.expires_at) > now));
  }
  revoke(id: string, revision: number, decisionId: string): StoredTask {
    return this.transaction(() => {
      const task = this.current(id, revision);
      if (!this.decisions(id).some(decision => decision.id === decisionId && !decision.revoked_at)) throw new TaskStoreError('INVALID_DECISION');
      this.db.prepare('UPDATE workflow_decisions SET revoked_at=? WHERE task_id=? AND id=?').run(this.clock().toISOString(), id, decisionId);
      return this.advance(task, 'needs_decisions');
    });
  }
  delete(id: string, revision: number): void {
    this.transaction(() => {
      this.current(id, revision);
      this.db.prepare(`UPDATE workflow_http_requests SET result_json=? WHERE operation='create-task'
        AND json_extract(result_json,'$.id')=?`).run(JSON.stringify({ id, deleted: true }), id);
      this.db.prepare('DELETE FROM workflow_tasks WHERE id=?').run(id);
    });
  }
  close(): void { this.db.close(); }
}
