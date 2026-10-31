import { csvCells } from '@safehandoff/core-interface';
import { randomUUID } from 'node:crypto';
import type { Candidate, DisclosurePreview, Representation, Rule, Scope } from '@safehandoff/core-interface';
import { digest } from './artifact-render.ts';
import { deny } from './workflow-session.ts';
import type { LifecycleContext } from './lifecycle-types.ts';
export interface Intake { internal_title: string; project_id: string; purpose_id: string; recipient_id: string;
  audience: 'public' | 'named_external'; skill_ids: string[] }
export interface StoredRule extends Rule { goal_variant: string }
export class RuleStore {
  private readonly c: LifecycleContext;
  constructor(context: LifecycleContext) { this.c = context; }
  scope(id: string): Scope {
    const task = this.c.store.get(id), intake = this.intake(id);
    return { project_id: intake?.project_id ?? id, purpose_id: intake?.purpose_id ?? digest(task.context.purpose),
      recipient_id: intake?.recipient_id ?? digest(task.context.recipient), audience: intake?.audience ?? 'named_external', skill_set_hash: task.skill_set_hash };
  }
  intake(id: string): Intake | null {
    const row = this.c.db.prepare('SELECT payload_json FROM workflow_intake WHERE task_id=?').get(id);
    return row ? JSON.parse(String(row.payload_json)) : null;
  }
  saveIntake(id: string, value: Intake): void { this.c.db.prepare('INSERT INTO workflow_intake VALUES(?,?)').run(id, JSON.stringify(value)); }
  selector(id: string, candidate: Candidate): string | null { return this.recipe(id, candidate)?.selector ?? null; }
  private recipe(id: string, candidate: Candidate): { selector: string; counts: number[] } | null {
    const evidence = this.c.store.analysis.evidence(id), sources = this.c.store.analysis.sources(id);
    const refs = candidate.evidence_ids.map(ref => evidence.find(e => e.id === ref));
    if (refs.length < 2 || refs.some(e => !e || e.locator.kind !== 'csv_cell') ||
      new Set(refs.map(e => e!.source_version_id)).size !== 1 || new Set(refs.map(e => e!.locator.column)).size !== 1 ||
      new Set(refs.map(e => e!.locator.row)).size !== refs.length) return null;
    const first = refs[0]!, source = sources.find(s => s.id === first.source_version_id);
    if (!source || source.format !== 'csv' || evidence.filter(e => e.source_version_id === source.id && e.locator.column === first.locator.column).length !== refs.length) return null;
    const bytes = Buffer.from(source.raw_bytes, 'base64');
    if (digest(bytes) !== source.sha256) return null;
    const text = bytes.toString('utf8');
    let cells: ReturnType<typeof csvCells>;
    try { cells = csvCells(text).filter(c => c.column === first.locator.column); } catch { return null; }
    if (cells.length !== refs.length) return null;
    const counts: number[] = [];
    for (const cell of cells) {
      const start = Buffer.byteLength(text.slice(0, cell.start)), end = Buffer.byteLength(text.slice(0, cell.end));
      const e = refs.find(e => e!.locator.row === cell.row);
      if (!e || e.start !== start || e.end !== end || !/^(0|[1-9]\d*)$/.test(cell.value) || !Number.isSafeInteger(Number(cell.value)) ||
        digest(cell.value) !== e.locator.value_sha256) return null;
      counts.push(Number(cell.value));
    }
    return { selector: JSON.stringify({ schema_id: 'numeric-series.v1', source_slot: source.source_slot, column: first.locator.column }), counts };
  }
  private supported(rep: Representation): boolean {
    if (!rep || typeof rep !== 'object' || Array.isArray(rep) || Object.keys(rep).some(k => !['kind', 'transform_id', 'parameters'].includes(k)) ||
      rep.parameters !== undefined && (!rep.parameters || typeof rep.parameters !== 'object' || Array.isArray(rep.parameters))) return false;
    const p = rep.parameters ?? {};
    return rep.kind === 'derived_table' && (rep.transform_id === 'series_direction_only.v1' ? !Object.keys(p).length :
      rep.transform_id === 'series_index_base100.v1' && Object.keys(p).every(k => k === 'decimal_places') &&
      (p.decimal_places === undefined || (typeof p.decimal_places === 'number' && Number.isInteger(p.decimal_places) && p.decimal_places >= 0 && p.decimal_places <= 4)));
  }
  list(): StoredRule[] {
    return this.c.db.prepare(`SELECT r.payload_json,r.revoked_at FROM workflow_rules r JOIN
      (SELECT id,max(version) AS version FROM workflow_rules GROUP BY id) v ON r.id=v.id AND r.version=v.version ORDER BY r.id`).all()
      .map(row => ({ ...JSON.parse(String(row.payload_json)), revoked: row.revoked_at !== null }));
  }
  version(id: string, version: number): StoredRule {
    const row = this.c.db.prepare('SELECT payload_json,revoked_at FROM workflow_rules WHERE id=? AND version=?').get(id, version);
    if (!row) deny(404, 'RULE_NOT_FOUND'); return { ...JSON.parse(String(row.payload_json)), revoked: row.revoked_at !== null };
  }
  active(rule: StoredRule): boolean { return !rule.revoked && (rule.expires_at === null || Date.parse(rule.expires_at) > Date.parse(this.c.hooks.now())); }
  bindings(id: string): { decision_id: string; rule_id: string; rule_version: number }[] {
    return this.c.db.prepare(`SELECT r.decision_id,r.rule_id,r.rule_version FROM workflow_rule_decisions r JOIN workflow_current_decisions d
      ON d.task_id=r.task_id AND d.decision_id=r.decision_id WHERE r.task_id=? ORDER BY r.rule_id`).all(id) as never;
  }
  validateBindings(id: string): void {
    for (const ref of this.bindings(id)) if (!this.active(this.version(ref.rule_id, ref.rule_version))) deny(409, 'RULE_INVALIDATED');
  }
  save(id: string, revision: number, decisionId: string): StoredRule {
    const { store, hooks, db } = this.c;
    return hooks.transaction(() => {
      this.validateBindings(id);
      const task = store.assertRevision(id, revision), intake = this.intake(id);
      if (!intake) deny(422, 'RULE_SCOPE_REQUIRED');
      const d = store.effectiveAllows(id).find(d => d.id === decisionId);
      if (!d?.preview_id) deny(400, 'INVALID_DECISION');
      const preview = store.getPreview(id, d.preview_id), candidate = store.analysis.candidates(id).find(c => c.id === d.candidate_id)!;
      const recipe = this.recipe(id, candidate);
      if (!recipe || !this.supported(preview.representation)) deny(422, 'RULE_NOT_REUSABLE');
      const rule: StoredRule = { id: randomUUID(), version: 1, scope: this.scope(id), selector: recipe.selector,
        representation: preview.representation, expires_at: d.expires_at, revoked: false, goal_variant: task.context.goal_variant ?? 'default' };
      db.prepare('INSERT INTO workflow_rules VALUES(?,?,?,NULL)').run(rule.id, 1, JSON.stringify(rule)); return rule;
    });
  }
  update(id: string, expected: number, representation: Representation, expires: string | null): StoredRule {
    return this.c.hooks.transaction(() => {
      const rule = this.list().find(r => r.id === id); if (!rule) deny(404, 'RULE_NOT_FOUND');
      if (rule.version !== expected) deny(409, 'RULE_VERSION_CONFLICT');
      if (rule.revoked || !this.supported(representation) || (expires !== null && (!Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.parse(this.c.hooks.now())))) deny(400, 'INVALID_RULE');
      const value = { ...rule, version: expected + 1, representation, expires_at: expires };
      this.c.db.prepare('INSERT INTO workflow_rules VALUES(?,?,?,NULL)').run(id, value.version, JSON.stringify(value)); return value;
    });
  }
  revoke(id: string, expected: number): { id: string; affected_tasks: string[] } {
    const { db, hooks, store } = this.c;
    return hooks.transaction(() => {
      const rule = this.list().find(r => r.id === id); if (!rule) deny(404, 'RULE_NOT_FOUND');
      if (rule.version !== expected) deny(409, 'RULE_VERSION_CONFLICT');
      db.prepare('UPDATE workflow_rules SET revoked_at=coalesce(revoked_at,?) WHERE id=?').run(hooks.now(), id);
      const affected = db.prepare(`SELECT DISTINCT r.task_id FROM workflow_rule_decisions r JOIN workflow_current_decisions c
        ON c.task_id=r.task_id AND c.decision_id=r.decision_id WHERE r.rule_id=?`).all(id).map(r => String(r.task_id));
      for (const taskId of affected) {
        db.prepare(`UPDATE workflow_decisions SET revoked_at=? WHERE task_id=? AND revoked_at IS NULL AND id IN
          (SELECT decision_id FROM workflow_rule_decisions WHERE task_id=? AND rule_id=?)`).run(hooks.now(), taskId, taskId, id);
        hooks.advance(store.get(taskId));
      }
      return { id, affected_tasks: affected };
    });
  }
  private projection(rep: Representation, counts: number[]): DisclosurePreview['projection'] {
    if (rep.transform_id === 'series_direction_only.v1') return { statement: '', columns: ['observation', 'direction'],
      rows: counts.map((n, i) => [String(i + 1), i === 0 ? '기준' : n > counts[i - 1]! ? '증가' : n < counts[i - 1]! ? '감소' : '동일']) };
    if (!counts[0]) deny(422, 'INDEX_BASELINE_ZERO');
    const places = Number(rep.parameters?.decimal_places ?? 0), baseline = BigInt(counts[0]!);
    return { statement: '', columns: ['index'], rows: counts.map(n => {
      const v = ((2n * BigInt(n) * 100n * 10n ** BigInt(places) + baseline) / (2n * baseline)).toString().padStart(places + 1, '0');
      return [places ? v.slice(0, -places) + '.' + v.slice(-places) : v];
    }) };
  }
  // Called inside candidate adoption, before its revision snapshot is written.
  autoApply(id: string, targetRevision: number, selected?: { id: string; version: number }[]): number {
    const { store, db, hooks } = this.c, task = store.get(id), scope = this.scope(id);
    if (!this.intake(id)) { if (selected?.length) deny(422, 'RULE_SCOPE_REQUIRED'); return 0; }
    const latest = this.list(), rules = selected ? selected.map(ref => {
      const rule = latest.find(r => r.id === ref.id && r.version === ref.version); if (!rule || !this.active(rule)) deny(409, 'RULE_INVALIDATED'); return rule;
    }) : latest.filter(r => this.active(r));
    const candidates = db.prepare('SELECT payload_json FROM workflow_candidates WHERE task_id=? AND set_id=?').all(id, task.current_candidate_set_id)
      .map(r => JSON.parse(String(r.payload_json)) as Candidate);
    let count = 0; const used = new Set<string>();
    for (const c of candidates) {
      const recipe = this.recipe(id, c); if (!recipe) continue;
      const matches = rules.filter(r => r.selector === recipe.selector && JSON.stringify(r.scope) === JSON.stringify(scope) && r.goal_variant === (task.context.goal_variant ?? 'default'));
      if (!matches.length) continue;
      let projections: { r: StoredRule; projection: DisclosurePreview['projection'] }[];
      try { projections = matches.map(r => ({ r, projection: this.projection(r.representation, recipe.counts) })); }
      catch (error) {
        if (selected) throw error;
        db.prepare('INSERT INTO workflow_events(task_id,revision,kind,created_at) VALUES(?,?,?,?)').run(id, targetRevision, 'rule_transform_failed', hooks.now()); continue;
      }
      if (new Set(projections.map(p => JSON.stringify(p.projection))).size > 1) {
        if (selected) deny(409, 'RULE_CONFLICT');
        db.prepare('INSERT INTO workflow_events(task_id,revision,kind,created_at) VALUES(?,?,?,?)').run(id, targetRevision, 'rule_conflict', hooks.now()); continue;
      }
      const first = projections[0]!, projectionHash = digest(JSON.stringify(first.projection)), previewId = randomUUID(), decisionId = randomUUID();
      const preview: DisclosurePreview = { schema_version: 'disclosure_preview.v1', preview_id: previewId, candidate_id: c.local_key,
        input_revision: targetRevision, representation: first.r.representation, projection: first.projection, projection_sha256: projectionHash, raw_grants: [] };
      db.prepare('INSERT INTO workflow_previews VALUES(?,?,?,?,?,?,?,?)').run(id, previewId, c.local_key, targetRevision,
        Buffer.from(JSON.stringify(first.projection)), projectionHash, task.source_set_hash, digest(JSON.stringify(task.context)));
      db.prepare('INSERT INTO workflow_preview_payloads VALUES(?,?,?)').run(id, previewId, JSON.stringify(preview));
      const old = db.prepare('SELECT decision_id FROM workflow_current_decisions WHERE task_id=? AND candidate_id=?').get(id, c.local_key);
      db.prepare('INSERT INTO workflow_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, decisionId, c.local_key, targetRevision, 'allow', previewId,
        old?.decision_id ?? null, first.r.expires_at, null, hooks.now());
      db.prepare(`INSERT INTO workflow_current_decisions VALUES(?,?,?) ON CONFLICT(task_id,candidate_id) DO UPDATE SET decision_id=excluded.decision_id`).run(id, c.local_key, decisionId);
      for (const r of matches) { used.add(r.id); db.prepare('INSERT INTO workflow_rule_decisions VALUES(?,?,?,?)').run(id, decisionId, r.id, r.version); }
      count++;
    }
    if (selected && (used.size !== selected.length || new Set(selected.map(r => r.id)).size !== selected.length)) deny(409, 'RULE_NOT_APPLICABLE');
    return count;
  }
  apply(id: string, revision: number, refs: { id: string; version: number }[]) {
    return this.c.hooks.transaction(() => {
      const task = this.c.store.assertRevision(id, revision); if (!Array.isArray(refs) || !refs.length || refs.length > 100 || refs.some(r => !r || typeof r.id !== 'string' || !Number.isSafeInteger(r.version) || r.version < 1 || Object.keys(r).sort().join(',') !== 'id,version')) deny(400, 'INVALID_RULE');
      this.autoApply(id, revision + 1, refs); return this.c.hooks.advance(task);
    });
  }
}
