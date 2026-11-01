import assert from 'node:assert/strict';
import test from 'node:test';

import { modelStateView, parseModelCheck } from './model-connection-client.ts';
import type { WorkflowRuntime } from './task-browser-client.ts';

const runtime = (over: Partial<WorkflowRuntime>): WorkflowRuntime => ({
  implementation: 'real',
  provider: null,
  model: 'fixture-model',
  ready: true,
  appVersion: null,
  extensions: [],
  checkers: [],
  reproductionStatus: null,
  contentLogging: null,
  retention: null,
  modelSetup: { baseUrlEnv: 'BASE_URL', missing: [], baseUrlRejected: false },
  ...over,
});

test('설정이 있어도 확인 전에는 연결됐다고 말하지 않는다', () => {
  const view = modelStateView(runtime({}), null);
  assert.equal(view.label, '설정됨, 연결 확인 전');
  assert.equal(view.canCheck, true);
});

test('비어 있는 환경 변수 이름을 안내하고 확인 버튼을 열지 않는다', () => {
  const view = modelStateView(runtime({ ready: false, modelSetup: { baseUrlEnv: 'BASE_URL', missing: ['BASE_URL', 'API_KEY'], baseUrlRejected: false } }), null);
  assert.equal(view.label, '연결 설정 필요');
  assert.equal(view.canCheck, false);
  assert.match(view.hint, /BASE_URL, API_KEY/);
  assert.match(view.hint, /서버를 다시 시작/);
});

test('허용되지 않는 주소는 형식 문제로 안내한다', () => {
  const view = modelStateView(runtime({ ready: false, modelSetup: { baseUrlEnv: 'BASE_URL', missing: [], baseUrlRejected: true } }), null);
  assert.match(view.hint, /BASE_URL 값을 쓸 수 없습니다/);
});

test('확인 결과별 문구와 승인 구분', () => {
  const ok = modelStateView(runtime({}), { status: 'reachable' });
  assert.equal(ok.label, '연결 확인됨');
  assert.match(ok.hint, /승인된 환경인지는 운영자가/);
  assert.equal(modelStateView(runtime({}), { status: 'failed', code: 'MODEL_TIMEOUT' }).label, '응답 시간 초과');
  assert.equal(modelStateView(runtime({}), { status: 'failed', code: '' }).label, '연결 실패');
});

test('연출용 실행과 읽기 실패는 연결 확인을 열지 않는다', () => {
  assert.equal(modelStateView(runtime({ implementation: 'fake' }), null).canCheck, false);
  assert.equal(modelStateView(null, null).canCheck, false);
});

test('모르는 확인 상태는 거부한다', () => {
  assert.equal(parseModelCheck({ data: { status: 'approved' } }), null);
  assert.deepEqual(parseModelCheck({ data: { status: 'failed', code: 'MODEL_TIMEOUT' } }), { status: 'failed', code: 'MODEL_TIMEOUT' });
});
