import { ModelError } from '@safehandoff/core-interface';
import type { ModelClient, ModelClientInfo, ModelRequest, ModelResponse, ProviderConfig } from '@safehandoff/core-interface';

export class OpenAICompatibleModelClient implements ModelClient {
  readonly info: ModelClientInfo;
  private readonly endpoint?: URL;
  private readonly apiKey?: string;
  private active = 0;
  private readonly config?: ProviderConfig;
  constructor(config?: ProviderConfig, env: Record<string, string | undefined> = process.env) {
    this.config = config;
    const model = config ? env[config.model_env] ?? '' : '';
    this.apiKey = config ? env[config.api_key_env] : undefined;
    try {
      if (config && env[config.base_url_env]) {
        const url = new URL(env[config.base_url_env]!);
        if ((url.protocol === 'https:' || (url.protocol === 'http:' && config.allow_plain_http)) &&
          !url.username && !url.password && !url.search && !url.hash) {
          url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
          this.endpoint = url;
        }
      }
    } catch { /* Invalid configuration stays unavailable; never expose credentials. */ }
    this.info = { provider: 'openai_compatible', model, ready: Boolean(this.endpoint && model && this.apiKey && config &&
      config.global_concurrency > 0 && config.request_timeout_seconds > 0 && config.max_input_bytes > 0) };
  }

  async complete(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse> {
    if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
    if (!this.info.ready || !this.config || !this.endpoint) throw new ModelError('MODEL_UNAVAILABLE');
    const config = this.config;
    if (this.active >= config.global_concurrency) throw new ModelError('MODEL_BUDGET_EXCEEDED');
    const messages = request.systemPrompt && config.supports_system_role
      ? [{ role: 'system', content: request.systemPrompt }, { role: 'user', content: request.input }]
      : [{ role: 'user', content: [request.systemPrompt, request.input].filter(Boolean).join('\n\n') }];
    const body = JSON.stringify({ model: this.info.model, messages,
      [config.output_limit_field]: Math.min(request.maxOutputTokens ?? config.max_output_tokens, config.max_output_tokens),
      ...(config.send_temperature ? { temperature: request.temperature ?? config.temperature } : {}),
      ...((request.responseFormat ?? config.response_mode) === 'json' ? { response_format: { type: 'json_object' } } : {}),
    });
    if (Buffer.byteLength(body) > config.max_input_bytes) throw new ModelError('MODEL_BUDGET_EXCEEDED');
    this.active++;
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(config.request_timeout_seconds * 1000)));
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      // Retries belong to Engine so every HTTP call counts against the run budget.
      const response = await fetch(this.endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` }, body,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelError('MODEL_UNAVAILABLE');
      }
      // Bound response bytes before parsing; provider bodies never become public errors.
      const reader = response.body?.getReader();
      if (!reader) throw new ModelError('MODEL_INVALID_RESPONSE');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1024 * 1024) {
          await reader.cancel();
          throw new ModelError('MODEL_INVALID_RESPONSE');
        }
        chunks.push(part.value);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ModelError('MODEL_INVALID_RESPONSE'); }
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim() || data.choices[0].finish_reason === 'length') {
        throw new ModelError('MODEL_INVALID_RESPONSE');
      }
      const tokens = (value: unknown): number | null =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
      return { text, model: typeof data.model === 'string' ? data.model : this.info.model,
        usage: { inputTokens: tokens(data.usage?.prompt_tokens), outputTokens: tokens(data.usage?.completion_tokens) } };
    } catch (error) {
      if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
      if (timeout.aborted) throw new ModelError('MODEL_TIMEOUT');
      if (error instanceof ModelError) throw error;
      throw new ModelError('MODEL_UNAVAILABLE');
    } finally { this.active--; }
  }
}
