import { normalizePackPath, SkillPackError, validatePackLayout } from '@safehandoff/core-interface';
import type { SkillManifest } from '@safehandoff/core-interface';

export interface SkillCatalog {
  productIds: readonly string[]; purposeIds: readonly string[]; toolIds: readonly string[]; templateIds: readonly string[];
}
export const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
function invalid(): never { throw new SkillPackError('PACK_MANIFEST_INVALID'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function ids(value: unknown, allowed: readonly string[], required = false): void {
  if (!Array.isArray(value) || value.length > 128 || (required && !value.length) ||
    value.some(id => !identifier(id) || !allowed.includes(id)) || new Set(value).size !== value.length) invalid();
}
// JSON.parse alone accepts duplicate keys, including escaped spellings. Fail closed first.
function parseJSON(input: string): unknown {
  try {
    const parsed: unknown = JSON.parse(input);
    const stack: (Set<string> | null)[] = [];
    let previous = '';
    for (const token of input.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? []) {
      if (token === '{') stack.push(new Set());
      else if (token === '[') stack.push(null);
      else if (token === '}' || token === ']') stack.pop();
      else if (token === ':') {
        const keys = stack.at(-1), key: string = JSON.parse(previous);
        if (!keys || keys.has(key)) invalid();
        keys.add(key);
      }
      previous = token;
    }
    return parsed;
  } catch { return invalid(); }
}
export function parseManifest(bytes: Buffer, catalog: SkillCatalog): SkillManifest {
  let input: string;
  try { input = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return invalid(); }
  const manifest = object(parseJSON(input));
  if (Object.keys(manifest).sort().join(',') !== 'id,product_ids,purpose_ids,role_documents,schema_version,template_ids,tool_ids,version' ||
    manifest.schema_version !== 'skill_manifest.v1' || !identifier(manifest.id) ||
    typeof manifest.version !== 'string' || manifest.version.length > 128 ||
    !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(manifest.version)) invalid();
  ids(manifest.product_ids, catalog.productIds, true); ids(manifest.purpose_ids, catalog.purposeIds, true);
  ids(manifest.tool_ids, catalog.toolIds); ids(manifest.template_ids, catalog.templateIds);
  const roles = object(manifest.role_documents);
  if (Object.keys(roles).length > 16) invalid();
  for (const [role, paths] of Object.entries(roles)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(role) || !Array.isArray(paths) || paths.length > 128) invalid();
    validatePackLayout(paths);
    // References use canonical spelling so the same manifest resolves on each host.
    if (paths.some(path => normalizePackPath(path) !== path || path.length > 1024)) invalid();
  }
  return manifest as unknown as SkillManifest;
}
