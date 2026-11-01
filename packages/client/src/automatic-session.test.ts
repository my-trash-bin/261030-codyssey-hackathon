import assert from 'node:assert/strict';
import test from 'node:test';
import { useSession } from './ui/hooks/useSession.ts';
import { renderHook } from './test-helpers/react-hook.ts';

for (const existing of [false, true]) test(`page connects without user credentials; existing session=${existing}`, async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const calls: { method: string; body: unknown }[] = [];
  const body = { data: { csrf_token: 'csrf-value', expires_at: new Date(Date.now() + 60000).toISOString(), capabilities: {} } };
  globalThis.fetch = async (_input, init) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body });
    if (!existing && calls.length === 1) return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const hook = await renderHook(() => useSession(() => {}));
  try {
    assert.equal(hook.result.current.session?.csrfToken, 'csrf-value');
    assert.deepEqual(calls.map(c => c.method), existing ? ['GET'] : ['GET', 'POST']);
    if (!existing) assert.deepEqual(JSON.parse(String(calls[1]!.body)), {});
  } finally { await hook.unmount(); }
});
