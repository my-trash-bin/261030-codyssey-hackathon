import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SkillPackError } from '@safehandoff/core-interface';
import { skillSetHash } from './index.ts';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const pack = (id: string, version: string, pack_sha256: string) => ({ id, version, pack_sha256 });

test('an empty active-pack list hashes the same way an empty pack_sha256 list would', () => {
  assert.equal(skillSetHash([]), hash('[]'));
});

test('hash is order-independent: the same set of packs in any order hashes the same', () => {
  const a = pack('vendorstore-support', '1.0.0', 'a'.repeat(64));
  const b = pack('toyrecord-repro', '2.0.0', 'b'.repeat(64));
  assert.equal(skillSetHash([a, b]), skillSetHash([b, a]));
});

test('changing any one field (id, version or pack_sha256) changes the hash', () => {
  const base = skillSetHash([pack('vendorstore-support', '1.0.0', 'a'.repeat(64))]);
  assert.notEqual(base, skillSetHash([pack('vendorstore-support', '1.0.1', 'a'.repeat(64))]));
  assert.notEqual(base, skillSetHash([pack('other-pack', '1.0.0', 'a'.repeat(64))]));
  assert.notEqual(base, skillSetHash([pack('vendorstore-support', '1.0.0', 'c'.repeat(64))]));
});

test('rejects malformed entries instead of hashing whatever was given', () => {
  const invalid = (code: string) => (error: unknown) => error instanceof SkillPackError && error.code === code;
  assert.throws(() => skillSetHash([{ id: 'ok', version: '1.0.0', pack_sha256: 'not-a-hash' }]), invalid('PACK_MANIFEST_INVALID'));
  assert.throws(() => skillSetHash([{ id: '', version: '1.0.0', pack_sha256: 'a'.repeat(64) }]), invalid('PACK_MANIFEST_INVALID'));
  // @ts-expect-error -- exercising the runtime guard against a non-array argument
  assert.throws(() => skillSetHash('not-an-array'), invalid('PACK_MANIFEST_INVALID'));
});
