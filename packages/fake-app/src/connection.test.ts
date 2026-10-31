import assert from 'node:assert/strict';
import test from 'node:test';
import { CoreError } from '@safehandoff/core-interface';
import type { Core } from '@safehandoff/core-interface';
import { SimulatedConnection } from './connection.ts';

const input = { purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'timeout' }] };
function target() {
  let calls = 0;
  const core: Core = {
    info: { implementation: 'real', connection: 'direct', ready: true },
    async generate() { calls++; return { document: { title: 'injected target', body: 'body' }, provenance: { ...this.info } }; },
  };
  return { core, calls: () => calls };
}
test('transport simulation is independent from the target and consumes configured failures', async () => {
  const injected = target();
  const connector = new SimulatedConnection(injected.core, { delayMs: 0, failuresRemaining: 1 });
  await assert.rejects(connector.generate(input), (error: unknown) => error instanceof CoreError && error.code === 'CORE_UNAVAILABLE');
  assert.equal(injected.calls(), 0);
  const result = await connector.generate(input);
  assert.equal(result.provenance.implementation, 'real');
  assert.equal(result.provenance.connection, 'simulated');
  assert.equal(injected.calls(), 1);
  assert.equal(connector.settings().failuresRemaining, 0);
});
test('cancelling simulated latency never calls the downstream core', async () => {
  const injected = target(), controller = new AbortController();
  const connector = new SimulatedConnection(injected.core, { delayMs: 30000, failuresRemaining: 0 });
  const pending = connector.generate(input, { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof CoreError && error.code === 'CORE_CANCELLED');
  assert.equal(injected.calls(), 0);
});
