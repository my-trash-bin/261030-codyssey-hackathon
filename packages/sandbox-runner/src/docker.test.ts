import assert from 'node:assert/strict';
import test from 'node:test';
import { ReproError } from '@safehandoff/core-interface';
import { DockerReproRunner, reproductionRequest } from './index.ts';
import type { DockerRegistration } from './index.ts';
import type { CommandOptions, DockerCommand } from './command.ts';
import { dockerCommand } from './command.ts';

const registration: DockerRegistration = { image: `sha256:${'a'.repeat(64)}`, target_pair_id: 'toyrecord.v1',
  synthetic_input_set_id: 'synthetic.v1', inputs: { ascii: 'ABCDEF', multibyte: '가나다라마바' }, seed: null };
function mock() {
  const calls: { args: string[]; options: CommandOptions }[] = [];
  const targets = new Map<string, string>();
  const command: DockerCommand = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'image') return { stdout: registration.image, stderr: '', exitCode: 0 };
    if (args[0] === 'create') targets.set(args[args.indexOf('--name') + 1]!, args.at(-1)!);
    if (args[0] === 'start') {
      const input = JSON.parse(options.input!).value;
      const buggy = targets.get(args.at(-1)!) === 'buggy' && /[가-힣]/.test(input);
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ schema_version: 'sandbox_observation.v1',
        result: { schema_version: 'target_run.v1', status: buggy ? 'domain_error' : 'ok', stage: buggy ? 'encode' : 'persist',
          code: buggy ? 'E_ENCODE_SHORT_BUFFER' : null }, exit_code: buggy ? 2 : 0,
        output_bytes: buggy ? null : Buffer.from(input).toString('base64') }) };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  return { command, calls };
}
const code = (expected: string) => (error: unknown) => error instanceof ReproError && error.code === expected;
test('registered runner executes four isolated pinned containers and checks actual file bytes', async () => {
  const { command, calls } = mock(); const runner = new DockerReproRunner(registration, command);
  const result = await runner.reproduce(reproductionRequest(registration));
  assert.equal(result.status, 'reproduced'); assert.equal(result.runs.length, 4);
  const creates = calls.filter(call => call.args[0] === 'create');
  assert.equal(creates.length, 4);
  for (const call of creates) {
    for (const flag of ['--pull=never', '--network=none', '--read-only', '--user=65532:65532', '--cap-drop=ALL',
      '--security-opt=no-new-privileges=true', '--cpus=1', '--memory=256m', '--memory-swap=256m', '--pids-limit=64', '--log-driver=none']) {
      assert(call.args.includes(flag));
    }
    assert(call.args.includes(registration.image));
    assert(!call.args.some(arg => /--(env|volume|mount|privileged)/.test(arg)));
    assert(call.options.timeoutMs > 0 && call.options.timeoutMs <= 15000);
  }
  assert.equal(calls.filter(call => call.args[0] === 'rm').length, 4);
});
test('digest and arbitrary request changes are rejected before Docker is called', async () => {
  const { command, calls } = mock(), runner = new DockerReproRunner(registration, command);
  await assert.rejects(runner.reproduce({ ...reproductionRequest(registration), target_pair_digest: 'wrong' }), code('TARGET_DIGEST_MISMATCH'));
  await assert.rejects(runner.reproduce({ ...reproductionRequest(registration), argv: 'bad' } as never), code('TARGET_DIGEST_MISMATCH'));
  assert.equal(calls.length, 0);
  assert.throws(() => new DockerReproRunner({ ...registration, image: 'mutable:tag' }), code('REPRO_UNAVAILABLE'));
  assert.throws(() => new DockerReproRunner({ ...registration, inputs: { ascii: 'private', multibyte: '가' } }), code('REPRO_UNAVAILABLE'));
});
test('timeouts malformed output and failed image inspection never reproduce and always clean created names', async () => {
  for (const failure of ['timeout', 'malformed', 'image']) {
    const { command, calls } = mock();
    const runner = new DockerReproRunner(registration, async (args, options) => {
      if (args[0] === 'image' && failure === 'image') return { stdout: 'wrong', stderr: '', exitCode: 0 };
      if (args[0] === 'start') {
        if (failure === 'timeout') throw new ReproError('REPRO_TIMEOUT');
        return { stdout: '{"private":"bad"}', stderr: '', exitCode: 0 };
      }
      return command(args, options);
    });
    await assert.rejects(runner.reproduce(reproductionRequest(registration)), code(failure === 'timeout' ? 'REPRO_TIMEOUT' :
      failure === 'image' ? 'TARGET_DIGEST_MISMATCH' : 'REPRO_UNAVAILABLE'));
    if (failure !== 'image') assert.equal(calls.filter(call => call.args[0] === 'rm').length, 1);
  }
});
test('cancellation cleans containers using a fresh uncancelled cleanup operation', async () => {
  const { command, calls } = mock(), controller = new AbortController();
  const runner = new DockerReproRunner(registration, async (args, options) => {
    const result = await command(args, options);
    if (args[0] === 'create') controller.abort();
    return result;
  });
  await assert.rejects(runner.reproduce(reproductionRequest(registration), { signal: controller.signal }), code('REPRO_CANCELLED'));
  const cleanup = calls.find(call => call.args[0] === 'rm'); assert(cleanup);
  assert.equal(cleanup.options.signal, undefined);
});
test('actual local image reproduces the fixed four-run matrix', { skip: !process.env.SAFEHANDOFF_TEST_DOCKER_IMAGE }, async () => {
  const installed = { ...registration, image: process.env.SAFEHANDOFF_TEST_DOCKER_IMAGE! };
  const result = await new DockerReproRunner(installed).reproduce(reproductionRequest(installed));
  assert.equal(result.status, 'reproduced');
  assert.deepEqual(result.runs.map(run => [run.target, run.input, run.result.status, run.output_matches]), [
    ['buggy', 'ascii', 'ok', true], ['buggy', 'multibyte', 'domain_error', false],
    ['fixed', 'ascii', 'ok', true], ['fixed', 'multibyte', 'ok', true],
  ]);
});

test('actual Docker configuration enforces isolation and cancelled runs leave no container',
  { skip: !process.env.SAFEHANDOFF_TEST_DOCKER_IMAGE }, async () => {
    const installed = { ...registration, image: process.env.SAFEHANDOFF_TEST_DOCKER_IMAGE! };
    const controller = new AbortController();
    let name = '';
    const runner = new DockerReproRunner(installed, async (args, options) => {
      const result = await dockerCommand(args, options);
      if (args[0] === 'create') {
        name = args[args.indexOf('--name') + 1]!;
        const inspected = await dockerCommand(['inspect', '--format={{json .HostConfig}}', name], { timeoutMs: 3000 });
        const host = JSON.parse(inspected.stdout);
        assert.equal(host.NetworkMode, 'none'); assert.equal(host.ReadonlyRootfs, true);
        assert.equal(host.Memory, 256 * 1024 * 1024); assert.equal(host.MemorySwap, host.Memory);
        assert.equal(host.NanoCpus, 1e9); assert.equal(host.PidsLimit, 64);
        assert.deepEqual(host.CapDrop, ['ALL']); assert(host.SecurityOpt.includes('no-new-privileges=true'));
        assert.equal(host.Privileged, false); assert(!host.Binds?.length);
        assert(host.Tmpfs['/out'].includes('size=32m'));
        controller.abort();
      }
      return result;
    });
    await assert.rejects(runner.reproduce(reproductionRequest(installed), { signal: controller.signal }), code('REPRO_CANCELLED'));
    assert(name);
    assert.notEqual((await dockerCommand(['inspect', name], { timeoutMs: 3000 })).exitCode, 0);
  });
