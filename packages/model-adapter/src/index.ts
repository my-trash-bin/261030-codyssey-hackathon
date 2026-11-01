import { APICallError, generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateSubmission } from './tool-generation.ts';
import { postJSON } from './transport.ts';
import { ModelError } from '@safehandoff/core-interface';
import type { ModelCallOptions, ModelClient, ModelClientInfo, ModelRequest, ModelResponse, ProviderConfig } from '@safehandoff/core-interface';

// The only base URLs a request may leave for. Invalid configuration stays unavailable; never expose credentials.
export function providerEndpoint(base: string | undefined, allowPlainHttp: boolean): URL | undefined {
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && allowPlainHttp)) || url.username || url.password || url.search || url.hash) return undefined;
    url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
    return url;
  } catch { return undefined; }
}

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
    this.endpoint = config ? providerEndpoint(env[config.base_url_env], config.allow_plain_http) : undefined;
    this.info = { provider: 'openai_compatible', model, ready: Boolean(this.endpoint && model && this.apiKey && config &&
      config.global_concurrency > 0 && config.request_timeout_seconds > 0 && config.max_input_bytes > 0) };
  }

  async complete(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse> {
    if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
    if (!this.info.ready || !this.config || !this.endpoint) throw new ModelError('MODEL_UNAVAILABLE');
    const config = this.config;
    if (this.active >= config.global_concurrency) throw new ModelError('MODEL_BUDGET_EXCEEDED');
    this.active++;
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(config.request_timeout_seconds * 1000)));
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let requests = 0, rawInput: string | undefined, model = this.info.model;
    let inputTokens: number | null = null, outputTokens: number | null = null;
    let bridgeError: unknown;
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
          if (!options?.output && config.response_mode === 'json' && request.responseFormat !== 'text') body.response_format = { type: 'json_object' };
          const serialized = JSON.stringify(body);
          if (Buffer.byteLength(serialized) > config.max_input_bytes) throw new ModelError('MODEL_BUDGET_EXCEEDED');
          try {
            if (requests >= config.max_attempts_per_step) throw new ModelError('MODEL_BUDGET_EXCEEDED');
            if (requests > 0) options?.onAdditionalCall?.();
            requests++;
            const response = await postJSON(this.endpoint!, serialized, this.apiKey!, signal);
            let data;
            try { data = JSON.parse(response); } catch { throw new ModelError('MODEL_INVALID_RESPONSE'); }
            if (data.choices?.length !== 1 || data.choices[0]?.finish_reason === 'length') throw new ModelError('MODEL_INVALID_RESPONSE');
            const calls = data.choices[0]?.message?.tool_calls;
            if (options?.output && (!Array.isArray(calls) || calls.length !== 1 || typeof calls[0]?.function?.arguments !== 'string')) {
              throw new ModelError('MODEL_INVALID_RESPONSE');
            }
            rawInput = calls?.[0]?.function?.arguments;
            const tokens = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
            const incoming = tokens(data.usage?.prompt_tokens), outgoing = tokens(data.usage?.completion_tokens);
            inputTokens = incoming === null || requests > 1 && inputTokens === null ? null : (inputTokens ?? 0) + incoming;
            outputTokens = outgoing === null || requests > 1 && outputTokens === null ? null : (outputTokens ?? 0) + outgoing;
            if (typeof data.model === 'string') model = data.model;
            return new Response(response, { headers: { 'content-type': 'application/json' } });
          } catch (error) { bridgeError = error; throw error; }
        } });
      const systemPrompt = [request.systemPrompt, ...(options?.output ? ['Submit the result JSON using the submit tool, never as plain assistant text.'] : [])].filter(Boolean).join('\n');
      const settings = { model: provider.chatModel(this.info.model),
        ...(config.supports_system_role && systemPrompt ? { system: systemPrompt } : {}),
        prompt: config.supports_system_role ? request.input : [systemPrompt, request.input].filter(Boolean).join('\n\n'),
        ...(config.send_temperature ? { temperature: request.temperature ?? config.temperature } : {}), abortSignal: signal };
      let text: string;
      if (options?.output) text = await generateSubmission(settings, options.output, () => rawInput, () => requests < config.max_attempts_per_step);
      else {
        const result = await generateText({ ...settings, maxRetries: 0, telemetry: { isEnabled: false } });
        if (!result.text.trim() || result.finishReason === 'length') throw new ModelError('MODEL_INVALID_RESPONSE');
        text = result.text;
      }
      return { text, model, usage: { inputTokens, outputTokens } };
    } catch (error) {
      if (options?.signal?.aborted) throw new ModelError('MODEL_CANCELLED');
      if (timeout.aborted) throw new ModelError('MODEL_TIMEOUT');
      if (bridgeError instanceof ModelError) throw bridgeError;
      if (error instanceof ModelError) throw error;
      if (error instanceof Error && ['AI_JSONParseError', 'AI_TypeValidationError', 'AI_InvalidResponseDataError', 'AI_NoOutputGeneratedError', 'AI_ToolCallRepairError', 'AI_InvalidToolInputError'].includes(error.name)) {
        throw new ModelError('MODEL_INVALID_RESPONSE');
      }
      if (APICallError.isInstance(error) && error.statusCode === 200) throw new ModelError('MODEL_INVALID_RESPONSE');
      throw new ModelError('MODEL_UNAVAILABLE');
    } finally { this.active--; }
  }
}
