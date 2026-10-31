// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDirectRegexRedaction, countForbiddenHits, runValueComparison } from './value-comparison.mjs';

test('3-way value comparison verifies Direct Regex vs Raw AI vs SafeHandoff across all 10 cases', async () => {
  const report = await runValueComparison();
  assert.equal(report.schema_version, 'value_comparison_report.v1');
  assert.equal(report.human_stopwatch_measured, false);
  assert.equal(report.totals.cases, 10);
  assert.equal(report.totals.forbidden_total, 48);
  assert.equal(report.totals.required_total, 32);

  // 1. Direct pattern-only redaction leaves domain/business secrets in all 10 cases (41/48 leaked)
  assert.equal(report.totals.direct_regex_cases_with_leaks, 10);
  assert.equal(report.totals.direct_regex_leaks, 41);

  // 2. Raw unreviewed AI exposes all 48 forbidden items in prompt payload and 35 in unfiltered candidate output
  assert.equal(report.totals.raw_ai_payload_leaks, 48);
  assert.equal(report.totals.raw_ai_output_leaks, 35);

  // 3. SafeHandoff pipeline exposes 0/48 forbidden items in writer payload and output, passes 10/10, and blocks expired rules 10/10
  assert.equal(report.totals.safehandoff_payload_leaks, 0);
  assert.equal(report.totals.safehandoff_output_leaks, 0);
  assert.equal(report.totals.safehandoff_passed_cases, 10);
  assert.equal(report.totals.safehandoff_expired_blocked, 10);

  // 4. Deterministic numerical transforms match 100/141/212 and baseline/decrease/increase
  assert.deepEqual(
    report.transforms.index_base100_rows.map(row => row[0]),
    ['100', '141', '212'],
  );
  assert.deepEqual(
    report.transforms.direction_reuse_rows.map(row => row[1]),
    ['기준', '감소', '증가'],
  );
});

test('applyDirectRegexRedaction masks fixed tokens/IP/phone while preserving domain text for inspection', () => {
  const sample = 'ip=192.0.2.17 phone=010-0000-1234 token=DEMO_SECRET_101 store=한빛마켓 count=3,120';
  const redacted = applyDirectRegexRedaction(sample);
  assert.deepEqual(countForbiddenHits(redacted, ['192.0.2.17', '010-0000-1234', 'DEMO_SECRET_101']), []);
  assert.deepEqual(countForbiddenHits(redacted, ['한빛마켓', '3,120']), ['한빛마켓', '3,120']);
});
