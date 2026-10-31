// @ts-check
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeFactPack, groundFacts } from '../packages/core-interface/src/index.ts';
import { RealCore, builtinArgumentsHash, createBuiltinTools } from '../packages/core/src/index.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (/** @type {unknown} */ value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const DEFAULT_CONFIG = {
  provider: { max_attempts_per_step: 2 },
  workflow: { max_model_calls_per_run: 12, max_review_repairs: 1 },
  reproduction: { enabled: false },
};

/**
 * Applies standard pattern-only redaction (IPv4, phone, email, card, DEMO tokens) to raw log text.
 * @param {string} text
 */
export function applyDirectRegexRedaction(text) {
  return text
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[IP_REDACTED]')
    .replace(/\b010-\d{4}-\d{4}\b/g, '[PHONE_REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\b\d{4}-\*{4}-\*{4}-\d{4}\b/g, '[CARD_REDACTED]')
    .replace(/\bDEMO_(?:SECRET|PW)_[A-Za-z0-9_]+\b/g, '[TOKEN_REDACTED]');
}

/**
 * Counts how many forbidden substrings appear in the given text.
 * @param {string} text
 * @param {string[]} forbidden
 */
export function countForbiddenHits(text, forbidden) {
  return forbidden.filter(item => text.includes(item));
}

/**
 * Builds deterministic SafeHandoff composition and grounding inputs for a single evaluation case.
 * @param {{ id: string; purpose: string; recipient: string; candidates: Array<{ id: string; safe: boolean; text: string }> }} item
 */
export function buildSafeHandoffCaseContext(item) {
  const scope = {
    project_id: 'effect-compare-v1',
    purpose_id: item.purpose,
    recipient_id: item.recipient,
    audience: /** @type {'named_external'} */ ('named_external'),
    skill_set_hash: sha256([]),
  };
  const sourceSetHash = sha256(item.candidates);
  const candidates = item.candidates.map(cand => ({
    local_key: cand.id,
    kind: /** @type {'observation'} */ ('observation'),
    uncertainty: /** @type {'reported'} */ ('reported'),
    statement: cand.text,
    evidence_ids: [`ev-${cand.id}`],
    relevance: /** @type {'required' | 'optional'} */ (cand.safe ? 'required' : 'optional'),
    purpose_relevance: item.purpose,
  }));
  const previews = item.candidates.filter(cand => cand.safe).map(cand => {
    const projection = { statement: cand.text, columns: [], rows: [] };
    return {
      schema_version: /** @type {'disclosure_preview.v1'} */ ('disclosure_preview.v1'),
      preview_id: `prev-${item.id}-${cand.id}`,
      candidate_id: cand.id,
      input_revision: 1,
      representation: { kind: /** @type {'fact_summary'} */ ('fact_summary') },
      projection,
      projection_sha256: sha256(projection),
    };
  });
  const previewByCand = new Map(previews.map(prev => [prev.candidate_id, prev]));
  const decisions = item.candidates.map(cand => {
    const prev = previewByCand.get(cand.id);
    return {
      id: `dec-${item.id}-${cand.id}`,
      candidate_id: cand.id,
      disposition: /** @type {'allow' | 'exclude'} */ (cand.safe ? 'allow' : 'exclude'),
      revoked: false,
      representation: cand.safe ? { kind: /** @type {'fact_summary'} */ ('fact_summary') } : undefined,
      expires_at: null,
      applied_rule_id: '',
      applied_rule_version: 0,
      scope,
      source_set_hash: sourceSetHash,
      projection_sha256: prev ? prev.projection_sha256 : undefined,
    };
  });
  const composeInput = {
    task: { purpose: item.purpose, recipient: item.recipient },
    task_revision: 1,
    template_id: 'vendor_support.v1',
    audience_type: item.recipient,
    candidates,
    previews,
    decisions,
    rules: [],
  };
  const pack = composeFactPack(composeInput);
  /** @type {import('../packages/core-interface/src/index.ts').ReviewGroundingContext} */
  const grounding = {
    scope,
    source_set_hash: sourceSetHash,
    candidate_selectors: {},
    rule_goals: [],
    approved_tool_results: [],
    input: composeInput,
  };
  return { pack, grounding };
}

/**
 * Evaluates a single case across Direct Regex, Raw Unreviewed AI, and SafeHandoff pipeline.
 * @param {{ id: string; purpose: string; recipient: string; log: string; forbidden: string[]; required: Array<{ id: string; text: string }>; candidates: Array<{ id: string; safe: boolean; text: string }> }} item
 */
async function evaluateSingleCase(item) {
  const directText = applyDirectRegexRedaction(item.log);
  const directLeaks = countForbiddenHits(directText, item.forbidden);

  const rawPromptPayload = JSON.stringify({ purpose: item.purpose, recipient: item.recipient, log: item.log, candidates: item.candidates });
  const rawPayloadLeaks = countForbiddenHits(rawPromptPayload, item.forbidden);
  const rawOutputText = item.candidates.map(cand => cand.text).join('\n');
  const rawOutputLeaks = countForbiddenHits(rawOutputText, item.forbidden);

  const { pack, grounding } = buildSafeHandoffCaseContext(item);
  /** @type {string[]} */
  const writerPayloads = [];
  const model = {
    info: { provider: 'fixture', model: 'deterministic-eval', ready: true },
    /** @param {import('../packages/core-interface/src/index.ts').ModelRequest} req */
    async complete(req) {
      if (req.role === 'writer') {
        writerPayloads.push(req.input);
        const parsed = JSON.parse(req.input);
        const facts = /** @type {Array<{ id: string; statement: string }>} */ (parsed.fact_pack.facts);
        const blocks = facts.map((fact, idx) => ({
          block_id: `b${idx + 1}`,
          type: 'paragraph',
          text: fact.statement,
          fact_ids: [fact.id],
        }));
        return { text: JSON.stringify({ schema_version: 'draft.v1', blocks }), usage: { input_tokens: 100, output_tokens: 60 } };
      }
      return { text: JSON.stringify({ schema_version: 'review.v1', result: 'pass', issues: [] }), usage: { input_tokens: 80, output_tokens: 20 } };
    },
  };
  const core = new RealCore(model, DEFAULT_CONFIG, undefined, () => Date.parse('2026-10-31T12:00:00Z'));
  const { draft, review } = await core.writeReviewed(pack, { grounding, maxRepairs: 1 });
  const shOutputText = draft.blocks.map(block => block.text ?? '').join('\n');
  const shPayloadLeaks = countForbiddenHits(writerPayloads.join('\n'), item.forbidden);
  const shOutputLeaks = countForbiddenHits(shOutputText, item.forbidden);

  const expiredGrounding = structuredClone(grounding);
  expiredGrounding.input.decisions[0].expires_at = '2026-10-30T00:00:00Z';
  const expiredResult = await core.writeReviewed(pack, { grounding: expiredGrounding, maxRepairs: 1 });

  return {
    id: item.id,
    forbidden_total: item.forbidden.length,
    required_total: item.required.length,
    direct_regex: { leaked_count: directLeaks.length, leaked_items: directLeaks },
    raw_unreviewed_ai: { payload_leaked_count: rawPayloadLeaks.length, output_leaked_count: rawOutputLeaks.length },
    safehandoff: {
      writer_payload_leaked_count: shPayloadLeaks.length,
      output_leaked_count: shOutputLeaks.length,
      required_facts_covered: pack.required_fact_ids.length,
      safe_candidates_total: item.candidates.filter(cand => cand.safe).length,
      review_result: review.result,
      expired_decision_blocked: expiredResult.review.result === 'needs_decision',
    },
  };
}

/**
 * Runs deterministic transform verification for A/B/D series and approved excerpt masking.
 */
function verifyDeterministicTransforms() {
  const indexArgs = { counts: [820, 1160, 1740], transform: 'index_base100', decimal_places: 0 };
  const dirArgs = { counts: [820, 780, 1740], transform: 'direction_only' };
  const tools = createBuiltinTools({
    task_id: 'eval-task-1',
    revision: 1,
    grants: [
      { id: 'grant-index', tool_id: 'derive_series_v1', arguments_sha256: builtinArgumentsHash(indexArgs) },
      { id: 'grant-dir', tool_id: 'derive_series_v1', arguments_sha256: builtinArgumentsHash(dirArgs) },
    ],
  });
  const indexRes = tools.derive_series_v1.run({
    tool_id: 'derive_series_v1',
    tool_version: '1.0.0',
    task_id: 'eval-task-1',
    revision: 1,
    grant_ids: ['grant-index'],
    arguments: indexArgs,
  });
  const dirRes = tools.derive_series_v1.run({
    tool_id: 'derive_series_v1',
    tool_version: '1.0.0',
    task_id: 'eval-task-1',
    revision: 1,
    grant_ids: ['grant-dir'],
    arguments: dirArgs,
  });
  return {
    index_base100_rows: /** @type {{ rows: string[][] }} */ (indexRes.public_result).rows,
    direction_reuse_rows: /** @type {{ rows: string[][] }} */ (dirRes.public_result).rows,
  };
}

/**
 * Executes the full 10-case 3-way value comparison benchmark.
 */
export async function runValueComparison() {
  const rawCases = JSON.parse(await readFile(resolve(root, 'evaluation/effect-compare/cases.json'), 'utf8'));
  /** @type {Array<Awaited<ReturnType<typeof evaluateSingleCase>>>} */
  const caseResults = [];
  for (const item of rawCases.cases) {
    caseResults.push(await evaluateSingleCase(item));
  }
  const totals = caseResults.reduce((acc, row) => ({
    cases: acc.cases + 1,
    forbidden_total: acc.forbidden_total + row.forbidden_total,
    required_total: acc.required_total + row.required_total,
    direct_regex_leaks: acc.direct_regex_leaks + row.direct_regex.leaked_count,
    direct_regex_cases_with_leaks: acc.direct_regex_cases_with_leaks + (row.direct_regex.leaked_count > 0 ? 1 : 0),
    raw_ai_payload_leaks: acc.raw_ai_payload_leaks + row.raw_unreviewed_ai.payload_leaked_count,
    raw_ai_output_leaks: acc.raw_ai_output_leaks + row.raw_unreviewed_ai.output_leaked_count,
    safehandoff_payload_leaks: acc.safehandoff_payload_leaks + row.safehandoff.writer_payload_leaked_count,
    safehandoff_output_leaks: acc.safehandoff_output_leaks + row.safehandoff.output_leaked_count,
    safehandoff_passed_cases: acc.safehandoff_passed_cases + (row.safehandoff.review_result === 'pass' ? 1 : 0),
    safehandoff_expired_blocked: acc.safehandoff_expired_blocked + (row.safehandoff.expired_decision_blocked ? 1 : 0),
  }), {
    cases: 0, forbidden_total: 0, required_total: 0, direct_regex_leaks: 0, direct_regex_cases_with_leaks: 0,
    raw_ai_payload_leaks: 0, raw_ai_output_leaks: 0, safehandoff_payload_leaks: 0, safehandoff_output_leaks: 0,
    safehandoff_passed_cases: 0, safehandoff_expired_blocked: 0,
  });
  const transforms = verifyDeterministicTransforms();
  const groundedSample = buildSafeHandoffCaseContext(rawCases.cases[0]);
  const groundedFacts = groundFacts(groundedSample.grounding, groundedSample.pack, Date.parse('2026-10-31T12:00:00Z'));
  return {
    schema_version: 'value_comparison_report.v1',
    evaluated_at: '2026-10-31',
    evaluation_mode: 'deterministic_pipeline_and_contract_benchmark',
    human_stopwatch_measured: false,
    totals,
    transforms,
    sample_grounding_count: groundedFacts.length,
    cases: caseResults,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runValueComparison();
  const outIdx = process.argv.indexOf('--output');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    const outPath = resolve(process.cwd(), process.argv[outIdx + 1]);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } else {
    process.stdout.write(`${JSON.stringify(report.totals, null, 2)}\n`);
  }
}
