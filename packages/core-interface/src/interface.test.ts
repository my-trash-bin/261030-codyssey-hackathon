import assert from 'node:assert/strict';
import test from 'node:test';
import { CoreError, parseGenerateRequest } from './index.ts';

test('the shared boundary accepts approved facts and rejects raw sources or duplicate IDs', () => {
  const valid = { purpose: 'support', recipient: 'vendor', facts: [{ id: 'a', text: 'timeout observed' }] };
  assert.deepEqual(parseGenerateRequest(valid), valid);
  for (const input of [null, {}, { ...valid, sources: ['private'] }, { ...valid, facts: [] },
    { ...valid, facts: [valid.facts[0], valid.facts[0]] }, { ...valid, purpose: '' }]) {
    assert.throws(() => parseGenerateRequest(input), CoreError);
  }
});
