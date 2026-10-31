// @ts-check
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerPack } from './pack-register.mjs';

const linuxTest = (name, run) => test(name, {
  skip: process.platform !== 'linux' ? 'Requires Linux descriptor-relative /proc filesystem traversal' : false,
}, run);

test('unsupported platforms reject registration without writing a catalog', {
  skip: process.platform === 'linux' ? 'Non-Linux platform contract' : false,
}, async () => {
  const catalog = [];
  await assert.rejects(registerPack({ packRoot, allowlist, catalog }), /PACK_MANIFEST_INVALID/);
  assert.deepEqual(catalog, []);
});

const packRoot = fileURLToPath(new URL('../fixtures/skills/vendorstore-support/', import.meta.url));
const allowlist = { productIds: ['vendorstore-lab'], purposeIds: ['vendor_support'],
  toolIds: ['derive_series_v1', 'render_timeline_v1', 'make_config_example_v1', 'check_doc_ip_context_v1'], templateIds: ['vendor_support.v1'] };

linuxTest('registering a new pack appends a pinned catalog entry', async () => {
  const result = await registerPack({ packRoot, allowlist, catalog: [] });
  assert.equal(result.changed, true);
  assert.equal(result.pin.id, 'vendorstore-support');
  assert.equal(result.pin.version, '1.0.0');
  assert.match(result.pin.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.catalog.length, 1);
  assert.equal(result.catalog[0].root, packRoot);
});

linuxTest('re-registering the identical pack is a no-op, not a duplicate entry', async () => {
  const first = await registerPack({ packRoot, allowlist, catalog: [] });
  const second = await registerPack({ packRoot, allowlist, catalog: first.catalog });
  assert.equal(second.changed, false);
  assert.equal(second.catalog.length, 1);
});

linuxTest('same id+version with different bytes is rejected without --force', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'safehandoff-pack-register-'));
  try {
    const { cp } = await import('node:fs/promises');
    const root = join(parent, 'pack');
    await cp(packRoot, root, { recursive: true });
    const first = await registerPack({ packRoot: root, allowlist, catalog: [] });
    // Same id/version, different bytes: content changed without a version bump.
    const skillPath = join(root, 'SKILL.md');
    await writeFile(skillPath, (await readFile(skillPath, 'utf8')) + '\nedited after install.\n');
    await assert.rejects(registerPack({ packRoot: root, allowlist, catalog: first.catalog }), /PACK_VERSION_BYTES_CHANGED/);
    const forced = await registerPack({ packRoot: root, allowlist, catalog: first.catalog, force: true });
    assert.equal(forced.changed, true);
    assert.equal(forced.catalog.length, 1);
    assert.notEqual(forced.catalog[0].pack_sha256, first.pin.pack_sha256);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('an unregistered product id is rejected before anything is written to the catalog', async () => {
  await assert.rejects(registerPack({ packRoot, allowlist: { ...allowlist, productIds: [] }, catalog: [] }), /PACK_MANIFEST_INVALID/);
});
