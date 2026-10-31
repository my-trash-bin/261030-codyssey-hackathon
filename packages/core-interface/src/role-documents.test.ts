import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillPackError } from './skills.ts';
import { roleDocuments } from './role-documents.ts';
import type { SkillPack } from './skills.ts';

function pack(roleDocs: Record<string, string[]>, files: { relative_path: string; sha256: string; bytes: string }[]): SkillPack {
  return {
    manifest: { schema_version: 'skill_manifest.v1', id: 'p', version: '1.0.0', product_ids: ['x'], purpose_ids: ['y'],
      role_documents: roleDocs, tool_ids: [], template_ids: [] },
    manifest_sha256: 'a'.repeat(64), files, pack_sha256: 'b'.repeat(64),
  };
}

test('roleDocuments resolves only the files listed for that role, in manifest order', () => {
  const skill = pack({ writer: ['references/public-writing.md'], analyst: ['SKILL.md', 'references/analysis.md'] }, [
    { relative_path: 'SKILL.md', sha256: 's1', bytes: 'YQ==' },
    { relative_path: 'references/analysis.md', sha256: 's2', bytes: 'Yg==' },
    { relative_path: 'references/public-writing.md', sha256: 's3', bytes: 'Yw==' },
  ]);
  assert.deepEqual(roleDocuments(skill, 'writer').map(file => file.relative_path), ['references/public-writing.md']);
  assert.deepEqual(roleDocuments(skill, 'analyst').map(file => file.relative_path), ['SKILL.md', 'references/analysis.md']);
});

test('a role absent from role_documents returns no files, not an error', () => {
  const skill = pack({ writer: ['references/public-writing.md'] }, [{ relative_path: 'references/public-writing.md', sha256: 's', bytes: 'YQ==' }]);
  assert.deepEqual(roleDocuments(skill, 'reviewer'), []);
});

test('a role_documents reference missing from files is an inconsistent pack, rejected rather than dropped', () => {
  const skill = pack({ writer: ['references/public-writing.md'] }, []);
  assert.throws(() => roleDocuments(skill, 'writer'), (error: unknown) => error instanceof SkillPackError && error.code === 'PACK_REFERENCE_MISSING');
});
