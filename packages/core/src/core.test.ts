import assert from 'node:assert/strict';
import test from 'node:test';
import { CoreError } from '@safehandoff/core-interface';
import { RealCore } from './index.ts';

test('real core is an explicit implementation seam, never a silent fake fallback', async () => {
  const core = new RealCore();
  assert.deepEqual(core.info, { implementation: 'real', connection: 'direct', ready: false });
  await assert.rejects(core.generate({ purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'timeout' }] }),
    (error: unknown) => error instanceof CoreError && error.code === 'CORE_NOT_IMPLEMENTED');
});
