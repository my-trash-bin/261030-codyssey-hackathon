import { createHash } from 'node:crypto';
import type { BuiltinTool, ToolRequest, ToolResult } from '@safehandoff/core-interface';
import { deriveSeries, renderTimeline, makeConfigExample, makeSyntheticInputs, renderApprovedExcerpt } from './transforms.ts';
export type BuiltinToolId = 'derive_series_v1' | 'render_timeline_v1' | 'make_config_example_v1' |
  'make_synthetic_inputs_v1' | 'render_approved_excerpt_v1';
export interface BuiltinAuthority {
  task_id: string; revision: number;
  // Internal server-validated grants only. Request strings never create permission.
  grants: { id: string; tool_id: BuiltinToolId; arguments_sha256: string }[];
}
export class BuiltinInputError extends Error {}
export function requireInput(condition: unknown, code = 'INVALID_TOOL_INPUT'): asserts condition {
  if (!condition) throw new BuiltinInputError(code);
}
export function fields(value: unknown, required: string[], optional: string[] = []): Record<string, any> {
  requireInput(value && typeof value === 'object' && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  requireInput(required.every(key => Object.hasOwn(record, key)) && Object.keys(record).every(key => [...required, ...optional].includes(key)));
  return record;
}
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function builtinArgumentsHash(value: unknown): string {
  const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    requireInput(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
    return value;
  };
  const bytes = JSON.stringify(canonical(value)); requireInput(Buffer.byteLength(bytes) <= 1024 * 1024);
  return sha256(bytes);
}
const transforms: Record<BuiltinToolId, (args: unknown) => unknown> = {
  derive_series_v1: deriveSeries, render_timeline_v1: renderTimeline, make_config_example_v1: makeConfigExample,
  make_synthetic_inputs_v1: makeSyntheticInputs, render_approved_excerpt_v1: renderApprovedExcerpt,
};
export function createBuiltinTools(authority: BuiltinAuthority): Record<BuiltinToolId, BuiltinTool> {
  const bound = structuredClone(authority);
  return Object.fromEntries(Object.entries(transforms).map(([id, transform]) => [id, {
    tool_id: id, kind: 'builtin', run(request: ToolRequest): ToolResult {
      try {
        fields(request, ['tool_id', 'tool_version', 'task_id', 'revision', 'grant_ids', 'arguments']);
        requireInput(request.tool_id === id && request.tool_version === '1.0.0' && request.task_id === bound.task_id &&
          request.revision === bound.revision && Number.isSafeInteger(request.revision) && request.revision > 0 &&
          Array.isArray(request.grant_ids) && request.grant_ids.length > 0 && request.grant_ids.length <= 100 &&
          new Set(request.grant_ids).size === request.grant_ids.length, 'TOOL_ACCESS_DENIED');
        const digest = builtinArgumentsHash(request.arguments);
        requireInput(request.grant_ids.every(grantId => bound.grants.filter(grant => grant.id === grantId && grant.tool_id === id &&
          grant.arguments_sha256 === digest).length === 1), 'TOOL_ACCESS_DENIED');
        return { status: 'ok', public_result: transform(request.arguments), internal_diagnostics: null };
      } catch (error) {
        const code = error instanceof BuiltinInputError ? error.message : 'INVALID_TOOL_INPUT';
        return { status: code === 'TOOL_ACCESS_DENIED' ? 'denied' : 'error', public_result: null, internal_diagnostics: { code } };
      }
    },
  }])) as Record<BuiltinToolId, BuiltinTool>;
}
