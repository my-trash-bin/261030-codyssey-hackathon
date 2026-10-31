// @ts-check
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerPack } from './pack-register.mjs';
import { selectToyrecordPack, toyrecordAllowlist } from './toyrecord-pack.mjs';
import { parseSmokeArguments } from './oss-repro-smoke.mjs';
const source = fileURLToPath(new URL('../fixtures/skills/toyrecord-repro/', import.meta.url));
const image = `sha256:${'a'.repeat(64)}`;
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'toyrecord-pack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const packRoot = join(dir, 'pack'); await cp(source, packRoot, { recursive: true });
  async function registered() {
    const result = await registerPack({ packRoot, allowlist: toyrecordAllowlist, catalog: [] });
    return { catalog: result.catalog, version: '1.0.0', installation: { schema_version: 'toyrecord_installation.v1',
      pack: result.pin, target_pair_id: 'toyrecord.sandbox-observation.v1', image } };
  }
  return { packRoot, registered, options: await registered() };
}
test('catalog selects a pinned installed pack without exposing its path', async t => {
  const { options } = await setup(t);
  const result = await selectToyrecordPack(options);
  assert.equal(result.pack.id, 'toyrecord-repro');
  assert.equal(result.image, image);
  assert.equal(result.specification.codepoint_count, 6);
  assert.match(result.skill_set_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('root'), false);
});
test('selection rejects missing versions, duplicates, and altered installation binding', async t => {
  const { options } = await setup(t);
  for (const catalog of [[], [...options.catalog, ...options.catalog]]) {
    await assert.rejects(selectToyrecordPack({ ...options, catalog }), /TOYRECORD_PACK_SELECTION_INVALID/);
  }
  await assert.rejects(selectToyrecordPack({ ...options, version: '2' }), /TOYRECORD_PACK_SELECTION_INVALID/);
  for (const patch of [{ image: 'latest' }, { target_pair_id: 'other' }, { pack: { ...options.installation.pack, pack_sha256: 'b'.repeat(64) } }, { argv: ['sh'] }]) {
    await assert.rejects(selectToyrecordPack({ ...options, installation: { ...options.installation, ...patch } }), /TOYRECORD_INSTALLATION_MISMATCH/);
  }
});
test('changes after installation fail pin verification', async t => {
  const { options, packRoot } = await setup(t);
  await writeFile(join(packRoot, 'SKILL.md'), 'changed');
  await assert.rejects(selectToyrecordPack(options), /PACK_DIGEST_MISMATCH/);
});
test('even a repinned pack must satisfy required tools and fixed reproduction spec', async t => {
  const { options, packRoot, registered } = await setup(t);
  const path = join(packRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.tool_ids = ['make_synthetic_inputs_v1'];
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(selectToyrecordPack(await registered()), /TOYRECORD_PACK_CONTRACT_INVALID/);
  manifest.tool_ids.push('run_repro_v1'); await writeFile(path, JSON.stringify(manifest));
  const asset = join(packRoot, 'assets/reproduction.v1.json'), original = await readFile(asset, 'utf8');
  for (const bytes of ['{}', original.replace('"codepoint_count": 6', '"codepoint_count": 7'), original.replace('"targets": [', '"argv": ["sh"],\n  "targets": [')]) {
    await writeFile(asset, bytes);
    await assert.rejects(selectToyrecordPack(await registered()), /TOYRECORD_SPEC_INVALID/);
  }
  await rm(asset);
  await assert.rejects(selectToyrecordPack(await registered()), /TOYRECORD_SPEC_INVALID/);
  assert.equal(options.installation.image, image);
});
test('operator allowlist rejects unregistered declarations', async t => {
  const { packRoot } = await setup(t), path = join(packRoot, 'manifest.json');
  const value = JSON.parse(await readFile(path, 'utf8')); value.tool_ids.push('unknown_tool');
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(registerPack({ packRoot, allowlist: toyrecordAllowlist, catalog: [] }), /PACK_MANIFEST_INVALID/);
});
test('CLI requires explicit version and rejects ambiguous or malformed flags', () => {
  assert.equal(parseSmokeArguments(['--registration', 'r']).seed, 42);
  assert.equal(parseSmokeArguments(['--registration', 'r', '--catalog', 'c', '--pack-version', '1', '--seed', '7']).seed, 7);
  for (const args of [[], ['--registration', 'r', '--catalog', 'c'], ['--registration', 'r', '--pack-version', '1'],
    ['--registration', 'r', '--registration', 's'], ['--registration', 'r', '--seed', '-1'], ['--registration', 'r', '--seed', 'NaN']]) {
    assert.throws(() => parseSmokeArguments(args), /SMOKE_ARGUMENTS_REQUIRED/);
  }
});
