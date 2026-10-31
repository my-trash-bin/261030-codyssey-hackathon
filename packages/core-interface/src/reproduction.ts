// F08 reproduction port: the model never writes or chooses arbitrary code. A request only
// references a pre-registered, digest-pinned target pair and synthetic input set; the runner
// executes fixed binaries under tight resource limits (security.md 9: 15s/1 CPU/256MiB/
// PID 64/no network) and returns a strict verdict. Field names mirror repro_request.v1,
// repro_result.v1 and target_run.v1 exactly, including the request shape (no engine-side
// fields like timeoutMs are added here — those belong to the ReproRunner implementation,
// not the wire contract).
export type ReproductionStatus =
  | 'not_requested'
  | 'not_run'
  | 'running'
  | 'reproduced'
  | 'not_reproduced'
  | 'inconclusive'
  | 'error';

export type TargetRunStage = 'parse' | 'validate' | 'encode' | 'persist';
export type TargetRunStatus = 'ok' | 'domain_error' | 'execution_error';
export interface TargetRun {
  schema_version: 'target_run.v1';
  status: TargetRunStatus;
  stage: TargetRunStage;
  code: string | null;
}

export interface ReproduceRequest {
  target_pair_id: string;
  target_pair_digest: string;
  synthetic_input_set_id: string;
  input_set_digest: string;
  oracle_id: string;
}

export interface InputDigest { codepoints: number; utf8_bytes: number; sha256: string }

export interface ReproRun {
  target: string;
  input: string;
  result: TargetRun;
  exit_code: number;
  output_exists: boolean;
  output_matches: boolean;
}

export interface ReproduceResult {
  schema_version: 'repro_result.v1';
  seed: number | null;
  target_pair_digest: string;
  input_set_sha256: string;
  inputs: { ascii: InputDigest; multibyte: InputDigest };
  status: ReproductionStatus;
  reason_code: string;
  runs: ReproRun[];
}

// Fixed verdict logic, signature only: implemented alongside the actual sandbox runner.
export declare function judgeReproduction(
  runs: ReproRun[],
): { status: ReproductionStatus; reason_code: string };

export interface ReproRunnerInfo { implementation: 'docker' | 'fake'; ready: boolean }
export interface ReproRunner {
  readonly info: ReproRunnerInfo;
  reproduce(request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult>;
}

export type ReproErrorCode =
  | 'TARGET_DIGEST_MISMATCH'
  | 'REPRO_UNAVAILABLE'
  | 'REPRO_TIMEOUT'
  | 'REPRO_CANCELLED';
export class ReproError extends Error {
  readonly code: ReproErrorCode;
  constructor(code: ReproErrorCode) { super(code); this.code = code; }
}
