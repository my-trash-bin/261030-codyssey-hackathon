import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BigIntStats } from 'node:fs';
import { normalizePackPath, SkillPackError, validatePackLayout } from '@safehandoff/core-interface';

export const PACK_LIMITS = Object.freeze({ files: 128, entries: 256, depth: 16, fileBytes: 1024 * 1024,
  totalBytes: 8 * 1024 * 1024, manifestBytes: 64 * 1024 });
const limit = (): never => { throw new SkillPackError('PACK_LIMIT_EXCEEDED'); };
const anchor = (directory: FileHandle, name: string) => `/proc/self/fd/${directory.fd}/${name}`;
const unchanged = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

async function openDirectory(path: string): Promise<FileHandle> {
  try { return await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((await lstat(path).catch(() => null))?.isSymbolicLink()) throw new SkillPackError('PACK_PATH_SYMLINK');
    throw error;
  }
}
async function openRoot(root: string): Promise<FileHandle> {
  // Linux descriptor-relative traversal prevents parent-directory substitution from
  // redirecting a later file read outside the opened root. No pack symlinks are followed.
  let handle = await openDirectory('/');
  try {
    for (const component of resolve(root).split('/').filter(Boolean)) {
      const next = await openDirectory(anchor(handle, component));
      try { await handle.close(); } catch (error) { await next.close(); throw error; }
      handle = next;
    }
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function readFile(directory: FileHandle, name: string, expected: BigIntStats, maxBytes: number): Promise<Buffer> {
  if (expected.size > BigInt(maxBytes)) limit();
  const handle = await open(anchor(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new SkillPackError('PACK_PATH_ESCAPES_ROOT');
    if (!unchanged(before, expected)) throw new SkillPackError('PACK_DIGEST_MISMATCH');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (BigInt(size) !== before.size || !unchanged(before, await handle.stat({ bigint: true }))) {
      throw new SkillPackError('PACK_DIGEST_MISMATCH');
    }
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
export async function readPackTree(root: string): Promise<Map<string, Buffer>> {
  if (process.platform !== 'linux' || typeof root !== 'string' || !root || root.includes('\0')) {
    throw new SkillPackError('PACK_MANIFEST_INVALID');
  }
  const rootHandle = await openRoot(root);
  const files = new Map<string, Buffer>();
  let total = 0, entries = 0;
  async function visit(directory: FileHandle, prefix: string, depth: number): Promise<void> {
    if (depth > PACK_LIMITS.depth) limit();
    const before = await directory.stat({ bigint: true });
    const names: string[] = [];
    for await (const entry of await opendir(`/proc/self/fd/${directory.fd}`)) {
      if (++entries > PACK_LIMITS.entries) limit();
      names.push(entry.name);
    }
    // Check directory aliases separately; paths to regular files are checked as a set below.
    validatePackLayout(names);
    for (const name of names.sort()) {
      const relative = prefix + name;
      if (normalizePackPath(relative) !== relative || relative.length > 1024) throw new SkillPackError('PACK_MANIFEST_INVALID');
      const stat = await lstat(anchor(directory, name), { bigint: true });
      if (stat.isSymbolicLink()) throw new SkillPackError('PACK_PATH_SYMLINK');
      if (stat.isDirectory()) {
        const child = await openDirectory(anchor(directory, name));
        try {
          if (!unchanged(stat, await child.stat({ bigint: true }))) throw new SkillPackError('PACK_DIGEST_MISMATCH');
          await visit(child, relative + '/', depth + 1);
        } finally { await child.close(); }
      } else {
        if (!stat.isFile() || stat.nlink !== 1n) throw new SkillPackError('PACK_PATH_ESCAPES_ROOT');
        if (files.size >= PACK_LIMITS.files || stat.size > BigInt(PACK_LIMITS.fileBytes) ||
          total + Number(stat.size) > PACK_LIMITS.totalBytes) limit();
        const bytes = await readFile(directory, name, stat, relative === 'manifest.json' ? PACK_LIMITS.manifestBytes : PACK_LIMITS.fileBytes);
        total += bytes.length; files.set(relative, bytes);
      }
    }
    if (!unchanged(before, await directory.stat({ bigint: true }))) throw new SkillPackError('PACK_DIGEST_MISMATCH');
  }
  try { await visit(rootHandle, '', 0); validatePackLayout([...files.keys()]); return files; }
  finally { await rootHandle.close(); }
}
