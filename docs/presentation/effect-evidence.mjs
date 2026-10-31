// @ts-check
// Local presentation evidence. Uses fixed model responses and synthetic cases; never calls an API.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildSafeHandoffCaseContext, runValueComparison } from '../../tools/value-comparison.mjs';
import { RealCore } from '../../packages/core/src/index.ts';

export async function collectEffectEvidence() {
  const cases = JSON.parse(await readFile(new URL('../../evaluation/effect-compare/cases.json', import.meta.url), 'utf8')).cases;
  const comparison = await runValueComparison();
  const perCase = [];
  for (const item of cases) {
    const { pack, grounding } = buildSafeHandoffCaseContext(item);
    assert(pack.required_fact_ids.length > 1, 'One required fact can be omitted while keeping a nonempty document.');
    const omittedId = pack.required_fact_ids.at(-1);
    const requests = [];
    const model = {
      info: { provider: 'fixture', model: 'deliberate-omission-and-false-pass', ready: true },
      async complete(request) {
        requests.push(request.role);
        if (request.role === 'writer') {
          return { text: JSON.stringify({ schema_version: 'draft.v1', blocks: pack.facts
            .filter(fact => fact.id !== omittedId)
            .map(fact => ({ type: 'paragraph', text: fact.statement, fact_ids: [fact.id] })) }) };
        }
        // The validator must reject a missing required reference even when the reviewer says pass.
        return { text: JSON.stringify({ schema_version: 'review.v1', result: 'pass', issues: [] }) };
      },
    };
    const core = new RealCore(model, {
      provider: { max_attempts_per_step: 1 },
      workflow: { max_model_calls_per_run: 2, max_review_repairs: 0 },
      reproduction: { enabled: false },
    }, undefined, () => Date.parse('2026-10-31T12:00:00Z'));
    const result = await core.writeReviewed(pack, { grounding, maxRepairs: 0 });
    const detected = result.review.result === 'needs_changes' && result.review.issues.some(issue =>
      issue.reason_code === 'MISSING_REQUIRED_FACT' && issue.approved_fact_ids.includes(omittedId));
    assert(detected, `${item.id}: omitted required reference must trigger a change request.`);
    assert.deepEqual(requests, ['writer', 'reviewer']);
    perCase.push({ case_id: item.id, approved_fact_count: pack.facts.length,
      omitted_required_references: 1, result: result.review.result, detected });
  }
  assert.equal(comparison.totals.cases, 10);
  assert.equal(comparison.totals.forbidden_total, 48);
  assert.equal(comparison.totals.direct_regex_leaks, 41);
  assert.equal(comparison.totals.safehandoff_payload_leaks, 0);
  assert.equal(comparison.totals.safehandoff_output_leaks, 0);
  assert.equal(comparison.totals.safehandoff_expired_blocked, 10);
  const minutesSaved = 10 - 5;
  const monthlyCases = 100;
  const hourlyWorkValue = 30000;
  const grossMonthlyWorkValue = monthlyCases * minutesSaved * hourlyWorkValue / 60;
  assert.equal(grossMonthlyWorkValue, 250000);
  return {
    schema_version: 'presentation_effect_evidence.v1',
    executed_at: new Date().toISOString(),
    mode: 'synthetic_cases_fixed_model_responses',
    fixture_clock: '2026-10-31T12:00:00Z',
    actual_api_calls: 0,
    human_task_time_measured: false,
    actual_operating_cost_measured: false,
    comparison_totals: comparison.totals,
    required_reference_omission: { cases: perCase.length,
      detected: perCase.filter(row => row.detected).length,
      approved_facts_total: perCase.reduce((sum, row) => sum + row.approved_fact_count, 0),
      meaning: 'One required fact reference is removed per case; a false passing model review is overridden by the validator.',
      cases_detail: perCase },
    time_and_cost_assumptions: {
      human_stage_minutes_direct: [4, 4, 2], human_stage_minutes_safehandoff: [2, 1, 2],
      monthly_cases: monthlyCases, hourly_work_value_krw: hourlyWorkValue,
      monthly_hours_reclaimed: monthlyCases * minutesSaved / 60,
      gross_monthly_work_value_krw: grossMonthlyWorkValue,
      break_even_incremental_cost_per_case_krw: minutesSaved * hourlyWorkValue / 60,
      excluded_costs: 'API, incremental infrastructure, operations labor and monthly amortized introduction cost must all be deducted.',
    },
    limitations: [
      'Candidates, public projections and disclosure decisions are prepared in advance.',
      'The fixed writer copies approved facts; the fixed reviewer says pass. No live model accuracy is measured.',
      'Forbidden items are exact substrings. Reference coverage does not establish semantic completeness.',
      'The answer key lists 32 semantic clues, while composed packs contain 26 approved facts. These are different units.',
      'No human timing, real deployment, actual billing or avoided incidents are measured.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await collectEffectEvidence();
  const output = new URL('./effect-evidence.json', import.meta.url);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ cases: report.comparison_totals.cases,
    forbidden_output_regex: report.comparison_totals.direct_regex_leaks,
    forbidden_output_safehandoff: report.comparison_totals.safehandoff_output_leaks,
    required_reference_omissions_detected: report.required_reference_omission.detected,
    gross_monthly_work_value_krw_assumed: report.time_and_cost_assumptions.gross_monthly_work_value_krw }));
}
