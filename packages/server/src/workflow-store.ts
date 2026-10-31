import type { DatabaseSync } from 'node:sqlite';
import { ArtifactStore } from './artifact-store.ts';
import { RuleStore } from './rule-store.ts';
import type { LifecycleHooks } from './lifecycle-types.ts';
import type { TaskStore } from './task-store.ts';
import { deny } from './workflow-session.ts';
export class WorkflowStore {
  readonly artifacts: ArtifactStore;
  readonly rules: RuleStore;
  private readonly db: DatabaseSync;
  private readonly store: TaskStore;
  private readonly now: () => string;
  constructor(db: DatabaseSync, store: TaskStore, hooks: LifecycleHooks) {
    this.db = db; this.store = store; this.now = hooks.now;
    const context = { db, store, hooks }; this.rules = new RuleStore(context); this.artifacts = new ArtifactStore(context, this.rules);
  }
  event(id: string, kind: string): void {
    if (!['writer_started', 'review_started', 'files_review_started', 'job_failed', 'job_cancel_requested', 'artifact_created'].includes(kind)) deny(400, 'INVALID_EVENT_KIND');
    const task = this.store.get(id);
    this.db.prepare('INSERT INTO workflow_events(task_id,revision,kind,created_at) VALUES(?,?,?,?)').run(id, task.revision, kind, this.now());
  }
  events(id: string, after = 0) {
    this.store.get(id);
    if (!Number.isSafeInteger(after) || after < 0) deny(400, 'INVALID_EVENT_CURSOR');
    return this.db.prepare('SELECT seq,revision,kind,created_at FROM workflow_events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 100').all(id, after).map(row => ({ seq: Number(row.seq), revision: Number(row.revision), kind: String(row.kind), created_at: String(row.created_at), duration_ms: null, usage: null }));
  }
  list(cursor?: string) {
    let after: { updated_at: string; id: string } | null = null;
    if (cursor) {
      try {
        if (cursor.length > 512) throw Error(); const bytes = Buffer.from(cursor, 'base64url');
        if (bytes.toString('base64url') !== cursor) throw Error(); after = JSON.parse(bytes.toString());
        if (!after || typeof after.updated_at !== 'string' || typeof after.id !== 'string') throw Error();
      } catch { deny(400, 'INVALID_CURSOR'); }
    }
    const rows = this.db.prepare(`SELECT id,updated_at FROM workflow_tasks ${after ? 'WHERE updated_at<? OR (updated_at=? AND id<?)' : ''}
      ORDER BY updated_at DESC,id DESC LIMIT 31`).all(...(after ? [after.updated_at, after.updated_at, after.id] : []));
    const page = rows.slice(0, 30), last = page.at(-1);
    return { tasks: page.map(row => ({ ...this.store.get(String(row.id)), ...this.status(String(row.id)),
      internal_title: this.rules.intake(String(row.id))?.internal_title ?? '', updated_at: row.updated_at })),
      next_cursor: rows.length > 30 ? Buffer.from(JSON.stringify(last)).toString('base64url') : null };
  }
  status(id: string) {
    const task = this.store.get(id), artifact = this.artifacts.current(id);
    const jobs = this.db.prepare(`SELECT id,revision,status FROM workflow_artifact_jobs WHERE task_id=? ORDER BY rowid DESC LIMIT 1`).get(id);
    const analysis = this.db.prepare('SELECT id,revision,status FROM workflow_analysis_jobs WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(id);
    const current = [jobs, analysis].find(j => j && j.revision === task.revision && ['running', 'cancel_requested'].includes(String(j.status)));
    let phase: string = current ? 'processing' : [jobs, analysis].some(j => j?.revision === task.revision && j.status === 'failed') ? 'needs_attention' : task.phase;
    if (!current && artifact?.revision === task.revision) {
      try {
        this.artifacts.guard(artifact);
        phase = this.artifacts.canFinalize(artifact) ? 'ready_to_finalize' : 'needs_attention';
        if (phase === 'ready_to_finalize' && this.db.prepare('SELECT id FROM workflow_exports WHERE task_id=? AND revision=?').get(id, task.revision)) phase = 'finalized';
      } catch { phase = 'needs_attention'; }
    }
    return { phase, current_job_id: current?.id ?? null, current_artifact_id: artifact?.id ?? null };
  }
}
