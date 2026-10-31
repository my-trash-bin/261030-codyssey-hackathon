import { ModelError } from '@safehandoff/core-interface';
import type { ModelClient, ModelClientInfo, ModelRequest, ModelResponse } from '@safehandoff/core-interface';

// Implement the real openai_compatible HTTP transport here (config.json's provider block:
// base_url_env/model_env/api_key_env, allow_plain_http, timeouts, retries). Do not import
// demo packages.
export class OpenAICompatibleModelClient implements ModelClient {
  readonly info: ModelClientInfo = { provider: 'openai_compatible', model: '', ready: false };
  async complete(_request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse> {
    if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
    throw new ModelError('MODEL_UNAVAILABLE');
  }
}
