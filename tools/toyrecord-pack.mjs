// @ts-check
import { isDeepStrictEqual } from 'node:util';
import { FsSkillPackLoader, skillSetHash } from '../packages/skill-loader/dist/index.js';

// Operator-owned allowlist and supported runner contract; never derive authority from the pack.
export const toyrecordAllowlist = Object.freeze({ productIds: ['toyrecord'], purposeIds: ['oss_issue'],
  toolIds: ['make_synthetic_inputs_v1', 'run_repro_v1'], templateIds: ['oss_issue.v1'] });
const specification = { schema_version: 'toyrecord_reproduction.v1', target_pair_id: 'toyrecord.sandbox-observation.v1',
  oracle_id: 'toyrecord.encode.v1', supervisor: 'sandbox_observation.v1', targets: ['buggy', 'fixed'],
  input_kinds: ['ascii', 'multibyte'], codepoint_count: 6, tool_ids: ['make_synthetic_inputs_v1', 'run_repro_v1'], result_contract: 'target_run.v1' };
function requireValue(condition, code) { if (!condition) throw new Error(code); }
const keys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join(',') : '';

export async function selectToyrecordPack({ catalog, version, installation }) {
  requireValue(Array.isArray(catalog) && typeof version === 'string' && version.length > 0, 'TOYRECORD_CATALOG_INVALID');
  const selected = catalog.filter(entry => entry?.id === 'toyrecord-repro' && entry.version === version);
  requireValue(selected.length === 1, 'TOYRECORD_PACK_SELECTION_INVALID');
  const entry = selected[0];
  requireValue(keys(entry) === 'id,manifest_sha256,pack_sha256,root,version' && typeof entry.root === 'string' && entry.root.startsWith('/'), 'TOYRECORD_CATALOG_INVALID');
  const { root, ...pin } = entry;
  const pack = await new FsSkillPackLoader(toyrecordAllowlist).verify(root, pin);
  requireValue(isDeepStrictEqual(pack.manifest.product_ids, ['toyrecord']) &&
    isDeepStrictEqual(pack.manifest.purpose_ids, ['oss_issue']) &&
    isDeepStrictEqual(pack.manifest.template_ids, ['oss_issue.v1']) &&
    specification.tool_ids.every(id => pack.manifest.tool_ids.includes(id)), 'TOYRECORD_PACK_CONTRACT_INVALID');
  const asset = pack.files.find(file => file.relative_path === 'assets/reproduction.v1.json');
  requireValue(asset, 'TOYRECORD_SPEC_INVALID');
  let spec;
  try {
    const bytes = Buffer.from(asset.bytes, 'base64');
    spec = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // Canonical asset bytes also reject duplicate JSON keys without a second JSON parser.
    requireValue(bytes.toString('utf8').trim() === JSON.stringify(spec, null, 2), 'TOYRECORD_SPEC_INVALID');
  } catch { throw new Error('TOYRECORD_SPEC_INVALID'); }
  requireValue(isDeepStrictEqual(spec, specification), 'TOYRECORD_SPEC_INVALID');
  requireValue(keys(installation) === 'image,pack,schema_version,target_pair_id' &&
    installation.schema_version === 'toyrecord_installation.v1' && isDeepStrictEqual(installation.pack, pin) &&
    installation.target_pair_id === spec.target_pair_id && /^sha256:[a-f0-9]{64}$/.test(installation.image), 'TOYRECORD_INSTALLATION_MISMATCH');
  return { pack: pin, specification: spec, image: installation.image,
    skill_set_hash: skillSetHash([pin]) };
}
