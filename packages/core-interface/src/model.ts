// Minimal LLM client port used by analyze/write/review. decisions.md: "the model is
// replaceable behind an adapter" — core only ever sees this interface, never a concrete
// SDK. ProviderConfig/WorkflowConfig/ReproductionConfig mirror config.json's
// provider/workflow/reproduction blocks field-for-field.
export type ModelRole = 'analysis' | 'disclosure' | 'writer' | 'reviewer' | 'provider_check';
export interface ModelRequest {
  role: ModelRole;
  systemPrompt?: string;
  input: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}
export interface ModelUsage { inputTokens: number | null; outputTokens: number | null }
export interface ModelResponse { text: string; usage: ModelUsage; model: string }
export interface ModelClientInfo { provider: 'openai_compatible' | 'fake'; model: string; ready: boolean }
// SDK-neutral JSON Schema subset for model result submission tools.
export type ModelValueSchema = ModelAtomicSchema | { anyOf: ModelAtomicSchema[] };
export type ModelAtomicSchema = ModelObjectSchema | { type: 'string'; enum?: string[]; maxLength?: number; minLength?: number } |
  { type: 'integer'; minimum?: number; maximum?: number } | { type: 'boolean' } | { type: 'null' } |
  { type: 'array'; items: ModelValueSchema; minItems?: number; maxItems?: number };
export interface ModelObjectSchema {
  type: 'object'; properties: Record<string, ModelValueSchema>; required: string[]; additionalProperties: false;
}
export interface ModelCallOptions {
  signal?: AbortSignal;
  output?: { schema: ModelObjectSchema; validate: (text: string) => unknown };
  // Invoked immediately before every additional HTTP call, including argument repair.
  // The Engine owns the run/step counters and may reject the call before transmission.
  onAdditionalCall?: () => void;
}
export interface ModelClient {
  readonly info: ModelClientInfo;
  complete(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse>;
}

export type ModelErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_TIMEOUT'
  | 'MODEL_BUDGET_EXCEEDED'
  | 'MODEL_INVALID_RESPONSE'
  | 'MODEL_CANCELLED';
export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode) { super(code); this.code = code; }
}

export interface ProviderConfig {
  type: 'openai_compatible';
  base_url_env: string;
  model_env: string;
  api_key_env: string;
  response_mode: 'text' | 'json';
  supports_system_role: boolean;
  send_temperature: boolean;
  output_limit_field: string;
  allow_plain_http: boolean;
  temperature: number;
  // null = no default ceiling; the provider's own limit applies unless a per-request
  // ModelRequest.maxOutputTokens override is given.
  max_output_tokens: number | null;
  max_input_bytes: number;
  request_timeout_seconds: number;
  max_attempts_per_step: number;
  global_concurrency: number;
}
export interface WorkflowConfig { max_review_repairs: number; max_model_calls_per_run: number }
export interface ReproductionConfig { enabled: boolean; runner: 'docker' }
export interface EngineConfig {
  provider: ProviderConfig;
  workflow: WorkflowConfig;
  reproduction: ReproductionConfig;
}
