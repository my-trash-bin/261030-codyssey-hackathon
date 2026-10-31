import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelAnalysis, createTask, readAnalysisJob, replaceSources, startAnalysis } from './task-client.ts';
import type { WireSource } from './analysis-state.ts';

interface Call {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const call = {
      url: input,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {})
        .map(([name, value]) => [name.toLowerCase(), value])),
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchFn };
}

const source: WireSource = {
  id: 'local_1_abcdef123456',
  source_id: 'local_source_1',
  version: 1,
  display_name: 'fictional.txt',
  format: 'txt',
  source_slot: 'input_1',
  raw_bytes: '7ZWc6riA',
  sha256: 'a'.repeat(64),
  included: true,
};

test('목적·수신처로 작업을 만들고 CSRF·멱등 키를 붙인다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'task-1', revision: 1 } }, 201));
  const result = await createTask(fetchFn, 'csrf-value', { purpose: '공개 검토', recipient: '팀' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/v1/tasks');
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.headers['x-csrf-token'], 'csrf-value');
  assert.ok((calls[0]?.headers['idempotency-key'] ?? '').length > 0);
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { context: { purpose: '공개 검토', recipient: '팀' } });
  assert.ok(result.ok);
  assert.equal(result.value.id, 'task-1');
  assert.equal(result.value.revision, 1);
});

test('원자료는 PUT으로 보내고 expected_revision을 그대로 싣는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'task-1', revision: 2 } }));
  const result = await replaceSources(fetchFn, 'csrf-value', 'task-1', 1, [source]);
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1/sources');
  assert.equal(calls[0]?.method, 'PUT');
  assert.equal(calls[0]?.headers['x-csrf-token'], 'csrf-value');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { expected_revision: 1, sources: [source] });
  assert.ok(result.ok);
  assert.equal(result.value.revision, 2);
});

test('작업 ID에 경로 문자를 그대로 넣지 않는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'a/b', revision: 2 } }));
  await replaceSources(fetchFn, 'csrf-value', 'a/b', 1, [source]);
  assert.equal(calls[0]?.url, '/api/v1/tasks/a%2Fb/sources');
});

test('상태 코드를 실패 종류로 구분한다', async () => {
  const cases = [
    [401, 'AUTH_REQUIRED', 'auth'],
    [403, 'CSRF_REJECTED', 'boundary'],
    [404, 'NOT_FOUND', 'not_found'],
    [409, 'REVISION_CONFLICT', 'conflict'],
    [422, 'INVALID_ANALYSIS', 'invalid'],
    [500, 'INTERNAL', 'server'],
  ] as const;
  for (const [status, code, kind] of cases) {
    const { fetchFn } = stubFetch(() => jsonResponse({ error: code }, status));
    const result = await createTask(fetchFn, 'csrf-value', { purpose: 'p', recipient: 'r' });
    assert.equal(result.ok, false, `${status}는 성공이 아니다`);
    if (!result.ok) {
      assert.equal(result.failure.kind, kind);
      assert.equal(result.failure.code, code);
    }
  }
});

test('응답에 작업 ID나 판본이 없으면 성공으로 보지 않는다', async () => {
  for (const payload of [{ data: { revision: 1 } }, { data: { id: 'task-1' } }, { data: { id: 'task-1', revision: 0 } }, {}]) {
    const { fetchFn } = stubFetch(() => jsonResponse(payload, 201));
    const result = await createTask(fetchFn, 'csrf-value', { purpose: 'p', recipient: 'r' });
    assert.equal(result.ok, false, JSON.stringify(payload));
    if (!result.ok) assert.equal(result.failure.kind, 'malformed');
  }
});

test('연결 실패는 network로 돌려준다', async () => {
  const fetchFn = async (): Promise<Response> => { throw new Error('ECONNREFUSED'); };
  const result = await createTask(fetchFn, 'csrf-value', { purpose: 'p', recipient: 'r' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'network');
});

test('분석 job은 analyze 종류와 판본을 실어 시작한다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'job-1', revision: 3, status: 'running', error_code: null } }, 202));
  const result = await startAnalysis(fetchFn, 'csrf-value', 'task-1', 2);
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1/jobs');
  assert.equal(calls[0]?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { expected_revision: 2, kind: 'analyze' });
  assert.ok(result.ok);
  assert.equal(result.value.status, 'running');
  assert.equal(result.value.errorCode, null);
});

test('job 상태는 GET으로 읽고 실패 코드를 보존한다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'job-1', revision: 3, status: 'failed', error_code: 'MODEL_UNAVAILABLE' } }));
  const result = await readAnalysisJob(fetchFn, 'csrf-value', 'task-1', 'job-1');
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1/jobs/job-1');
  assert.equal(calls[0]?.body, '');
  assert.ok(result.ok);
  assert.equal(result.value.status, 'failed');
  assert.equal(result.value.errorCode, 'MODEL_UNAVAILABLE');
});

test('모르는 job 상태는 성공으로 보지 않는다', async () => {
  for (const status of ['pending', '', 42]) {
    const { fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'job-1', revision: 3, status, error_code: null } }));
    const result = await readAnalysisJob(fetchFn, 'csrf-value', 'task-1', 'job-1');
    assert.equal(result.ok, false, String(status));
    if (!result.ok) assert.equal(result.failure.kind, 'malformed');
  }
});

test('분석 취소는 cancelled 값을 그대로 돌려준다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { cancelled: true } }));
  const result = await cancelAnalysis(fetchFn, 'csrf-value', 'task-1', 'job-1', 3);
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1/jobs/job-1/cancel');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { expected_revision: 3 });
  assert.ok(result.ok);
  assert.equal(result.value.cancelled, true);
});
