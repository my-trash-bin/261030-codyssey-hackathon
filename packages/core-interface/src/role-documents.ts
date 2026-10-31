import { SkillPackError } from './skills.ts';
import type { SkillPack, SkillPackFile } from './skills.ts';

// Role-scoped projection over an already-loaded pack. A role with no entry gets nothing (not an
// error) -- most packs only define writer/analyst/reviewer, not every role a caller might ask
// about. A role that IS listed but references a file missing from `files` is an inconsistent
// pack that should never have loaded; fail closed rather than silently dropping content.
export function roleDocuments(pack: SkillPack, role: string): SkillPackFile[] {
  const paths = pack.manifest.role_documents[role];
  if (!paths) return [];
  const files = new Map(pack.files.map(file => [file.relative_path, file]));
  return paths.map(path => {
    const file = files.get(path);
    if (!file) throw new SkillPackError('PACK_REFERENCE_MISSING');
    return file;
  });
}
