import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AnalyzeResult, Candidate, EvidenceSpan, SourceDocument, TaskContext } from '@safehandoff/core-interface';
import type { StoredTask } from './task-store.ts';
import { TaskStoreError } from './task-error.ts';
import { fields, hash, invalid, sourceSetHash, text, validateResult, validateSources } from './analysis-validation.ts';

interface Hooks {
  transaction<T>(work: () => T): T;
  current(id: string, revision: number): StoredTask;
  get(id: string): StoredTask;
  advance(task: StoredTask, phase: StoredTask['phase']): StoredTask;
  adopt(task: StoredTask, candidates: Candidate[]): StoredTask;
}
export interface AnalysisCandidate extends Candidate {
  id: string; origin: 'model' | 'manual'; selector: null;
  conflicts: { id: string; reason: string }[];
}
export interface AnalysisJob {
  id: string; task_id: string; revision: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale'; error_code: string | null;
  snapshot: { task: TaskContext; sources: SourceDocument[]; source_set_hash: string; skill_set_hash: string };
}
export interface AnalysisAdoption { adopted: boolean; job: Omit<AnalysisJob, 'snapshot'>; task: StoredTask }
export interface ManualCandidateInput {
  candidate: Omit<Candidate, 'local_key' | 'evidence_ids'>; evidence_ids?: string[]; user_note?: string;
}

// Constructed by TaskStore with the same DB connection and transaction hooks.
export class AnalysisStore {
  private readonly db: DatabaseSync;
  private readonly hooks: Hooks;
  constructor(db: DatabaseSync, hooks: Hooks) { this.db = db; this.hooks = hooks; }
  sources(id: string): SourceDocument[] {
    this.hooks.get(id);
    return this.db.prepare(`SELECT v.payload_json FROM workflow_source_versions v JOIN workflow_source_selections s
      ON v.task_id=s.task_id AND v.id=s.source_id WHERE v.task_id=? ORDER BY v.id`).all(id)
      .map(row => JSON.parse(String(row.payload_json)));
  }
  private saveSources(id: string, sources: SourceDocument[]): string {
    validateSources(sources);
    for (const input of sources) {
      const source: SourceDocument = { id: input.id, source_id: input.source_id, version: input.version,
        display_name: input.display_name, format: input.format, source_slot: input.source_slot,
        raw_bytes: input.raw_bytes, sha256: input.sha256, included: input.included };
      const bytes = JSON.stringify(source);
      const prior = this.db.prepare('SELECT payload_json FROM workflow_source_versions WHERE task_id=? AND id=?').get(id, source.id);
      if (prior && prior.payload_json !== bytes) invalid();
      const sameVersion = this.db.prepare(`SELECT id FROM workflow_source_versions WHERE task_id=?
        AND json_extract(payload_json,'$.source_id')=? AND json_extract(payload_json,'$.version')=?`).get(id, source.source_id, source.version);
      if (sameVersion && sameVersion.id !== source.id) invalid();
      this.db.prepare('INSERT OR IGNORE INTO workflow_source_versions VALUES(?,?,?)').run(id, source.id, bytes);
    }
    this.db.prepare('DELETE FROM workflow_source_selections WHERE task_id=?').run(id);
    for (const source of sources) this.db.prepare('INSERT INTO workflow_source_selections VALUES(?,?)').run(id, source.id);
    return sourceSetHash(sources);
  }
  private clearCurrent(id: string): void {
    this.db.prepare('DELETE FROM workflow_current_decisions WHERE task_id=?').run(id);
    this.db.prepare('UPDATE workflow_tasks SET current_candidate_set_id=NULL WHERE id=?').run(id);
  }
  replaceSources(id: string, revision: number, sources: SourceDocument[]): StoredTask {
    sources = structuredClone(sources);
    return this.hooks.transaction(() => {
      const task = this.hooks.current(id, revision), digest = this.saveSources(id, sources);
      this.clearCurrent(id);
      this.db.prepare('UPDATE workflow_tasks SET source_set_hash=? WHERE id=?').run(digest, id);
      this.db.prepare("UPDATE workflow_analysis_jobs SET status='stale' WHERE task_id=? AND status='running'").run(id);
      return this.hooks.advance(task, 'needs_analysis');
    });
  }
  start(id: string, revision: number): AnalysisJob {
    return this.hooks.transaction(() => {
      const task = this.hooks.current(id, revision), sources = this.sources(id);
      if (!sources.length || sourceSetHash(sources) !== task.source_set_hash) invalid();
      this.db.prepare("UPDATE workflow_analysis_jobs SET status='stale' WHERE task_id=? AND status='running'").run(id);
      this.clearCurrent(id);
      const updated = this.hooks.advance(task, 'needs_analysis'), jobId = randomUUID();
      const snapshot: AnalysisJob['snapshot'] = { task: task.context, sources, source_set_hash: task.source_set_hash, skill_set_hash: task.skill_set_hash };
      this.db.prepare("INSERT INTO workflow_analysis_jobs VALUES(?,?,?,?,'running',NULL,NULL)")
        .run(id, jobId, updated.revision, JSON.stringify(snapshot));
      return this.job(id, jobId);
    });
  }
  job(id: string, jobId: string): AnalysisJob {
    const row = this.db.prepare('SELECT * FROM workflow_analysis_jobs WHERE task_id=? AND id=?').get(id, jobId);
    if (!row) throw new TaskStoreError('ANALYSIS_NOT_FOUND');
    return { id: String(row.id), task_id: id, revision: Number(row.revision), status: row.status as AnalysisJob['status'],
      error_code: row.error_code as string | null, snapshot: JSON.parse(String(row.snapshot_json)) };
  }
  cancel(id: string, jobId: string): boolean {
    return Number(this.db.prepare("UPDATE workflow_analysis_jobs SET status='cancelled' WHERE task_id=? AND id=? AND status='running'").run(id, jobId).changes) === 1;
  }
  fail(id: string, jobId: string, code: string): void {
    const allowed = ['INVALID_CORE_INPUT', 'CORE_NOT_IMPLEMENTED', 'CORE_UNAVAILABLE', 'CORE_CANCELLED',
      'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_BUDGET_EXCEEDED', 'MODEL_INVALID_RESPONSE', 'MODEL_CANCELLED', 'INVALID_ANALYSIS'];
    this.db.prepare("UPDATE workflow_analysis_jobs SET status='failed',error_code=? WHERE task_id=? AND id=? AND status='running'")
      .run(allowed.includes(code) ? code : 'ANALYSIS_FAILED', id, jobId);
  }
  private saveEvidence(id: string, evidence: EvidenceSpan[]): void {
    for (const e of evidence) {
      const payload = JSON.stringify(e), previous = this.db.prepare('SELECT payload_json FROM workflow_evidence WHERE task_id=? AND id=?').get(id, e.id);
      if (previous && previous.payload_json !== payload) invalid();
      this.db.prepare('INSERT OR IGNORE INTO workflow_evidence VALUES(?,?,?,?)').run(id, e.id, e.source_version_id, payload);
    }
  }
  evidence(id: string): EvidenceSpan[] {
    this.hooks.get(id);
    return this.db.prepare(`SELECT e.payload_json FROM workflow_evidence e JOIN workflow_source_selections s
      ON e.task_id=s.task_id AND e.source_id=s.source_id WHERE e.task_id=? ORDER BY e.id`).all(id)
      .map(row => JSON.parse(String(row.payload_json)));
  }
  candidates(id: string): AnalysisCandidate[] {
    const task = this.hooks.get(id);
    return this.db.prepare(`SELECT c.id,c.payload_json,p.payload_json AS provenance FROM workflow_candidates c
      LEFT JOIN workflow_candidate_provenance p ON c.task_id=p.task_id AND c.id=p.candidate_id
      WHERE c.task_id=? AND c.set_id=? ORDER BY c.id`).all(id, task.current_candidate_set_id).map(row => {
      if (!row.provenance) invalid();
      const provenance = JSON.parse(String(row.provenance));
      return { ...JSON.parse(String(row.payload_json)), local_key: provenance.local_key, id: String(row.id),
        origin: provenance.origin, conflicts: provenance.conflicts, selector: null };
    });
  }
  private adopt(task: StoredTask, candidates: AnalysisCandidate[]): StoredTask {
    const updated = this.hooks.adopt(task, candidates.map(c => ({ local_key: c.id, kind: c.kind, uncertainty: c.uncertainty,
      statement: c.statement, evidence_ids: c.evidence_ids, relevance: c.relevance, purpose_relevance: c.purpose_relevance })));
    for (const c of candidates) this.db.prepare('INSERT INTO workflow_candidate_provenance VALUES(?,?,?)')
      .run(task.id, c.id, JSON.stringify({ local_key: c.local_key, origin: c.origin, conflicts: c.conflicts }));
    return updated;
  }
  private outcome(adopted: boolean, job: AnalysisJob, task: StoredTask): AnalysisAdoption {
    const { snapshot: _snapshot, ...summary } = job;
    return { adopted, job: summary, task };
  }
  complete(id: string, jobId: string, result: AnalyzeResult): AnalysisAdoption {
    result = structuredClone(result);
    return this.hooks.transaction(() => {
      let job = this.job(id, jobId);
      const task = this.hooks.get(id);
      if (job.status !== 'running') return this.outcome(false, job, task);
      if (job.revision !== task.revision || job.snapshot.source_set_hash !== task.source_set_hash ||
        job.snapshot.skill_set_hash !== task.skill_set_hash || JSON.stringify(job.snapshot.task) !== JSON.stringify(task.context) ||
        sourceSetHash(this.sources(id)) !== job.snapshot.source_set_hash) {
        this.db.prepare("UPDATE workflow_analysis_jobs SET status='stale' WHERE id=?").run(jobId);
        return this.outcome(false, this.job(id, jobId), task);
      }
      validateResult(result, job.snapshot.sources);
      this.saveEvidence(id, result.evidence);
      const groups = result.proposals.conflicts.map(group => ({ ...group, id: randomUUID() }));
      const candidates: AnalysisCandidate[] = result.proposals.candidates.map(c => ({ ...c, id: randomUUID(), origin: 'model', selector: null,
        conflicts: groups.filter(group => group.local_keys.includes(c.local_key)).map(group => ({ id: group.id, reason: group.reason })) }));
      const updated = this.adopt(task, candidates);
      this.db.prepare("UPDATE workflow_analysis_jobs SET status='succeeded',result_json=? WHERE id=?")
        .run(JSON.stringify(result), jobId);
      job = this.job(id, jobId);
      return this.outcome(true, job, updated);
    });
  }
  addManual(id: string, revision: number, input: ManualCandidateInput): StoredTask {
    input = structuredClone(input);
    return this.hooks.transaction(() => {
      let task = this.hooks.current(id, revision);
      fields(input, ['candidate'], ['evidence_ids', 'user_note']);
      fields(input.candidate, ['kind', 'uncertainty', 'statement', 'relevance', 'purpose_relevance']);
      if ((input.user_note === undefined) === (input.evidence_ids === undefined)) invalid();
      const old = this.candidates(id), evidence = this.evidence(id), sources = this.sources(id);
      let refs = input.evidence_ids;
      if (input.user_note !== undefined) {
        if (!text(input.user_note) || !input.user_note.trim()) invalid();
        const note: SourceDocument = { id: randomUUID(), source_id: randomUUID(), version: 1, display_name: 'user_note',
          source_slot: 'user_note', format: 'txt', included: true, raw_bytes: Buffer.from(input.user_note).toString('base64'), sha256: hash(input.user_note) };
        const e: EvidenceSpan = { id: randomUUID(), source_version_id: note.id, start: 0, end: Buffer.byteLength(input.user_note),
          evidence_sha256: note.sha256, locator: { kind: 'byte_range' } };
        const digest = this.saveSources(id, [...sources, note]);
        this.db.prepare('UPDATE workflow_tasks SET source_set_hash=? WHERE id=?').run(digest, id);
        sources.push(note); evidence.push(e); this.saveEvidence(id, [e]); refs = [e.id];
        task = this.hooks.get(id);
      }
      if (!Array.isArray(refs) || !refs.length) invalid();
      // Verify all cloned evidence still belongs to current selected source versions.
      const proposal: Candidate = { ...input.candidate, evidence_ids: refs, local_key: randomUUID() };
      const needed = new Set([...old.flatMap(c => c.evidence_ids), ...refs]);
      const validation = { evidence: evidence.filter(e => needed.has(e.id)), proposals: { schema_version: 'candidate_proposals.v1' as const,
        candidates: [proposal], conflicts: [] } };
      validateResult(validation, sources);
      const known = new Set(evidence.map(e => e.id));
      if (old.some(c => c.evidence_ids.some(ref => !known.has(ref)))) invalid();
      const candidates: AnalysisCandidate[] = [...old.map(c => ({ ...c, id: randomUUID() })),
        { ...proposal, id: randomUUID(), origin: 'manual', selector: null, conflicts: [] }];
      this.db.prepare("UPDATE workflow_analysis_jobs SET status='stale' WHERE task_id=? AND status='running'").run(id);
      return this.adopt(task, candidates);
    });
  }
}
