import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelError } from '@safehandoff/core-interface';
import { OpenAICompatibleModelClient } from './index.ts';

test('openai-compatible model client is an explicit implementation seam, never a silent fake fallback', async () => {
  const client = new OpenAICompatibleModelClient();
  assert.deepEqual(client.info, { provider: 'openai_compatible', model: '', ready: false });
  await assert.rejects(
    client.complete({ role: 'writer', input: 'draft this' }),
    (error: unknown) => error instanceof ModelError && error.code === 'MODEL_UNAVAILABLE',
  );
});
