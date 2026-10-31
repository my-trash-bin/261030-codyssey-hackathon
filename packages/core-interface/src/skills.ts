// F07 domain extension packs (docs/extensions.md §2-3, docs/features/07-domain-extensions.md).
// A pack bundles product-specific instructions following the Agent Skills folder convention
// (SKILL.md/references/assets/scripts) plus the tool/template ids it requires. Loading one is
// not a pure transform (it has to walk a filesystem and resolve symlinks), so it is a port
// like ModelClient/ReproRunner, not a declared pure function. The structural checks that *are*
// pure (no absolute paths, no traversal, no duplicates) are split out as validatePackLayout so
// they can run on a plain path list without touching disk.
export interface SkillManifest {              // == skill_manifest.v1
  schema_version: 'skill_manifest.v1';
  id: string;
  version: string;
  product_ids: string[];
  purpose_ids: string[];
  role_documents: Record<string, string[]>;   // role name -> pack-relative file paths
  tool_ids: string[];
  template_ids: string[];
}

export interface SkillPackFile { relative_path: string; sha256: string; bytes: string } // base64

// A pack as resolved and digest-pinned at install time (extensions.md §2: "설치 시 manifest와
// 참조 파일의 digest를 고정한다"). role_documents/tool_ids/template_ids stay on the manifest;
// this adds the file contents/digests used to pin a version and to build skillSetHash.
export interface SkillPack {
  manifest: SkillManifest;
  manifest_sha256: string;
  files: SkillPackFile[];        // every regular file, including manifest.json; scripts are never executed
  pack_sha256: string;           // hash of the sorted (relative_path, sha256) list
}

export type SkillPackErrorCode =
  | 'PACK_PATH_ESCAPES_ROOT'
  | 'PACK_PATH_ABSOLUTE'
  | 'PACK_PATH_SYMLINK'
  | 'PACK_PATH_DUPLICATE'
  | 'PACK_MANIFEST_INVALID'
  | 'PACK_REFERENCE_MISSING'
  | 'PACK_DIGEST_MISMATCH'
  | 'PACK_LIMIT_EXCEEDED';
export class SkillPackError extends Error {
  readonly code: SkillPackErrorCode;
  constructor(code: SkillPackErrorCode) { super(code); this.code = code; }
}

// Pure structural check over pack-relative path strings only: rejects absolute paths, `..`
// traversal and duplicate normalized paths (extensions.md §2: "각 경로는 팩 루트 아래
// 상대경로만 허용하고 상위경로·절대경로·심볼릭 링크·중복 이름을 거부한다"). Symlink
// detection needs an actual filesystem stat and belongs to SkillPackLoader below, not here.
export { normalizePackPath, validatePackLayout } from './pack-layout.ts';

// Role-scoped projection: only the files listed for `role` in role_documents, resolved to
// bytes. This is the boundary that keeps internal-only SKILL.md content out of the writer's
// prompt (extensions.md: "public-writing 문서와 공개 assets는 ... writer에 내부 문서를
// 대신 넣지 않는다"). Pure given an already-loaded pack.
export { roleDocuments } from './role-documents.ts';

// task_snapshots.skill_set_hash (hash of the sorted (id, version, pack_sha256) list of a task's
// active packs) is NOT declared here. Computing it needs a sha256 primitive, which is exactly
// the Node dependency this package excludes (see SkillPackLoader above) -- it is implemented as
// `skillSetHash` in packages/skill-loader, next to the sha256 helper that already produces
// pack_sha256/manifest_sha256.

// The actual filesystem-reading side: resolves a pack root to a digest-pinned SkillPack,
// following symlinks defensively (reject, never follow) and failing closed on any manifest/
// reference mismatch. Implemented by packages/skill-loader, using the same port pattern as
// RealCore/DockerReproRunner/OpenAICompatibleModelClient.
export interface SkillPackLoaderInfo { implementation: 'fs' | 'fake'; ready: boolean }
export interface SkillPackLoader {
  readonly info: SkillPackLoaderInfo;
  load(root: string): Promise<SkillPack>;
}
