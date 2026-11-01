import { randomUUID } from 'node:crypto';
import { composeFactPack, groundFacts } from '@safehandoff/core-interface';
import type { Decision, Draft, Engine, FactPack, Review, ReviewGroundingContext } from '@safehandoff/core-interface';
import { archive, digest, renderFiles, validateDocument } from './artifact-render.ts';
import type { PublicFile } from './artifact-render.ts';
import type { LifecycleContext } from './lifecycle-types.ts';
import type { RuleStore } from './rule-store.ts';
import { deny, WorkflowHTTPError } from './workflow-session.ts';
export interface Artifact {
  id: string; task_id: string; revision: number; draft: Draft; review: Review | null; review_error_code: string | null;
  document_hash: string; artifact_set_hash: string; review_target_hash: string | null;
  files: PublicFile[]; pack: FactPack; grounding: ReviewGroundingContext; authorization_hash: string;
  hard_errors: string[]; human_review: { target_hash: string; fallback_reason: string } | null;
}
export class ArtifactStore {
  private readonly c: LifecycleContext;
  private readonly rules: RuleStore;
  constructor(context: LifecycleContext, rules: RuleStore) { this.c = context; this.rules = rules; }
  authorization(id: string): string {
    this.rules.validateBindings(id);
    return digest(JSON.stringify({ task: this.c.store.get(id), decisions: this.c.store.decisions(id), bindings: this.rules.bindings(id) }));
  }
  grounding(id: string): ReviewGroundingContext {
    const { store, db } = this.c, task = store.get(id), scope = this.rules.scope(id), now = Date.parse(this.c.hooks.now());
    const refs = this.rules.bindings(id); this.rules.validateBindings(id);
    const previews: ReviewGroundingContext['input']['previews'] = [];
    const decisions: Decision[] = store.decisions(id).map(d => {
      let representation: Decision['representation'] = { kind: 'fact_summary' }, projectionHash: string | undefined;
      const bound = refs.filter(r => r.decision_id === d.id);
      if (d.disposition === 'allow' && !d.revoked_at && (d.expires_at === null || Date.parse(d.expires_at) > now)) {
        const p = store.getPreview(id, d.preview_id!);
        const binding = db.prepare('SELECT source_set_hash,scope_hash FROM workflow_previews WHERE task_id=? AND id=?').get(id, p.preview_id);
        if (!binding || binding.source_set_hash !== task.source_set_hash || binding.scope_hash !== digest(JSON.stringify(task.context)) || digest(JSON.stringify(p.projection)) !== p.projection_sha256) deny(409, 'DECISION_INVALIDATED');
        representation = p.representation; projectionHash = p.projection_sha256;
        previews.push({ ...p, input_revision: task.revision });
      }
      return { id: d.id, candidate_id: d.candidate_id, disposition: d.disposition, representation, expires_at: d.expires_at,
        revoked: d.revoked_at !== null, applied_rule_id: bound[0]?.rule_id ?? '', applied_rule_version: bound[0]?.rule_version ?? 0,
        scope, source_set_hash: task.source_set_hash, projection_sha256: projectionHash };
    });
    const versions = [...new Map(refs.map(r => [`${r.rule_id}:${r.rule_version}`, this.rules.version(r.rule_id, r.rule_version)])).values()];
    const candidates = store.analysis.candidates(id).map(c => ({ local_key: c.id, kind: c.kind, uncertainty: c.uncertainty,
      statement: c.statement, evidence_ids: c.evidence_ids, relevance: c.relevance, purpose_relevance: c.purpose_relevance }));
    return { scope, source_set_hash: task.source_set_hash, candidate_selectors: Object.fromEntries(decisions.map(d => [d.candidate_id,
      versions.find(r => r.id === d.applied_rule_id && r.version === d.applied_rule_version)?.selector ?? ''])),
      rule_goals: versions.map(r => ({ rule_id: r.id, rule_version: r.version, goal_variant: r.goal_variant as never })), approved_tool_results: [],
      input: { task: task.context, task_revision: task.revision, template_id: 'support-request.v1', audience_type: scope.audience,
        candidates, decisions, previews, rules: versions.map(({ goal_variant: _goal, ...r }) => r) } };
  }
  start(id: string, revision: number, kind: 'compose' | 'review', artifactId?: string) {
    return this.c.hooks.transaction(() => {
      const task = this.c.store.assertRevision(id, revision);
      if (kind === 'review' && !artifactId) deny(400, 'ARTIFACT_REQUIRED');
      const prior = artifactId ? this.get(artifactId) : undefined;
      if (prior) this.guard(prior);
      if (prior && (prior.task_id !== id || prior.revision !== revision)) deny(409, 'ARTIFACT_STALE');
      this.c.db.prepare("UPDATE workflow_artifact_jobs SET status='stale' WHERE task_id=? AND status IN ('running','cancel_requested')").run(id);
      const updated = this.c.hooks.advance(task), grounding = this.grounding(id), pack = composeFactPack(grounding.input, Date.parse(this.c.hooks.now()));
      groundFacts(grounding, pack, Date.parse(this.c.hooks.now()));
      if (!pack.facts.length) deny(409, 'NEEDS_DISCLOSURE_DECISION');
      const job = randomUUID(), snapshot = { pack, grounding, authorization_hash: this.authorization(id), draft: prior?.draft };
      this.c.db.prepare("INSERT INTO workflow_artifact_jobs VALUES(?,?,?,?,'running',?,NULL,NULL)").run(job, id, updated.revision, kind, JSON.stringify(snapshot));
      return this.job(job);
    });
  }
  job(id: string): Record<string, any> {
    const row = this.c.db.prepare('SELECT * FROM workflow_artifact_jobs WHERE id=?').get(id);
    if (!row) deny(404, 'JOB_NOT_FOUND');
    const stale = this.c.store.get(String(row.task_id)).revision !== row.revision && row.status === 'running';
    return { id, task_id: String(row.task_id), input_revision: Number(row.revision), kind: String(row.kind),
      status: stale ? 'stale' : row.status, artifact_id: row.result_id, error_code: row.error_code };
  }
  async run(jobId: string, engine: Engine, signal: AbortSignal): Promise<void> {
    const job = this.job(jobId), row = this.c.db.prepare('SELECT snapshot_json FROM workflow_artifact_jobs WHERE id=?').get(jobId)!;
    const snapshot = JSON.parse(String(row.snapshot_json)) as { pack: FactPack; grounding: ReviewGroundingContext; authorization_hash: string; draft?: Draft };
    let rendered: ReturnType<typeof renderFiles> | undefined;
    // The draft under review when compose fails; a model outage must not lose a validated draft.
    let unreviewed: Draft | null = null;
    const finalFiles = (draft: Draft) => {
      rendered = renderFiles(draft, snapshot.pack);
      return rendered.files.map(f => ({ path: f.path, sha256: f.sha256, text: Buffer.from(f.bytes, 'base64').toString('utf8') }));
    };
    try {
      let draft: Draft, review: Review;
      if (job.kind === 'compose') ({ draft, review } = await engine.writeReviewed(snapshot.pack, { grounding: snapshot.grounding, signal, finalFiles, onProgress: kind => {
        if (this.job(jobId).status === 'running') this.c.store.workflow.event(job.task_id, kind);
      }, onDraft: next => { unreviewed = next; } }));
      else { draft = snapshot.draft!; review = await engine.review(draft, snapshot.pack, snapshot.grounding, { files: finalFiles(draft), signal }); }
      if (signal.aborted) { this.cancel(jobId, true); return; }
      this.c.hooks.transaction(() => {
        const current = this.job(jobId);
        if (current.status !== 'running' || this.authorization(job.task_id) !== snapshot.authorization_hash) {
          this.c.db.prepare("UPDATE workflow_artifact_jobs SET status='stale' WHERE id=? AND status='running'").run(jobId); return;
        }
        groundFacts(this.grounding(job.task_id), snapshot.pack, Date.parse(this.c.hooks.now()));
        const updated = this.c.hooks.advance(this.c.store.get(job.task_id));
        const artifact: Artifact = { id: randomUUID(), task_id: job.task_id, revision: updated.revision, draft, review, review_error_code: null,
          pack: snapshot.pack, grounding: snapshot.grounding, authorization_hash: this.authorization(job.task_id),
          files: rendered?.files ?? [], document_hash: digest(JSON.stringify(draft)), artifact_set_hash: rendered?.artifact_set_hash ?? '',
          review_target_hash: rendered && review.result === 'pass' ? rendered.artifact_set_hash : null,
          hard_errors: rendered ? [] : ['FILES_NOT_CHECKED'], human_review: null };
        this.save(artifact);
        this.c.db.prepare("UPDATE workflow_artifact_jobs SET status='succeeded',result_id=? WHERE id=?").run(artifact.id, jobId);
      });
    } catch (error) {
      const code = error instanceof WorkflowHTTPError ? error.message : error instanceof Error && 'code' in error ? String(error.code) : 'COMPOSITION_FAILED';
      this.c.db.prepare("UPDATE workflow_artifact_jobs SET status=?,error_code=? WHERE id=? AND status IN ('running','cancel_requested')")
        .run(signal.aborted ? 'cancelled' : 'failed', code, jobId);
      const fallback = job.kind === 'review' ? snapshot.draft! : unreviewed as Draft | null;
      if (fallback && !signal.aborted && ['MODEL_TIMEOUT', 'MODEL_UNAVAILABLE'].includes(code)) this.c.hooks.transaction(() => {
        const task = this.c.store.get(job.task_id);
        if (task.revision !== job.input_revision || this.authorization(task.id) !== snapshot.authorization_hash) return;
        const files = renderFiles(fallback, snapshot.pack), updated = this.c.hooks.advance(task);
        const fallbackId = randomUUID();
        this.save({ id: fallbackId, task_id: task.id, revision: updated.revision, draft: fallback, review: null, review_error_code: code,
          ...files, pack: snapshot.pack, grounding: snapshot.grounding, authorization_hash: this.authorization(task.id),
          review_target_hash: null, hard_errors: [], human_review: null });
        this.c.db.prepare('UPDATE workflow_artifact_jobs SET result_id=? WHERE id=?').run(fallbackId, jobId);
      });
    }
  }
  private save(value: Artifact): void {
    this.c.db.prepare('INSERT INTO workflow_artifacts VALUES(?,?,?,?,?)').run(value.id, value.task_id, value.revision, JSON.stringify(value), this.c.hooks.now());
  }
  get(id: string): Artifact {
    const row = this.c.db.prepare('SELECT payload_json FROM workflow_artifacts WHERE id=?').get(id);
    if (!row) deny(404, 'ARTIFACT_NOT_FOUND'); return JSON.parse(String(row.payload_json));
  }
  current(id: string): Artifact | null {
    const row = this.c.db.prepare('SELECT id FROM workflow_artifacts WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(id);
    return row ? this.get(String(row.id)) : null;
  }
  guard(artifact: Artifact): void {
    if (artifact.revision !== this.c.store.get(artifact.task_id).revision || artifact.authorization_hash !== this.authorization(artifact.task_id)) deny(409, 'ARTIFACT_STALE');
    const grounding = this.grounding(artifact.task_id), pack = composeFactPack(grounding.input, Date.parse(this.c.hooks.now()));
    if (pack.facts.length !== artifact.pack.facts.length || digest(JSON.stringify(pack.facts)) !== digest(JSON.stringify(artifact.pack.facts)) ||
      digest(JSON.stringify(pack.tables)) !== digest(JSON.stringify(artifact.pack.tables))) deny(409, 'DECISION_INVALIDATED');
    groundFacts(grounding, pack, Date.parse(this.c.hooks.now()));
    validateDocument(artifact.draft, artifact.pack);
    const files = [...artifact.files].sort((a, b) => a.path < b.path ? -1 : 1);
    if (digest(JSON.stringify(artifact.draft)) !== artifact.document_hash || files.some(f => {
      const bytes = Buffer.from(f.bytes, 'base64'); return bytes.toString('base64') !== f.bytes || bytes.length !== f.size || digest(bytes) !== f.sha256;
    }) || (artifact.artifact_set_hash !== '' || files.length > 0) && digest(JSON.stringify(files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256 })))) !== artifact.artifact_set_hash) deny(409, 'ARTIFACT_CORRUPT');
  }
  edit(id: string, revision: number, expectedHash: string, draft: Draft): Artifact {
    return this.c.hooks.transaction(() => {
      const prior = this.get(id); this.c.store.assertRevision(prior.task_id, revision); this.guard(prior);
      if (prior.document_hash !== expectedHash) deny(409, 'DOCUMENT_HASH_CONFLICT');
      validateDocument(draft, prior.pack); const files = renderFiles(draft, prior.pack), updated = this.c.hooks.advance(this.c.store.get(prior.task_id));
      const value: Artifact = { ...prior, ...files, id: randomUUID(), revision: updated.revision, draft, review: null,
        hard_errors: [], review_error_code: null, review_target_hash: null, human_review: null, authorization_hash: this.authorization(prior.task_id) };
      this.save(value); return value;
    });
  }
  humanReview(id: string, revision: number, targetHash: string, checklist: Record<string, boolean>, reason: string): Artifact {
    return this.c.hooks.transaction(() => {
      const prior = this.get(id); this.c.store.assertRevision(prior.task_id, revision); this.guard(prior);
      if (targetHash !== prior.artifact_set_hash || Object.keys(checklist).sort().join(',') !== 'approved_facts_only,reviewed_all_files,uncertainty_preserved' ||
        Object.values(checklist).some(v => v !== true) || !['MODEL_TIMEOUT', 'MODEL_UNAVAILABLE'].includes(prior.review_error_code ?? '') ||
        typeof reason !== 'string' || !reason.trim() || reason.length > 8192 || prior.hard_errors.length) deny(400, 'HUMAN_REVIEW_REJECTED');
      const updated = this.c.hooks.advance(this.c.store.get(prior.task_id)), value = { ...prior, id: randomUUID(), revision: updated.revision,
        human_review: { target_hash: targetHash, fallback_reason: reason }, authorization_hash: this.authorization(prior.task_id) };
      this.save(value); return value;
    });
  }
  private finalGate(artifact: Artifact): void {
    const task = this.c.store.get(artifact.task_id), current = this.grounding(task.id), decisions = this.c.store.decisions(task.id);
    if (task.context.goal_variant === 'reproduction_evidence' || artifact.hard_errors.length ||
      current.input.candidates.some(c => !decisions.some(d => d.candidate_id === c.local_key && d.disposition !== 'defer' && !d.revoked_at &&
        (d.expires_at === null || Date.parse(d.expires_at) > Date.parse(this.c.hooks.now())))) ||
      !(artifact.review?.result === 'pass' && artifact.review_target_hash === artifact.artifact_set_hash || artifact.human_review?.target_hash === artifact.artifact_set_hash)) deny(409, 'FINALIZATION_BLOCKED');
  }
  canFinalize(artifact: Artifact): boolean {
    try { this.guard(artifact); this.finalGate(artifact); return true; } catch { return false; }
  }
  prepareArchive(artifactId: string) {
    const artifact = this.get(artifactId);
    return { artifact_id: artifactId, artifact_set_hash: artifact.artifact_set_hash, bytes: archive(artifact.files) };
  }
  finalize(id: string, revision: number, artifactId: string, setHash: string, confirmed: boolean,
    prepared: ReturnType<ArtifactStore['prepareArchive']>) {
    return this.c.hooks.transaction(() => {
      const task = this.c.store.assertRevision(id, revision), artifact = this.get(artifactId);
      if (artifact.task_id !== id || this.current(id)?.id !== artifactId || !confirmed || artifact.artifact_set_hash !== setHash) deny(409, 'FINALIZATION_REJECTED');
      this.guard(artifact);
      this.finalGate(artifact);
      if (prepared.artifact_id !== artifactId || prepared.artifact_set_hash !== setHash) deny(409, 'ARTIFACT_STALE');
      const bytes = prepared.bytes, exportId = randomUUID(), updated = this.c.hooks.advance(task);
      // Finalization changes revision but preserves the confirmed immutable artifact bytes.
      const bound = { ...artifact, id: randomUUID(), revision: updated.revision, authorization_hash: this.authorization(id) }; this.save(bound);
      this.c.db.prepare('INSERT INTO workflow_exports VALUES(?,?,?,?,?,?,?,?)').run(exportId, id, updated.revision, bound.id, setHash, bytes, digest(bytes), this.c.hooks.now());
      return { id: exportId, task_id: id, revision: updated.revision, artifact_id: bound.id, artifact_set_hash: setHash, archive_sha256: digest(bytes) };
    });
  }
  // The export bound to this exact artifact, so a reload can offer the same download again.
  exportOf(artifact: Artifact) {
    const row = this.c.db.prepare('SELECT id,task_id,revision,artifact_id,set_hash,sha256 FROM workflow_exports WHERE artifact_id=? ORDER BY rowid DESC LIMIT 1').get(artifact.id);
    return row ? { id: String(row.id), task_id: String(row.task_id), revision: Number(row.revision), artifact_id: String(row.artifact_id),
      artifact_set_hash: String(row.set_hash), archive_sha256: String(row.sha256) } : null;
  }
  exported(id: string): { artifact: Artifact; zip: Buffer; sha256: string } {
    const row = this.c.db.prepare('SELECT * FROM workflow_exports WHERE id=?').get(id); if (!row) deny(404, 'EXPORT_NOT_FOUND');
    const artifact = this.get(String(row.artifact_id));
    try { this.guard(artifact); this.finalGate(artifact); } catch { deny(409, 'EXPORT_INVALIDATED'); }
    const zip = Buffer.from(row.zip_bytes as Uint8Array);
    if (digest(zip) !== row.sha256 || artifact.artifact_set_hash !== row.set_hash) deny(409, 'EXPORT_INVALIDATED');
    return { artifact, zip, sha256: String(row.sha256) };
  }
  cancel(id: string, completed: boolean): boolean {
    return Number(this.c.db.prepare("UPDATE workflow_artifact_jobs SET status=? WHERE id=? AND status IN ('running','cancel_requested')")
      .run(completed ? 'cancelled' : 'cancel_requested', id).changes) > 0;
  }
}
