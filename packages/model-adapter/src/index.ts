import { APICallError, generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { postJSON } from './transport.ts';
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
    this.active++;
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(config.request_timeout_seconds * 1000)));
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      // The SDK owns provider serialization. The native fetch bridge preserves the
      // existing no-proxy/no-redirect boundary and per-request byte limits.
      const provider = createOpenAICompatible({ name: 'safehandoff', baseURL: this.endpoint.href.replace(/\/chat\/completions$/, ''),
        apiKey: this.apiKey!, fetch: async (url, init) => {
          if (String(url) !== this.endpoint!.href || typeof init?.body !== 'string') throw new ModelError('MODEL_UNAVAILABLE');
          const body = JSON.parse(init.body);
          const limit = config.max_output_tokens === null ? request.maxOutputTokens ?? null :
            Math.min(request.maxOutputTokens ?? config.max_output_tokens, config.max_output_tokens);
          delete body.max_tokens;
          if (limit !== null) body[config.output_limit_field] = limit;
          if (config.response_mode === 'json' && request.responseFormat !== 'text') body.response_format = { type: 'json_object' };
          const serialized = JSON.stringify(body);
          if (Buffer.byteLength(serialized) > config.max_input_bytes) throw new ModelError('MODEL_BUDGET_EXCEEDED');
          const response = await postJSON(this.endpoint!, serialized, this.apiKey!, signal);
          return new Response(response, { headers: { 'content-type': 'application/json' } });
        } });
      const result = await generateText({ model: provider.chatModel(this.info.model),
        ...(config.supports_system_role && request.systemPrompt ? { system: request.systemPrompt } : {}),
        prompt: config.supports_system_role ? request.input : [request.systemPrompt, request.input].filter(Boolean).join('\n\n'),
        ...(config.send_temperature ? { temperature: request.temperature ?? config.temperature } : {}),
        maxRetries: 0, abortSignal: signal, telemetry: { isEnabled: false } });
      if (!result.text.trim() || result.finishReason === 'length') throw new ModelError('MODEL_INVALID_RESPONSE');
      const tokens = (value: unknown): number | null =>
        typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
      return { text: result.text, model: result.response.modelId ?? this.info.model,
        usage: { inputTokens: tokens(result.usage.inputTokens), outputTokens: tokens(result.usage.outputTokens) } };
    } catch (error) {
      if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
      if (timeout.aborted) throw new ModelError('MODEL_TIMEOUT');
      if (error instanceof ModelError) throw error;
      if (error instanceof Error && ['AI_JSONParseError', 'AI_TypeValidationError', 'AI_InvalidResponseDataError', 'AI_NoOutputGeneratedError'].includes(error.name)) {
        throw new ModelError('MODEL_INVALID_RESPONSE');
      }
      if (APICallError.isInstance(error) && error.statusCode === 200) throw new ModelError('MODEL_INVALID_RESPONSE');
      throw new ModelError('MODEL_UNAVAILABLE');
    } finally { this.active--; }
  }
}
