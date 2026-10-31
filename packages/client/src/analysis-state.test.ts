// 공용 원자료 변환기 검사. 서버에 보낼 WireSource를 파일에서 만드는 경계이므로
// 형식 허용·한도·sha256·원본 보존을 여기서 고정한다. 훅 동작 검사는 이 파일에 두지 않는다.

import assert from 'node:assert/strict';
import test from 'node:test';
import { toWireSources } from './analysis-state.ts';

test('지원하지 않는 형식은 원자료로 만들지 않는다', async () => {
  await assert.rejects(() => toWireSources([new File(['x'], 'a.pdf')], crypto.subtle), /지원하지 않는 파일 형식/);
});

test('파일 없이 원자료를 만들지 않는다', async () => {
  await assert.rejects(() => toWireSources([], crypto.subtle), /하나 이상/);
});

// 보안 문맥이 아니면 crypto.subtle이 없다. TypeError 대신 이유를 알려 주고 전송하지 않는다.
test('암호화 API가 없으면 원자료를 만들지 않고 이유를 알린다', async () => {
  await assert.rejects(() => toWireSources([new File(['x'], 'a.txt')], undefined), /crypto.subtle/);
});

test('파일 한도를 넘는 원자료를 거부한다', async () => {
  await assert.rejects(() => toWireSources([new File([new Uint8Array(262145)], 'big.txt')], crypto.subtle), /파일 한도/);
});

test('원자료는 형식·sha256·UTF-8 원본을 함께 담는다', async () => {
  const wire = await toWireSources([new File(['한글 로그'], 'a.log')], crypto.subtle);
  assert.equal(wire.length, 1);
  const first = wire[0]!;
  assert.equal(first.format, 'log');
  assert.equal(first.source_id, 'local_source_1');
  assert.equal(first.included, true);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(first.raw_bytes, 'base64').toString('utf8'), '한글 로그');
});
