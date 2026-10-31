import type { ModelAtomicSchema, ModelObjectSchema, ModelRole, ModelValueSchema } from '@safehandoff/core-interface';
import { reasonCodes } from './validation.ts';
const text: ModelAtomicSchema = { type: 'string', maxLength: 8192 };
const choice = (...values: string[]): ModelAtomicSchema => ({ type: 'string', enum: values });
const array = (items: ModelValueSchema, maxItems = 100): ModelAtomicSchema => ({ type: 'array', items, maxItems });
const nullable = (schema: ModelAtomicSchema): ModelValueSchema => ({ anyOf: [schema, { type: 'null' }] });
const strings = array(text);
const object = (properties: Record<string, ModelValueSchema>, optional: string[] = []): ModelObjectSchema =>
  ({ type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
const block = (type: string, properties: Record<string, ModelValueSchema>, optional: string[] = []): ModelObjectSchema =>
  object({ type: choice(type), block_id: text, fact_ids: strings, ...properties }, ['block_id', 'fact_ids', ...optional]);
const draft = object({ schema_version: choice('draft.v1'), blocks: { type: 'array', minItems: 1, maxItems: 60, items: { anyOf: [
  block('heading', { level: { type: 'integer', minimum: 1, maximum: 6 }, text }), block('paragraph', { text }),
  block('list', { items: { type: 'array', minItems: 1, maxItems: 100, items: object({ text, fact_ids: strings }) } }),
  block('table_ref', { table_id: text }), block('excerpt_ref', { excerpt_id: text }), block('asset_ref', { asset_id: text }),
] } } });
const review = object({ schema_version: choice('review.v1'), result: choice('pass', 'needs_changes', 'needs_decision', 'error'),
  issues: array(object({ target: { anyOf: [object({ kind: choice('document') }), object({ kind: choice('block'), block_id: text })] },
    reason_code: choice(...reasonCodes), action: nullable(text), approved_fact_ids: strings, candidate_ids: strings, internal_explanation: text })) });
const analysis = object({ schema_version: choice('candidate_proposals.v1'), candidates: nullable(array(object({
  local_key: text, kind: choice('observation', 'constraint', 'hypothesis', 'unknown', 'identifier'),
  uncertainty: choice('observed', 'reported', 'inferred', 'unknown'), statement: text, evidence_ids: nullable(strings),
  relevance: choice('required', 'optional'), purpose_relevance: text,
}), 30)), conflicts: nullable(array(object({ local_keys: nullable(strings), reason: text }))) });
export function responseSchema(role: ModelRole): ModelObjectSchema | undefined {
  return role === 'analysis' ? analysis : role === 'writer' ? draft : role === 'reviewer' ? review : undefined;
}
