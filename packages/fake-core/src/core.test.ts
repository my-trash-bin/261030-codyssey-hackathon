import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeCore } from './index.ts';
import { createHash } from 'node:crypto';

test('changing the fake script changes only fake output and regenerates from current facts', async () => {
  const core = new FakeCore();
  const input = { purpose: '문의', recipient: '가상 공급사', facts: [{ id: 'a', text: '첫 요청 timeout' }] };
  const first = await core.generate(input);
  assert.equal(first.provenance.implementation, 'fake');
  core.configure({ title: '다른 연출', opening: '새 도입', closing: '새 마무리' });
  const next = await core.generate({ ...input, facts: [{ id: 'b', text: '다른 관찰' }] });
  assert.equal(next.document.title, '다른 연출');
  assert.match(next.document.body, /새 도입/);
  assert.doesNotMatch(next.document.body, /첫 요청 timeout/);
  const copied = core.settings(); copied.title = 'external mutation';
  assert.equal(core.settings().title, '다른 연출');
});

test('fake engine completes analysis preview writing and review without an external model', async () => {
  const core = new FakeCore();
  const text = '가상 업무에서 반복 입력과 수동 대조를 관찰했다.';
  const bytes = Buffer.from(text);
  const source = { id: 'source-version', source_id: 'source', version: 1, display_name: '메모.md', format: 'md' as const,
    source_slot: 'general', raw_bytes: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), included: true };
  const analyzed = await core.analyze({ task: { purpose: 'operations_advice', recipient: 'demo' }, sources: [source] });
  assert.equal(analyzed.proposals.candidates.length, 1);
  assert.equal(analyzed.evidence[0]?.evidence_sha256, source.sha256);
  const candidate = analyzed.proposals.candidates[0]!;
  const preview = await core.preview(candidate, { kind: 'fact_summary', transform_id: '', parameters: {} }, 3);
  assert.equal(preview.projection.statement, candidate.statement);
  const pack = { schema_version: 'fact_pack.v1' as const, task_revision: 4, template_id: 'document', audience_type: 'named_external',
    output_language: 'ko', approved_brief: '', facts: [{ id: 'fact-1', kind: 'observation', statement: candidate.statement }],
    required_fact_ids: ['fact-1'], tables: [], excerpt_slots: [], asset_slots: [], public_tool_results: [] };
  const result = await core.writeReviewed(pack, { finalFiles: () => [] });
  assert.equal(result.review.result, 'pass');
  assert.ok(result.draft.blocks.some(block => block.type === 'paragraph' && block.fact_ids?.includes('fact-1')));
});
