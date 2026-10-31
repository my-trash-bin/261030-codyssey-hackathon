import { createHash, randomUUID } from 'node:crypto';
import { judgeReproduction, ReproError } from '@safehandoff/core-interface';
import type { InputDigest, ReproduceRequest, ReproduceResult, ReproRun, ReproRunner, ReproRunnerInfo, TargetRun } from '@safehandoff/core-interface';
import { dockerCommand } from './command.ts';
import type { DockerCommand } from './command.ts';

export interface DockerRegistration {
  image: string; target_pair_id: string; synthetic_input_set_id: string;
  inputs: { ascii: string; multibyte: string }; seed: number | null;
}
export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function reproductionRequest(registration: DockerRegistration): ReproduceRequest {
  return { target_pair_id: registration.target_pair_id,
    target_pair_digest: sha256(JSON.stringify({ image: registration.image, supervisor: 'sandbox_observation.v1', targets: ['buggy', 'fixed'] })),
    synthetic_input_set_id: registration.synthetic_input_set_id,
    input_set_digest: sha256(JSON.stringify({ ascii: registration.inputs.ascii, multibyte: registration.inputs.multibyte })),
    oracle_id: 'toyrecord.encode.v1' };
}
function digest(value: string): InputDigest {
  return { codepoints: [...value].length, utf8_bytes: Buffer.byteLength(value), sha256: sha256(value) };
}
export class DockerReproRunner implements ReproRunner {
  readonly info: ReproRunnerInfo;
  private readonly registration?: DockerRegistration;
  private readonly command: DockerCommand;
  private active = false;
  constructor(registration?: DockerRegistration, command: DockerCommand = dockerCommand) {
    if (registration && (!/^sha256:[a-f0-9]{64}$/.test(registration.image) ||
      !/^[A-Z]{1,8}$/.test(registration.inputs.ascii) || !/^[가-힣]{1,8}$/.test(registration.inputs.multibyte) ||
      [...registration.inputs.ascii].length !== [...registration.inputs.multibyte].length ||
      !(registration.seed === null || Number.isSafeInteger(registration.seed)))) throw new ReproError('REPRO_UNAVAILABLE');
    this.registration = registration ? structuredClone(registration) : undefined;
    this.command = command;
    this.info = { implementation: 'docker', ready: Boolean(registration) };
  }
  async reproduce(request: ReproduceRequest, options?: { signal?: AbortSignal }): Promise<ReproduceResult> {
    if (options?.signal?.aborted) throw new ReproError('REPRO_CANCELLED');
    if (!this.registration || this.active) throw new ReproError('REPRO_UNAVAILABLE');
    const registration = this.registration;
    const expected = reproductionRequest(registration);
    if (Object.keys(request).sort().join(',') !== Object.keys(expected).sort().join(',') ||
      Object.entries(expected).some(([key, value]) => request[key as keyof ReproduceRequest] !== value)) {
      throw new ReproError('TARGET_DIGEST_MISMATCH');
    }
    this.active = true;
    const deadline = Date.now() + 15000;
    const invoke = (args: string[], input?: string) => {
      if (options?.signal?.aborted) throw new ReproError('REPRO_CANCELLED');
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) throw new ReproError('REPRO_TIMEOUT');
      return this.command(args, { timeoutMs, input, signal: options?.signal });
    };
    const names = new Set<string>();
    try {
      const image = await invoke(['image', 'inspect', '--format={{.Id}}', registration.image]);
      if (image.exitCode !== 0) throw new ReproError('REPRO_UNAVAILABLE');
      if (image.stdout.trim() !== registration.image) throw new ReproError('TARGET_DIGEST_MISMATCH');
      const runs: ReproRun[] = [];
      for (const target of ['buggy', 'fixed']) for (const input of ['ascii', 'multibyte'] as const) {
        const name = `safehandoff-${randomUUID()}`;
        names.add(name); // Cleanup by our generated name even if create times out after creating it.
        const created = await invoke(['create', '--pull=never', '--name', name, '--network=none', '--read-only',
          '--user=65532:65532', '--cap-drop=ALL', '--security-opt=no-new-privileges=true', '--cpus=1',
          '--memory=256m', '--memory-swap=256m', '--pids-limit=64', '--no-healthcheck', '--restart=no',
          '--log-driver=none', '--ulimit=nofile=64:64', '--ulimit=core=0:0',
          '--tmpfs=/out:rw,noexec,nosuid,nodev,size=32m,mode=1777', '--entrypoint=/repro', '-i', registration.image, target]);
        if (created.exitCode !== 0) throw new ReproError('REPRO_UNAVAILABLE');
        const execution = await invoke(['start', '--attach', '--interactive', name], JSON.stringify({ value: registration.inputs[input] }));
        if (execution.exitCode !== 0) throw new ReproError('REPRO_UNAVAILABLE');
        runs.push(observation(execution.stdout, target, input, registration.inputs[input]));
        const removed = await invoke(['rm', '--force', name]);
        if (removed.exitCode !== 0) throw new ReproError('REPRO_UNAVAILABLE');
        names.delete(name);
      }
      return { schema_version: 'repro_result.v1', seed: registration.seed, target_pair_digest: expected.target_pair_digest,
        input_set_sha256: expected.input_set_digest, inputs: { ascii: digest(registration.inputs.ascii), multibyte: digest(registration.inputs.multibyte) },
        ...judgeReproduction(runs), runs };
    } finally {
      try {
        // Cleanup has an independent timeout and is not cancelled with the job.
        for (const name of names) {
          const removed = await this.command(['rm', '--force', name], { timeoutMs: 3000 });
          if (removed.exitCode !== 0) throw new ReproError('REPRO_UNAVAILABLE');
        }
      } finally { this.active = false; }
    }
  }
}
function observation(text: string, target: string, input: string, expected: string): ReproRun {
  try {
    const value = JSON.parse(text);
    if (Object.keys(value).sort().join(',') !== 'exit_code,output_bytes,result,schema_version' ||
      value.schema_version !== 'sandbox_observation.v1' || !Number.isInteger(value.exit_code) ||
      Object.keys(value.result).sort().join(',') !== 'code,schema_version,stage,status' ||
      (value.result.code !== null && typeof value.result.code !== 'string') ||
      !(value.output_bytes === null || typeof value.output_bytes === 'string')) throw new Error();
    const bytes = value.output_bytes === null ? null : Buffer.from(value.output_bytes, 'base64');
    if (bytes && bytes.toString('base64') !== value.output_bytes) throw new Error();
    return { target, input, result: value.result as TargetRun, exit_code: value.exit_code,
      output_exists: bytes !== null, output_matches: bytes !== null && bytes.equals(Buffer.from(expected)) };
  } catch { throw new ReproError('REPRO_UNAVAILABLE'); }
}
