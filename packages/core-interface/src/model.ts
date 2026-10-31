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
export interface ModelClient {
  readonly info: ModelClientInfo;
  complete(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse>;
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
  max_output_tokens: number;
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
