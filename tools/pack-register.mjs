// @ts-check
// F07 submission/registration CLI (docs/extensions.md §10, f07-extensions-plan.md "제출 절차").
// Loads+validates a pack directory with the install-time allowlist and appends a digest-pinned
// entry to a local catalog file. Never installs a pack by its own asserted product/purpose/tool
// IDs -- the allowlist is operator-supplied, never read from the pack itself.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FsSkillPackLoader } from '../packages/skill-loader/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));

async function readCatalog(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function registerPack({ packRoot, allowlist, catalog, force = false }) {
  const loader = new FsSkillPackLoader(allowlist);
  const pack = await loader.load(packRoot);
  const pin = { id: pack.manifest.id, version: pack.manifest.version, manifest_sha256: pack.manifest_sha256, pack_sha256: pack.pack_sha256 };
  const existingIndex = catalog.findIndex(entry => entry.id === pin.id && entry.version === pin.version);
  if (existingIndex >= 0) {
    const existing = catalog[existingIndex];
    const unchanged = existing.manifest_sha256 === pin.manifest_sha256 && existing.pack_sha256 === pin.pack_sha256;
    if (unchanged) return { catalog, changed: false, pin };
    // extensions.md §2: "version 문자열만 같고 바이트가 달라진 팩은 원래 판본으로 인정하지 않는다".
    if (!force) throw new Error('PACK_VERSION_BYTES_CHANGED');
    const next = [...catalog];
    next[existingIndex] = { ...pin, root: packRoot };
    return { catalog: next, changed: true, pin };
  }
  return { catalog: [...catalog, { ...pin, root: packRoot }], changed: true, pin };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
  const packRoot = flag('root'), allowlistPath = flag('allowlist'), catalogPath = flag('catalog'), force = args.includes('--force');
  const known = new Set(['--root', '--allowlist', '--catalog', '--force']);
  if (!packRoot || !allowlistPath || !catalogPath || args.some((arg, i) => !known.has(arg) && args[i - 1] !== '--root' &&
    args[i - 1] !== '--allowlist' && args[i - 1] !== '--catalog')) throw new Error('PACK_REGISTER_ARGUMENTS_REQUIRED');
  const allowlist = JSON.parse(await readFile(resolve(root, allowlistPath), 'utf8'));
  const catalogFile = resolve(root, catalogPath);
  const catalog = await readCatalog(catalogFile);
  const result = await registerPack({ packRoot: resolve(root, packRoot), allowlist, catalog, force });
  if (result.changed) {
    await mkdir(dirname(catalogFile), { recursive: true });
    await writeFile(catalogFile, JSON.stringify(result.catalog, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify({ changed: result.changed, pin: result.pin, catalog: catalogFile }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const known = new Set(['PACK_REGISTER_ARGUMENTS_REQUIRED', 'PACK_VERSION_BYTES_CHANGED']);
    console.error(known.has(error.message) ? error.message : (error.code || 'PACK_REGISTER_FAILED'));
    process.exitCode = 1;
  });
}
