import assert from 'node:assert/strict';
import test from 'node:test';
import { ReproError } from '@safehandoff/core-interface';
import { DockerReproRunner } from './index.ts';

test('docker repro runner is an explicit implementation seam, never a silent fake fallback', async () => {
  const runner = new DockerReproRunner();
  assert.deepEqual(runner.info, { implementation: 'docker', ready: false });
  await assert.rejects(
    runner.reproduce({
      target_pair_id: 'toyrecord',
      target_pair_digest: 'sha256:0',
      synthetic_input_set_id: 'set-1',
      input_set_digest: 'sha256:0',
      oracle_id: 'oracle-1',
    }),
    (error: unknown) => error instanceof ReproError && error.code === 'REPRO_UNAVAILABLE',
  );
});
