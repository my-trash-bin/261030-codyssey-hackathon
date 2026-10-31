import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeCore } from './index.ts';

test('changing the fake script changes only fake output and regenerates from current facts', async () => {
  const core = new FakeCore();
  const input = { purpose: '문의', recipient: '가상 공급사', facts: [{ id: 'a', text: '첫 요청 timeout' }] };
  const first = await core.generate(input);
  assert.equal(first.provenance.implementation, 'fake');
  core.configure({ title: '다른 연출', opening: '새 도입', closing: '새 마무리' });
  const next = await core.generate({ ...input, facts: [{ id: 'b', text: '다른 관찰' }] });
  assert.equal(next.document.title, '다른 연출');
  assert.match(next.document.body, /새 도입/);
  assert.doesNotMatch(next.document.body, /첫 요청 timeout/);
  const copied = core.settings(); copied.title = 'external mutation';
  assert.equal(core.settings().title, '다른 연출');
});
