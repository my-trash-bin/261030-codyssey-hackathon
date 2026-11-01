// @ts-check
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { RealCore, builtinArgumentsHash, createBuiltinTools } from '../packages/core/dist/index.js';
import { composeFactPack, judgeReproduction } from '../packages/core-interface/dist/index.js';
import { DockerReproRunner, reproductionRequest } from '../packages/sandbox-runner/dist/index.js';
import { OpenAICompatibleModelClient } from '../packages/model-adapter/dist/index.js';
import { selectToyrecordPack } from './toyrecord-pack.mts';
import { loadConfig, configuredTranscripts } from '../packages/app/dist/config.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceNames = ['app-log.txt', 'incident-notes.md', 'observations.csv', 'sample-input.json'];

export async function runOssReproSmoke({ image, runnerFactory, model, config, seed = 42, transcripts = undefined, selection = undefined }) {
  if (selection) assert.equal(selection.image, image, 'TOYRECORD_INSTALLATION_MISMATCH');
  const spec = selection?.specification;
  const sources = await Promise.all(sourceNames.map(async name => readFile(resolve(root, 'fixtures/reference-pack/author/oss-encoding', name), 'utf8')));
  assert(sources[0].includes('stage=encode code=E_ENCODE_SHORT_BUFFER'));
  assert(sources[2].includes('observed_ascii,ascii,6,6,passed,ok,true'));
  assert(sources[2].includes('observed_multibyte,hangul,7,21,passed,E_ENCODE_SHORT_BUFFER,false'));
  const forbidden = [...sources[0].matchAll(/(?:input|customer|auth_marker|internal_path)="([^"]+)"/g)].map(match => match[1]);
  const args = { seed, codepoint_count: spec?.codepoint_count ?? 6 }, toolId = 'make_synthetic_inputs_v1';
  const authority = { task_id: 'oss-smoke-fixture', revision: 1,
    grants: [{ id: 'fixture-synthetic', tool_id: toolId, arguments_sha256: builtinArgumentsHash(args) }] };
  const synthetic = createBuiltinTools(authority)[toolId].run({ tool_id: toolId, tool_version: '1.0.0',
    task_id: authority.task_id, revision: 1, grant_ids: ['fixture-synthetic'], arguments: args });
  assert.equal(synthetic.status, 'ok');
  const generated = synthetic.public_result;
  const registration = { image, target_pair_id: spec?.target_pair_id ?? 'toyrecord.sandbox-observation.v1', synthetic_input_set_id: `synthetic-${seed}-6`, inputs: generated.inputs, seed };
  const runner = runnerFactory ? runnerFactory(registration) : new DockerReproRunner(registration);
  const reproduction = await runner.reproduce(reproductionRequest(registration));
  const baseReport = { schema_version: 'oss_smoke.v1', executed_at: new Date().toISOString(),
    analysis: 'fixture assertions and manually constructed candidates; analyze() not invoked',
    decisions: 'fixture-only predefined approvals; no human approval UI',
    model_mode: model.info.provider === 'fake' ? 'fixture' : 'live', runner: runner.info.implementation,
    document_status: 'reviewed_draft_not_finalized', manual_review_required: true,
    source_hashes: sources.map((bytes, i) => ({ file: sourceNames[i], sha256: hash(bytes) })),
    selected_pack: selection ? { ...selection.pack, target_pair_id: spec.target_pair_id, skill_set_hash: selection.skill_set_hash } : null,
    synthetic: generated, reproduction, goal_variant: 'reproduction_evidence' };
  if (reproduction.status !== 'reproduced') return { ...baseReport, completed: false, review: null, document: null, calls: [] };
  assert.equal(reproduction.runs.length, 4, 'INVALID_REPRO_MATRIX');
  assert.equal(judgeReproduction(reproduction.runs).status, 'reproduced', 'INVALID_REPRO_MATRIX');
  const executionSummary = { targets: 2, inputs: 2, total_runs: reproduction.runs.length, runs_per_combination: 1 };
  const statements = [
    '가상 toyrecord 관찰에서 ASCII 저장은 성공했고 한글 입력은 encode 단계의 E_ENCODE_SHORT_BUFFER 오류로 실패했습니다.',
    '의도적인 toy 결함의 buggy/fixed 두 버전과 새 길이 6의 ASCII/한글 두 입력의 네 조합을 각 한 번씩, 총 4회 실행했습니다. 고정 관찰 조건의 재현을 확인했습니다.',
    '이 결과는 고정 toy 대상과 새 입력에서 관찰한 조건이며 원래 사건과 같은 근본 원인임을 증명하지 않습니다.',
  ];
  const candidates = statements.map((statement, i) => ({ local_key: `c${i}`, kind: 'observation', uncertainty: 'observed',
    statement, evidence_ids: [], relevance: 'required', purpose_relevance: 'fictional OSS smoke' }));
  const previews = candidates.map(c => {
    const projection = { statement: c.statement, columns: [], rows: [] };
    return { schema_version: 'disclosure_preview.v1', preview_id: `p-${c.local_key}`, candidate_id: c.local_key,
      input_revision: 1, representation: { kind: 'fact_summary' }, projection, projection_sha256: hash(JSON.stringify(projection)) };
  });
  const scope = { project_id: 'fictional-oss-smoke', purpose_id: 'oss_issue', recipient_id: 'public-issue', audience: 'public', skill_set_hash: selection?.skill_set_hash ?? hash('[]') };
  const sourceSetHash = hash(JSON.stringify(sources.map(hash)));
  const decisions = candidates.map((c, i) => ({ id: `f${i}`, candidate_id: c.local_key, disposition: 'allow', revoked: false,
    representation: { kind: 'fact_summary' }, expires_at: null, applied_rule_id: '', applied_rule_version: 0,
    scope, source_set_hash: sourceSetHash, projection_sha256: previews[i].projection_sha256 }));
  const compositionInput = { task: { purpose: 'fictional OSS report', recipient: 'fictional public recipient', goal_variant: 'reproduction_evidence' }, task_revision: 1,
    template_id: 'oss_issue.v1', audience_type: 'public', candidates, decisions, previews, rules: [] };
  const pack = composeFactPack(compositionInput);
  // A fixture approval for this fixed output schema predates execution. No stderr/raw stdout projection.
  pack.public_tool_results = [{ status: reproduction.status, reason_code: reproduction.reason_code }];
  const calls = [];
  const recordingModel = { info: model.info, async complete(request, options) {
    assert(forbidden.every(value => !request.input.includes(value)), 'RAW_FIXTURE_DISCLOSURE');
    const started = Date.now(); const response = await model.complete(request, options);
    calls.push({ role: request.role, elapsed_ms: Date.now() - started, usage: response.usage }); return response;
  } };
  const transcriptRunIds = [];
  const sink = transcripts ? { start(operation) {
    const run = transcripts.start(operation); transcriptRunIds.push(run.run_id);
    // Emit after the engine's start event, preserving its lifecycle boundary.
    return { run_id: run.run_id, emit(event, data, content) {
      run.emit(event, data, content);
      if (event === 'run_started' && selection) run.emit('pack_selected', baseReport.selected_pack);
    }, close() { run.close(); } };
  } } : undefined;
  const reviewed = await new RealCore(recordingModel, config, undefined, Date.now, sink).writeReviewed(pack, { grounding: { input: compositionInput, scope, source_set_hash: sourceSetHash, candidate_selectors: {}, rule_goals: [], approved_tool_results: pack.public_tool_results } });
  const document = reviewed.review.result === 'pass' ? reviewed.draft : null;
  if (document) assert(forbidden.every(value => !JSON.stringify(document).includes(value)), 'RAW_FIXTURE_DISCLOSURE');
  return { ...baseReport, execution_summary: executionSummary, completed: Boolean(document), review: reviewed.review, document, calls, transcript_run_ids: transcriptRunIds };
}
function fixtureModel() {
  return { info: { provider: 'fake', model: 'fixture', ready: true }, async complete(request) {
    const pack = JSON.parse(request.input).fact_pack;
    return { text: JSON.stringify(request.role === 'writer' ? { schema_version: 'draft.v1',
      blocks: pack.facts.map((fact, i) => ({ block_id: `b${i}`, type: 'paragraph', text: fact.statement, fact_ids: [fact.id] })) } :
      { schema_version: 'review.v1', result: 'pass', issues: [] }), usage: { inputTokens: null, outputTokens: null }, model: 'fixture' };
  } };
}
export { fixtureModel };
// Runs the registered image once outside DockerReproRunner's lockdown-but-silent path, so a
// stale/rebuilt image (wrong entrypoint, missing binary) fails with a clear diagnosis here
// instead of surfacing as an opaque REPRO_UNAVAILABLE deep inside the real reproduction run.
// CLI-only: unit tests always pass a runnerFactory and never reach this function.
function verifyImageSanity(image) {
  return new Promise((resolvePromise, rejectPromise) => {
    const fail = () => rejectPromise(new Error('SMOKE_IMAGE_SANITY_FAILED'));
    const child = spawn('/usr/bin/docker', ['--host=unix:///var/run/docker.sock', '--config=/dev/null',
      'run', '--rm', '-i', '--network=none', '--read-only', '--user=65532:65532', '--cap-drop=ALL',
      '--security-opt=no-new-privileges=true', '--tmpfs=/out:rw,noexec,nosuid,nodev,size=32m,mode=1777',
      '--entrypoint=/repro', image, 'buggy'], { env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(); }, 5000);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.on('error', fail);
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        if (code === 0 && parsed.schema_version === 'sandbox_observation.v1' && parsed.result?.status === 'ok') resolvePromise();
        else fail();
      } catch { fail(); }
    });
    child.stdin.end(JSON.stringify({ value: 'A' }));
  });
}
export function parseSmokeArguments(args) {
  const values = {};
  const valued = new Set(['--registration', '--catalog', '--pack-version', '--seed', '--output']);
  let live = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--live-model' && !live) { live = true; continue; }
    if (!valued.has(key) || key in values || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('SMOKE_ARGUMENTS_REQUIRED');
    values[key] = args[++i];
  }
  if (!values['--registration'] || Boolean(values['--catalog']) !== Boolean(values['--pack-version'])) throw new Error('SMOKE_ARGUMENTS_REQUIRED');
  const seed = values['--seed'] === undefined ? 42 : Number(values['--seed']);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('SMOKE_ARGUMENTS_REQUIRED');
  return { registration: values['--registration'], catalog: values['--catalog'], version: values['--pack-version'],
    output: values['--output'] ?? '.local/oss-repro-smoke.json', seed, live };
}
async function main() {
  const args = parseSmokeArguments(process.argv.slice(2));
  const installed = JSON.parse(await readFile(resolve(root, args.registration), 'utf8'));
  const selection = args.catalog ? await selectToyrecordPack({
    catalog: JSON.parse(await readFile(resolve(root, args.catalog), 'utf8')), version: args.version, installation: installed,
  }) : undefined;
  // A bound installation must never silently fall back to the legacy path.
  if (!selection && installed.schema_version === 'toyrecord_installation.v1') throw new Error('SMOKE_ARGUMENTS_REQUIRED');
  // Exact local supervisor image identity, not a legacy image tag or arbitrary target argv.
  assert(/^sha256:[a-f0-9]{64}$/.test(installed.image), 'SMOKE_IMAGE_REGISTRATION_REQUIRED');
  await verifyImageSanity(installed.image);
  const config = loadConfig(root, process.env);
  const model = args.live ? new OpenAICompatibleModelClient(config.provider) : fixtureModel();
  const report = await runOssReproSmoke({ image: installed.image, selection, seed: args.seed, model, config, transcripts: configuredTranscripts(root) });
  const output = resolve(root, args.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ completed: report.completed, reproduction: report.reproduction.status,
    model_mode: report.model_mode, review: report.review?.result, report: output }));
  if (!report.completed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const known = new Set(['INVALID_REPRO_MATRIX', 'RAW_FIXTURE_DISCLOSURE', 'SMOKE_ARGUMENTS_REQUIRED',
      'SMOKE_IMAGE_REGISTRATION_REQUIRED', 'SMOKE_IMAGE_SANITY_FAILED', 'TOYRECORD_CATALOG_INVALID',
      'TOYRECORD_PACK_SELECTION_INVALID', 'TOYRECORD_PACK_CONTRACT_INVALID', 'TOYRECORD_SPEC_INVALID', 'TOYRECORD_INSTALLATION_MISMATCH']);
    console.error(known.has(error.message) ? error.message : 'OSS_SMOKE_FAILED'); process.exitCode = 1;
  });
}
