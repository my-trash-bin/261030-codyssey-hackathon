import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { composeFactPack, groundFacts } from '@safehandoff/core-interface';
import type { FactPack, ModelClient, ModelRequest, ReviewGroundingContext, Rule } from '@safehandoff/core-interface';
import { RealCore } from './index.ts';
import { reviewGroundingFixture } from './test-fixtures.ts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = JSON.parse(readFileSync(new URL('../../../config.example.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-10-31T00:00:00Z');
function setup(reused = false) {
  const pack: FactPack = { schema_version: 'fact_pack.v1', task_revision: 1, template_id: 'vendor_support.v1', audience_type: 'named_external',
    output_language: 'ko', approved_brief: '', facts: [{ id: 'f1', kind: 'observation', statement: 'approved summary', uncertainty: 'observed' }],
    required_fact_ids: ['f1'], tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
  const grounding = reviewGroundingFixture(pack);
  if (reused) {
    const representation = { kind: 'fact_summary' as const, transform_id: 'series_fact_summary.v1', parameters: {} };
    const d = grounding.input.decisions[0]!; d.applied_rule_id = 'rule-1'; d.applied_rule_version = 2; d.representation = representation;
    grounding.input.previews[0]!.representation = representation;
    const rule: Rule = { id: 'rule-1', version: 2, scope: structuredClone(grounding.scope), selector: 'requests_v1/count',
      representation, expires_at: null, revoked: false };
    grounding.input.rules = [rule]; grounding.candidate_selectors.f1 = rule.selector;
    grounding.rule_goals = [{ rule_id: rule.id, rule_version: rule.version, goal_variant: 'default' }];
  }
  const requests: ModelRequest[] = [];
  const model: ModelClient = { info: { provider: 'fake', model: 'test', ready: true }, async complete(request) {
    requests.push(request);
    return { text: JSON.stringify(request.role === 'writer' ? { schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'approved summary', fact_ids: ['f1'] }] } :
      { schema_version: 'review.v1', result: 'pass', issues: [] }), model: 'test', usage: { inputTokens: null, outputTokens: null } };
  } };
  return { pack, grounding, requests, model, core: new RealCore(model, config, undefined, () => now) };
}
test('fresh and valid reused decisions produce grounded review summaries without leaking authority to writer', async () => {
  for (const reused of [false, true]) {
    const { pack, grounding, core, requests } = setup(reused);
    const result = await core.writeReviewed(pack, { grounding }); assert.equal(result.review.result, 'pass');
    const reviewer = JSON.parse(requests[1]!.input); assert.equal(reviewer.grounding[0].source, reused ? 'reused_rule' : 'fresh_decision');
    if (reused) { assert.equal(reviewer.grounding[0].rule_id, 'rule-1'); assert.equal(reviewer.grounding[0].rule_version, 2); }
    assert(!requests[0]!.input.includes('rule-1')); assert(!requests[0]!.input.includes('fictional-project'));
  }
});
test('missing grounding is needs_decision before any model call, including a model that would pass', async () => {
  const { core, pack, requests } = setup();
  const result = await core.writeReviewed(pack); assert.equal(result.review.result, 'needs_decision'); assert.equal(result.draft.blocks.length, 0);
  const reviewed = await core.review({ schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: 'approved', fact_ids: ['f1'] }] }, pack);
  assert.equal(reviewed.result, 'needs_decision'); assert.equal(reviewed.issues[0]!.reason_code, 'NEEDS_DISCLOSURE_DECISION');
  assert.equal(requests.length, 0);
});
test('invalid rule evidence and scope/source/goal/version/expiry states all deny before writer or reviewer', async () => {
  const mutations: ((context: ReviewGroundingContext) => void)[] = [
    c => { c.input.rules = []; }, c => { c.input.rules[0]!.version = 1; }, c => { c.input.rules[0]!.revoked = true; },
    c => { c.input.rules[0]!.expires_at = '2026-10-31T00:00:00Z'; }, c => { c.input.rules[0]!.expires_at = 'invalid'; },
    c => { c.input.rules[0]!.expires_at = '2099-02-30T00:00:00Z'; },
    c => { c.input.rules[0]!.scope.recipient_id = 'other'; }, c => { c.input.rules[0]!.scope.skill_set_hash = 'b'.repeat(64); },
    c => { c.input.rules[0]!.representation.parameters = { decimal_places: 1 }; }, c => { c.candidate_selectors = {}; },
    c => { c.rule_goals = []; }, c => { c.rule_goals[0]!.goal_variant = 'observations_only'; },
    c => { c.input.decisions[0]!.scope = undefined; }, c => { c.input.decisions[0]!.source_set_hash = 'b'.repeat(64); },
    c => { c.input.decisions[0]!.revoked = true; }, c => { c.input.decisions[0]!.expires_at = '2026-10-30T00:00:00Z'; },
    c => { c.input.previews[0]!.input_revision = 0; }, c => { c.input.rules.push(c.input.rules[0]!); },
    c => { c.input.rules.push({ ...c.input.rules[0]!, version: 1, revoked: true }); },
    c => { delete (c.input.decisions[0] as any).applied_rule_id; },
  ];
  for (const mutate of mutations) {
    const { pack, grounding, core, requests } = setup(true); mutate(grounding);
    const result = await core.writeReviewed(pack, { grounding }); assert.equal(result.review.result, 'needs_decision'); assert.equal(requests.length, 0);
  }
});
test('exact raw and actual selected fields can never use reusable rules even with a matching rule', async () => {
  for (const kind of ['exact_value', 'approved_excerpt', 'selected_fields'] as const) {
    const { pack, grounding, core, requests } = setup(true);
    grounding.input.decisions[0]!.representation.kind = kind;
    grounding.input.rules[0]!.representation.kind = kind;
    grounding.input.previews[0]!.representation.kind = kind;
    assert.throws(() => composeFactPack(grounding.input, now));
    assert.equal((await core.writeReviewed(pack, { grounding })).review.result, 'needs_decision'); assert.equal(requests.length, 0);
  }
});
test('fresh marker cannot hide missing source binding or mutate facts under an unchanged preview hash', async () => {
  const { pack, grounding, core, requests } = setup();
  const changed = 'new unapproved statement';
  pack.facts[0]!.statement = changed; grounding.input.previews[0]!.projection.statement = changed;
  // Same old hash in both preview and decision still must not validate changed projection bytes.
  assert.equal((await core.writeReviewed(pack, { grounding })).review.result, 'needs_decision'); assert.equal(requests.length, 0);
  grounding.input.previews[0]!.projection_sha256 = hash(grounding.input.previews[0]!.projection);
  assert.equal((await core.writeReviewed(pack, { grounding })).review.result, 'needs_decision');
});
test('expiry during model execution overrides even an otherwise valid passing review', async () => {
  const { pack, grounding, model } = setup(true);
  let clock = now, calls = 0;
  grounding.input.rules[0]!.expires_at = new Date(now + 1000).toISOString();
  const delayed: ModelClient = { info: model.info, async complete(request, options) {
    calls++; const response = await model.complete(request, options); if (request.role === 'reviewer') clock += 1000; return response;
  } };
  const core = new RealCore(delayed, config, undefined, () => clock);
  assert.equal((await core.writeReviewed(pack, { grounding })).review.result, 'needs_decision'); assert.equal(calls, 2);
});
test('wire fact pack shape stays unchanged and grounding summaries are derived separately', () => {
  const { grounding, pack } = setup(true);
  assert.equal(groundFacts(grounding, pack, now)[0]!.source, 'reused_rule');
  assert.equal(Object.hasOwn(pack, 'grounding'), false);
  assert.throws(() => groundFacts(grounding, { ...pack, public_tool_results: [{ status: 'reproduced', reason_code: 'invented' }] }, now));
  assert.throws(() => groundFacts(grounding, { ...pack, public_tool_results: [undefined] as never }, now));
});
