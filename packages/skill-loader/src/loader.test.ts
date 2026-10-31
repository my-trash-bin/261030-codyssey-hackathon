import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SkillPackError } from '@safehandoff/core-interface';
import { FsSkillPackLoader, PACK_LIMITS } from './index.ts';
import type { SkillCatalog, SkillPackPin } from './index.ts';

const fixture = new URL('../../../fixtures/skills/vendorstore-support/', import.meta.url);
const catalog: SkillCatalog = { productIds: ['vendorstore-lab'], purposeIds: ['vendor_support'],
  toolIds: ['derive_series_v1', 'render_timeline_v1', 'make_config_example_v1', 'check_doc_ip_context_v1'], templateIds: ['vendor_support.v1'] };
const code = (expected: string) => (error: unknown) => error instanceof SkillPackError && error.code === expected && error.message === expected;
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const linuxTest = (name: string, run: () => Promise<void>) => test(name, {
  skip: process.platform !== 'linux' ? 'Requires Linux descriptor-relative /proc filesystem traversal' : false,
}, run);

test('unsupported platforms reject pack loading without a weaker filesystem fallback', {
  skip: process.platform === 'linux' ? 'Non-Linux platform contract' : false,
}, async () => {
  await assert.rejects(new FsSkillPackLoader(catalog).load('/unavailable-pack'), code('PACK_MANIFEST_INVALID'));
});
async function temporary(run: (root: string, parent: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'safehandoff-pack-')), root = join(parent, 'pack');
  try { await cp(fixture, root, { recursive: true }); await run(root, parent); }
  finally { await rm(parent, { recursive: true, force: true }); }
}
async function alter(root: string, mutate: (manifest: Record<string, any>) => void) {
  const path = join(root, 'manifest.json'); const manifest = JSON.parse(await readFile(path, 'utf8'));
  mutate(manifest); await writeFile(path, JSON.stringify(manifest));
}
const pin = (pack: Awaited<ReturnType<FsSkillPackLoader['load']>>): SkillPackPin => ({ id: pack.manifest.id, version: pack.manifest.version,
  manifest_sha256: pack.manifest_sha256, pack_sha256: pack.pack_sha256 });

linuxTest('real fixture bytes have stable sorted digests and binary-safe base64', async () => {
  await temporary(async root => {
    await writeFile(join(root, 'assets', 'binary.bin'), Buffer.from([0, 255, 13, 10]));
    const loader = new FsSkillPackLoader(catalog), pack = await loader.load(root);
    assert.deepEqual(loader.info, { implementation: 'fs', ready: true });
    assert.equal(pack.manifest_sha256, hash(await readFile(join(root, 'manifest.json'))));
    assert(pack.files.some(file => file.relative_path === 'manifest.json'));
    assert.deepEqual(pack.files.map(file => file.relative_path), pack.files.map(file => file.relative_path).sort());
    for (const file of pack.files) {
      const bytes = await readFile(join(root, file.relative_path));
      assert.deepEqual(Buffer.from(file.bytes, 'base64'), bytes); assert.equal(file.sha256, hash(bytes));
    }
    assert.equal(pack.pack_sha256, hash(JSON.stringify(pack.files.map(file => [file.relative_path, file.sha256]))));
    assert.deepEqual(await loader.verify(root, pin(pack)), pack);
    await temporary(async otherRoot => {
      await writeFile(join(otherRoot, 'assets', 'binary.bin'), Buffer.from([0, 255, 13, 10]));
      assert.equal((await loader.load(otherRoot)).pack_sha256, pack.pack_sha256);
    });
  });
});
linuxTest('same version changed document asset manifest or added file rejects the registered pin', async () => {
  for (const path of ['references/analysis.md', 'assets/support-request-template.json', 'manifest.json', 'assets/new.txt']) {
    await temporary(async root => {
      const loader = new FsSkillPackLoader(catalog), installed = await loader.load(root);
      const bytes = path === 'manifest.json' ? '\n' + await readFile(join(root, path), 'utf8') : 'changed bytes';
      await writeFile(join(root, path), bytes);
      assert.equal((await loader.load(root)).manifest.version, installed.manifest.version);
      await assert.rejects(loader.verify(root, pin(installed)), code('PACK_DIGEST_MISMATCH'));
    });
  }
});
linuxTest('unknown fields wrong versions duplicate JSON keys and invalid UTF-8 are rejected', async () => {
  const invalid = [
    '{}', '{', 'null', '[]',
    '{"schema_version":"skill_manifest.v1","schema_version":"skill_manifest.v1"}',
    Buffer.from([0xff, 0xfe]),
  ];
  await temporary(async root => {
    const original = await readFile(join(root, 'manifest.json'), 'utf8');
    invalid.push(original.replace('"version":', '"version":"0.0.0","ver\\u0073ion":'));
    invalid.push(original.replace('"analyst":', '"analyst":[],"analyst":'));
    for (const bytes of invalid) {
      await writeFile(join(root, 'manifest.json'), bytes);
      await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_MANIFEST_INVALID'));
    }
  });
  for (const mutate of [
    (m: any) => { m.extra = true; }, (m: any) => { m.schema_version = 'skill_manifest.v2'; },
    (m: any) => { m.version = ''; }, (m: any) => { m.role_documents = []; },
    (m: any) => { m.role_documents.writer = 'SKILL.md'; }, (m: any) => { m.product_ids = []; },
    (m: any) => { m.product_ids = ['not-registered']; }, (m: any) => { m.purpose_ids = ['not-registered']; },
    (m: any) => { m.tool_ids = ['not-registered']; }, (m: any) => { m.template_ids = ['not-registered']; },
    (m: any) => { m.tool_ids.push(m.tool_ids[0]); },
  ]) await temporary(async root => {
    await alter(root, mutate); await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_MANIFEST_INVALID'));
  });
});
linuxTest('invalid references and aliases fail; cross-role reuse of one file is valid', async () => {
  for (const [path, expected] of [['../outside.md', 'PACK_PATH_ESCAPES_ROOT'], ['/etc/passwd', 'PACK_PATH_ABSOLUTE'],
    ['references/missing.md', 'PACK_REFERENCE_MISSING'], ['references', 'PACK_REFERENCE_MISSING'],
    ['./SKILL.md', 'PACK_MANIFEST_INVALID']]) {
    await temporary(async root => {
      await alter(root, m => { m.role_documents.writer = [path]; });
      await assert.rejects(new FsSkillPackLoader(catalog).load(root), code(expected!));
    });
  }
  await temporary(async root => {
    await alter(root, m => { m.role_documents.reviewer = ['SKILL.md']; });
    const loader = new FsSkillPackLoader(catalog);
    await loader.load(root);
    await alter(root, m => { m.role_documents.writer = ['SKILL.md', './SKILL.md']; });
    await assert.rejects(loader.load(root), code('PACK_PATH_DUPLICATE'));
  });
});
linuxTest('file directory root and parent symlinks are never followed, including unreferenced files', async () => {
  for (const path of ['SKILL.md', 'manifest.json', 'references', 'assets/unreferenced']) {
    await temporary(async (root, parent) => {
      const outside = join(parent, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret'), 'NEVER READ');
      await rm(join(root, path), { recursive: true, force: true }); await symlink(outside, join(root, path));
      await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_PATH_SYMLINK'));
    });
  }
  await temporary(async (root, parent) => {
    await symlink(root, join(parent, 'alias'));
    const loader = new FsSkillPackLoader(catalog);
    await assert.rejects(loader.load(join(parent, 'alias')), code('PACK_PATH_SYMLINK'));
    await assert.rejects(loader.load(join(parent, 'alias', 'references')), code('PACK_PATH_SYMLINK'));
  });
});
linuxTest('hardlinks special files and case aliases are rejected before content reads', async () => {
  await temporary(async (root, parent) => {
    const outside = join(parent, 'outside.txt'); await writeFile(outside, 'private');
    await link(outside, join(root, 'assets', 'hardlink'));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_PATH_ESCAPES_ROOT'));
  });
  await temporary(async root => {
    execFileSync('mkfifo', [join(root, 'assets', 'pipe')]);
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_PATH_ESCAPES_ROOT'));
  });
  await temporary(async root => {
    await writeFile(join(root, 'skill.md'), 'alias');
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_PATH_DUPLICATE'));
  });
});
linuxTest('missing entrypoints and references fail without exposing filesystem paths', async () => {
  for (const path of ['SKILL.md', 'manifest.json', 'references/analysis.md']) await temporary(async root => {
    await rm(join(root, path));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_REFERENCE_MISSING'));
  });
  await assert.rejects(new FsSkillPackLoader(catalog).load('/nonexistent-safehandoff-pack'), code('PACK_REFERENCE_MISSING'));
});
linuxTest('bounded traversal rejects oversized files manifests total bytes depth and file counts', async () => {
  await temporary(async root => {
    await writeFile(join(root, 'assets', 'large'), Buffer.alloc(PACK_LIMITS.fileBytes + 1));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
  await temporary(async root => {
    await writeFile(join(root, 'manifest.json'), ' '.repeat(PACK_LIMITS.manifestBytes + 1));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
  await temporary(async root => {
    for (let i = 0; i < 9; i++) await writeFile(join(root, 'assets', `blob-${i}`), Buffer.alloc(PACK_LIMITS.fileBytes));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
  await temporary(async root => {
    await mkdir(join(root, ...Array(18).fill('nested')), { recursive: true });
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
  await temporary(async root => {
    for (let i = 0; i < PACK_LIMITS.entries; i++) await mkdir(join(root, `directory-${i}`));
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
  await temporary(async root => {
    for (let i = 0; i < PACK_LIMITS.files; i++) await writeFile(join(root, 'assets', `file-${i}`), 'small');
    await assert.rejects(new FsSkillPackLoader(catalog).load(root), code('PACK_LIMIT_EXCEEDED'));
  });
});
linuxTest('scripts are only hashed; catalogue is copied and returned objects do not mutate loader state', async () => {
  await temporary(async (root, parent) => {
    await mkdir(join(root, 'scripts')); const marker = join(parent, 'executed');
    await writeFile(join(root, 'scripts', 'example.js'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad');`);
    const supplied = structuredClone(catalog), loader = new FsSkillPackLoader(supplied);
    supplied.productIds = [];
    const loaded = await loader.load(root); assert(loaded.files.some(file => file.relative_path === 'scripts/example.js'));
    loaded.manifest.product_ids = []; loaded.files.length = 0;
    assert((await loader.load(root)).files.length > 0);
    await assert.rejects(readFile(marker), (error: any) => error.code === 'ENOENT');
  });
});

linuxTest('pins and catalogue validation reject malformed or unregistered identities', async () => {
  assert.throws(() => new FsSkillPackLoader({ ...catalog, productIds: ['vendorstore-lab', 'vendorstore-lab'] }), code('PACK_MANIFEST_INVALID'));
  await temporary(async root => {
    const loader = new FsSkillPackLoader(catalog), installed = await loader.load(root), pinned = pin(installed);
    await assert.rejects(loader.verify(root, { ...pinned, id: 'other-pack' }), code('PACK_DIGEST_MISMATCH'));
    await assert.rejects(loader.verify(root, { ...pinned, version: '2.0.0' }), code('PACK_DIGEST_MISMATCH'));
    await assert.rejects(loader.verify(root, { ...pinned, pack_sha256: 'not-a-digest' }), code('PACK_MANIFEST_INVALID'));
    await assert.rejects(loader.verify(root, { ...pinned, extra: true } as never), code('PACK_MANIFEST_INVALID'));
  });
});
