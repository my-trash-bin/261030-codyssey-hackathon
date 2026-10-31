import type { ReproRun, ReproductionStatus } from './reproduction.ts';

type Verdict = { status: ReproductionStatus; reason_code: string };
export function judgeReproduction(runs: ReproRun[]): Verdict {
  const verdict = (status: ReproductionStatus, reason_code: string): Verdict => ({ status, reason_code });
  const keys = new Set<string>();
  for (const run of runs) {
    const key = `${run.target}/${run.input}`;
    if (!['buggy', 'fixed'].includes(run.target) || !['ascii', 'multibyte'].includes(run.input) || keys.has(key)) {
      return verdict('error', 'INVALID_RUN_MATRIX');
    }
    keys.add(key);
    const result = run.result;
    if (run.exit_code === 124 || run.exit_code === 137) return verdict('error', 'REPRO_TIMEOUT');
    if (result.schema_version !== 'target_run.v1' || result.status === 'execution_error' ||
      !['parse', 'validate', 'encode', 'persist'].includes(result.stage) ||
      !['ok', 'domain_error'].includes(result.status) ||
      (result.status === 'ok' && (run.exit_code !== 0 || result.stage !== 'persist' || result.code !== null)) ||
      (result.status === 'domain_error' && (run.exit_code !== 2 || !result.code)) ||
      (run.output_matches && !run.output_exists)) return verdict('error', 'INVALID_TARGET_OUTPUT');
  }
  if (runs.length !== 4) return verdict('inconclusive', 'INCOMPLETE_RUN_MATRIX');
  const success = (run: ReproRun) => run.result.status === 'ok' && run.output_exists && run.output_matches;
  if (runs.some(run => run.input === 'ascii' && !success(run))) return verdict('inconclusive', 'CONTROL_FAILED');
  const fixed = runs.find(run => run.target === 'fixed' && run.input === 'multibyte')!;
  const buggy = runs.find(run => run.target === 'buggy' && run.input === 'multibyte')!;
  if (!success(fixed)) return verdict('inconclusive', 'UNEXPECTED_TARGET_OUTCOME');
  if (buggy.result.status === 'domain_error' && buggy.result.stage === 'encode' &&
    buggy.result.code === 'E_ENCODE_SHORT_BUFFER' && !buggy.output_exists) return verdict('reproduced', 'TARGET_SYMPTOM_REPRODUCED');
  if (success(buggy)) return verdict('not_reproduced', 'TARGET_SYMPTOM_NOT_REPRODUCED');
  return verdict('inconclusive', 'UNEXPECTED_TARGET_OUTCOME');
}
