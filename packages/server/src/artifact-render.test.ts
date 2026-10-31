import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import type { Draft, FactPack } from '@safehandoff/core-interface';
import { archive, renderFiles, validateDocument } from './artifact-render.ts';
const pack: FactPack = { schema_version: 'fact_pack.v1', task_revision: 1, template_id: 'support-request.v1', audience_type: 'named_external',
  output_language: 'ko', approved_brief: '', facts: [{ id: 'f', kind: 'observation', statement: '가상 관찰' }], required_fact_ids: ['f'],
  tables: [{ id: 'f', columns: ['value'], rows: [['=1+1'], ['-12'], ['@command'], ['한글,"quoted"\ncell']] }],
  asset_slots: [], excerpt_slots: [], public_tool_results: [] };
const draft: Draft = { schema_version: 'draft.v1', blocks: [{ type: 'paragraph', text: '<img src="https://invalid/x">', fact_ids: ['f'] },
  { type: 'table_ref', table_id: 'f', fact_ids: ['f'] }] };
test('rendered files escape active markup, protect formula strings and retain explicit numeric values', () => {
  const result = renderFiles(draft, pack), markdown = Buffer.from(result.files.find(f => f.path.endsWith('.md'))!.bytes, 'base64').toString();
  assert.ok(!markdown.includes('<img')); assert.ok(markdown.includes('&lt;img'));
  const csv = Buffer.from(result.files.find(f => f.path.endsWith('.csv'))!.bytes, 'base64').toString();
  assert.ok(csv.includes('"\'=1+1"')); assert.ok(csv.includes('"-12"')); assert.ok(csv.includes('"\'@command"')); assert.ok(csv.includes('""quoted""'));
  assert.throws(() => validateDocument({ ...draft, blocks: [{ type: 'table_ref', table_id: 'unapproved' }] }, pack), /INVALID_DRAFT/);
});
test('deterministic zip is readable by an independent reader with fixed paths, times and file permissions', () => {
  const { files } = renderFiles(draft, pack), bytes = archive(files);
  assert.deepEqual(archive([...files].reverse()), bytes);
  const script = `import sys,io,zipfile,json,hashlib
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
print(json.dumps([{'path':i.filename,'sha256':hashlib.sha256(z.read(i)).hexdigest(),'date':i.date_time,'mode':i.external_attr>>16} for i in z.infolist()]))`;
  const decoded = JSON.parse(execFileSync('python', ['-c', script], { input: bytes }).toString());
  assert.deepEqual(decoded.map((f: { path: string; sha256: string }) => ({ path: f.path, sha256: f.sha256 })), files.map(f => ({ path: f.path, sha256: f.sha256 })));
  for (const entry of decoded) { assert.deepEqual(entry.date, [1980, 1, 1, 0, 0, 0]); assert.equal(entry.mode, 0o100644); }
  for (const path of ['/absolute', '../escape', 'a\\b', 'other.txt']) assert.throws(() => archive([{ ...files[0]!, path }]), /INVALID_EXPORT_FILES/);
  assert.throws(() => archive([files[0]!, files[0]!]), /INVALID_EXPORT_FILES/);
  assert.throws(() => archive([{ ...files[0]!, symlink: true } as never]), /INVALID_EXPORT_FILES/);
});
