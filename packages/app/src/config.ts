import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EngineConfig } from '@safehandoff/core-interface';
import { FileTranscriptSink, RealCore } from '@safehandoff/core';
import { OpenAICompatibleModelClient } from '@safehandoff/model-adapter';
import { DockerReproRunner } from '@safehandoff/sandbox-runner';

export function loadConfig(root: string, env: Record<string, string | undefined>): EngineConfig {
  const path = resolve(root, env.SAFEHANDOFF_CONFIG || (existsSync(resolve(root, 'config.json')) ? 'config.json' : 'config.example.json'));
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const provider = value.provider, workflow = value.workflow, reproduction = value.reproduction;
    if (!provider || !workflow || !reproduction || provider.type !== 'openai_compatible' ||
      !['text', 'json'].includes(provider.response_mode) || reproduction.runner !== 'docker' ||
      typeof reproduction.enabled !== 'boolean') throw new Error();
    for (const key of ['base_url_env', 'model_env', 'api_key_env']) {
      if (typeof provider[key] !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(provider[key])) throw new Error();
    }
    for (const key of ['supports_system_role', 'send_temperature', 'allow_plain_http']) {
      if (typeof provider[key] !== 'boolean') throw new Error();
    }
    if (!['max_tokens', 'max_completion_tokens'].includes(provider.output_limit_field) ||
      !Number.isFinite(provider.temperature) || provider.temperature < 0 || provider.temperature > 2) throw new Error();
    if (provider.max_output_tokens !== null &&
      (!Number.isSafeInteger(provider.max_output_tokens) || provider.max_output_tokens < 1)) throw new Error();
    for (const key of ['max_input_bytes', 'request_timeout_seconds', 'max_attempts_per_step', 'global_concurrency']) {
      if (!Number.isSafeInteger(provider[key]) || provider[key] < 1) throw new Error();
    }
    if (provider.request_timeout_seconds > 3600 || !Number.isSafeInteger(workflow.max_review_repairs) || workflow.max_review_repairs < 0 ||
      !Number.isSafeInteger(workflow.max_model_calls_per_run) || workflow.max_model_calls_per_run < 1) throw new Error();
    return { provider, workflow, reproduction };
  } catch { throw new Error('INVALID_ENGINE_CONFIG'); }
}
export function configuredCore(root: string, env: Record<string, string | undefined> = process.env): RealCore {
  const config = loadConfig(root, env);
  let runner: DockerReproRunner | undefined;
  if (config.reproduction.enabled && env.SAFEHANDOFF_REPRO_REGISTRY) {
    try { runner = new DockerReproRunner(JSON.parse(readFileSync(resolve(root, env.SAFEHANDOFF_REPRO_REGISTRY), 'utf8'))); }
    catch { throw new Error('INVALID_REPRO_REGISTRY'); }
  }
  const transcripts = configuredTranscripts(root, env);
  return new RealCore(new OpenAICompatibleModelClient(config.provider, env), config, runner, Date.now, transcripts);
}

export function configuredTranscripts(root: string, env: Record<string, string | undefined> = process.env): FileTranscriptSink | undefined {
  if (env.SAFEHANDOFF_TRANSCRIPT_CONTENT && env.SAFEHANDOFF_TRANSCRIPT_CONTENT !== '1') throw new Error('INVALID_TRANSCRIPT_CONFIG');
  if (env.SAFEHANDOFF_TRANSCRIPT_CONTENT && !env.SAFEHANDOFF_TRANSCRIPT_DIR) throw new Error('INVALID_TRANSCRIPT_CONFIG');
  return env.SAFEHANDOFF_TRANSCRIPT_DIR
    ? new FileTranscriptSink(resolve(root, env.SAFEHANDOFF_TRANSCRIPT_DIR), env.SAFEHANDOFF_TRANSCRIPT_CONTENT === '1') : undefined;
}

// Only authenticated workflow session responses may expose the configured provider origin.
// Strip paths, credentials and query strings; origin presence is not approval or reachability.
export function configuredAnalysisOrigin(root: string, env: Record<string, string | undefined> = process.env): string | null {
  const base = env[loadConfig(root, env).provider.base_url_env];
  if (!base) return null;
  try { const url = new URL(base); return ['http:', 'https:'].includes(url.protocol) ? url.origin : null; }
  catch { return null; }
}
