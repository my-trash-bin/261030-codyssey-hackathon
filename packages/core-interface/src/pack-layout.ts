import { SkillPackError } from './skills.ts';

// Canonical portable relative paths. Filesystem loaders additionally check file types.
export function normalizePackPath(value: string): string {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new SkillPackError('PACK_MANIFEST_INVALID');
  }
  if (/^[\\/]|^[a-z]:|^[a-z][a-z0-9+.-]*:/i.test(value)) throw new SkillPackError('PACK_PATH_ABSOLUTE');
  const segments = value.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) throw new SkillPackError('PACK_PATH_ESCAPES_ROOT');
  const normalized = segments.filter(segment => segment && segment !== '.').map(segment => segment.normalize('NFC'));
  if (!normalized.length || normalized.some(segment => /[:]|[. ]$/u.test(segment) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new SkillPackError('PACK_MANIFEST_INVALID');
  return normalized.join('/');
}
export function validatePackLayout(relativePaths: string[]): void {
  if (!Array.isArray(relativePaths)) throw new SkillPackError('PACK_MANIFEST_INVALID');
  const paths = new Set<string>();
  for (const path of relativePaths) {
    const normalized = normalizePackPath(path);
    // Case aliases are rejected for packs that may be installed on different filesystems.
    const key = normalized.toLowerCase();
    if (paths.has(key)) throw new SkillPackError('PACK_PATH_DUPLICATE');
    paths.add(key);
  }
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      if (paths.has(segments.slice(0, i).join('/'))) throw new SkillPackError('PACK_PATH_DUPLICATE');
    }
  }
}
