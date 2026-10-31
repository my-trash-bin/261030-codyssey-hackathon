import { createHash } from 'node:crypto';
import { SkillPackError } from '@safehandoff/core-interface';
import type { SkillPack, SkillPackLoader, SkillPackLoaderInfo } from '@safehandoff/core-interface';
import { readPackTree } from './filesystem.ts';
import { identifier, parseManifest } from './manifest.ts';
import type { SkillCatalog } from './manifest.ts';

export type { SkillCatalog } from './manifest.ts';
export { PACK_LIMITS } from './filesystem.ts';
export interface SkillPackPin { id: string; version: string; manifest_sha256: string; pack_sha256: string }
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const invalid = (): never => { throw new SkillPackError('PACK_MANIFEST_INVALID'); };

export class FsSkillPackLoader implements SkillPackLoader {
  readonly info: SkillPackLoaderInfo = Object.freeze({ implementation: 'fs', ready: true });
  private readonly catalog: SkillCatalog;
  constructor(catalog: SkillCatalog) {
    if (!catalog || Object.keys(catalog).sort().join(',') !== 'productIds,purposeIds,templateIds,toolIds') invalid();
    for (const ids of Object.values(catalog)) {
      if (!Array.isArray(ids) || ids.some(id => !identifier(id)) || new Set(ids).size !== ids.length) invalid();
    }
    this.catalog = structuredClone(catalog);
  }
  async load(root: string): Promise<SkillPack> {
    try {
      const tree = await readPackTree(root);
      const bytes = tree.get('manifest.json');
      if (!bytes || !tree.has('SKILL.md')) throw new SkillPackError('PACK_REFERENCE_MISSING');
      const manifest = parseManifest(bytes, this.catalog);
      for (const paths of Object.values(manifest.role_documents)) for (const path of paths) {
        if (!tree.has(path)) throw new SkillPackError('PACK_REFERENCE_MISSING');
      }
      const files = [...tree].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relative_path, bytes]) => ({
        relative_path, sha256: sha256(bytes), bytes: bytes.toString('base64'),
      }));
      return { manifest, manifest_sha256: sha256(bytes), files,
        pack_sha256: sha256(JSON.stringify(files.map(file => [file.relative_path, file.sha256]))) };
    } catch (error) {
      if (error instanceof SkillPackError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ELOOP') throw new SkillPackError('PACK_PATH_SYMLINK');
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new SkillPackError('PACK_REFERENCE_MISSING');
      // Do not expose installation paths or OS error messages to callers.
      throw new SkillPackError('PACK_MANIFEST_INVALID');
    }
  }
  async verify(root: string, pin: SkillPackPin): Promise<SkillPack> {
    if (!pin || Object.keys(pin).sort().join(',') !== 'id,manifest_sha256,pack_sha256,version' ||
      !identifier(pin.id) || typeof pin.version !== 'string' ||
      typeof pin.manifest_sha256 !== 'string' || typeof pin.pack_sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pin.manifest_sha256) || !/^[a-f0-9]{64}$/.test(pin.pack_sha256)) invalid();
    const pack = await this.load(root);
    if (pack.manifest.id !== pin.id || pack.manifest.version !== pin.version ||
      pack.manifest_sha256 !== pin.manifest_sha256 || pack.pack_sha256 !== pin.pack_sha256) {
      throw new SkillPackError('PACK_DIGEST_MISMATCH');
    }
    return pack;
  }
}

// task_snapshots.skill_set_hash: deterministic over the task's currently active packs' identity
// only (id/version/pack_sha256), never file bytes directly. Same canonicalization convention as
// pack_sha256 above: sort, then hash the JSON array -- an empty list hashes like pack_sha256
// would for zero files, sha256('[]').
export function skillSetHash(packs: { id: string; version: string; pack_sha256: string }[]): string {
  if (!Array.isArray(packs) || packs.some(pack => !pack || !identifier(pack.id) ||
    typeof pack.version !== 'string' || !/^[a-f0-9]{64}$/.test(pack.pack_sha256))) invalid();
  const tuples = packs.map(pack => JSON.stringify([pack.id, pack.version, pack.pack_sha256]));
  const sorted = [...tuples].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(tuple => JSON.parse(tuple));
  return sha256(JSON.stringify(sorted));
}
