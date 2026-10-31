import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePackPath, SkillPackError, validatePackLayout } from './index.ts';

const code = (expected: string) => (error: unknown) => error instanceof SkillPackError && error.code === expected;
test('portable relative paths allow Korean names and normalize separators and dot segments', () => {
  validatePackLayout(['SKILL.md', 'manifest.json', 'references/공개 지침.md', 'assets/template.json']);
  assert.equal(normalizePackPath('./references//public.md'), 'references/public.md');
  assert.equal(normalizePackPath('references\\public.md'), 'references/public.md');
  validatePackLayout([]);
});
test('absolute paths URLs drive-relative paths and every parent traversal are rejected', () => {
  for (const path of ['/tmp/a', '\\server\\share', 'C:\\pack', 'C:pack', 'file:///tmp/a', 'https://example.test/a']) {
    assert.throws(() => validatePackLayout([path]), code('PACK_PATH_ABSOLUTE'));
  }
  for (const path of ['../a', 'references/../a', 'references\\..\\a', 'a/../../b']) {
    assert.throws(() => validatePackLayout([path]), code('PACK_PATH_ESCAPES_ROOT'));
  }
});
test('duplicates include normalization case Unicode and file/directory collisions', () => {
  for (const paths of [['a', './a'], ['a//b', 'a\\b'], ['SKILL.md', 'skill.md'], ['é.md', 'e\u0301.md'],
    ['references', 'references/public.md'], ['references/public.md', 'references']]) {
    assert.throws(() => validatePackLayout(paths), code('PACK_PATH_DUPLICATE'));
  }
});
test('invalid names control characters alternate streams and device aliases fail closed', () => {
  for (const path of ['', '.', './', 'x\u0000y', 'x\ny', 'x\u202ey', 'a:b', 'references/file:stream', 'a.', 'a ', 'NUL.md', 'con/file']) {
    assert.throws(() => validatePackLayout([path]), SkillPackError);
  }
  assert.throws(() => validatePackLayout([null] as never), SkillPackError);
  assert.throws(() => validatePackLayout(null as never), SkillPackError);
});
