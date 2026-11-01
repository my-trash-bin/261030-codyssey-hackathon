// 작업 목록·삭제·이력·실행 정보 API 소비자 동작. 커서 전달, 확인 본문, 미측정 null 보존만 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteTask, listTaskEvents, listTasks, readRuntime } from './task-browser-client.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetchFn: typeof fetch } {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchFn };
}

function taskData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    revision: 3,
    phase: 'needs_decisions',
    context: { purpose: 'vendor_support', recipient: 'recipient-1' },
    internal_title: '문의 정리',
    updated_at: '2026-11-01T10:00:00.000Z',
    current_job_id: null,
    current_artifact_id: 'artifact-1',
    ...overrides,
  };
}

test('작업 목록은 최근 수정순 페이지와 다음 커서를 읽는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: { tasks: [taskData()], next_cursor: 'next-cursor' },
  }));
  const result = await listTasks(fetchFn, null);
  assert.equal(calls[0]?.url, '/api/v1/tasks');
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.headers['x-csrf-token'], undefined);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.nextCursor, 'next-cursor');
  assert.equal(result.value.tasks[0]?.phase, 'needs_decisions');
  assert.equal(result.value.tasks[0]?.purpose, 'vendor_support');
  assert.equal(result.value.tasks[0]?.currentArtifactId, 'artifact-1');
});

test('다음 페이지는 서버 커서를 인코딩해 그대로 전달한다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { tasks: [], next_cursor: null } }));
  const result = await listTasks(fetchFn, 'eyJhIjoxfQ==');
  assert.equal(calls[0]?.url, '/api/v1/tasks?cursor=eyJhIjoxfQ%3D%3D');
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.value.nextCursor, null);
});

test('작업 삭제는 DELETE 확인 문자열과 규칙 보존 확인을 정확히 보낸다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { id: 'task-1', deleted: true } }));
  const result = await deleteTask(fetchFn, 'csrf-value', 'task-1', 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'DELETE');
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1');
  assert.equal(calls[0]?.headers['x-csrf-token'], 'csrf-value');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {
    expected_revision: 3,
    confirmation: 'DELETE',
    acknowledge_saved_rules_retained: true,
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.value.id, 'task-1');
});

test('이력은 측정하지 않은 소요·사용량을 null로 남긴다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse({
    data: {
      events: [
        { seq: 1, revision: 2, kind: 'artifact_created', created_at: '2026-11-01T10:00:00.000Z', duration_ms: null, usage: null },
        { seq: 2, revision: 3, kind: 'review_started', created_at: '2026-11-01T10:01:00.000Z', duration_ms: 1200, usage: { input_tokens: 10 } },
      ],
    },
  }));
  const result = await listTaskEvents(fetchFn, 'task-1', 0);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value[0]?.durationMs, null);
  assert.equal(result.value[0]?.usage, null);
  assert.equal(result.value[1]?.durationMs, 1200);
  assert.match(result.value[1]?.usage ?? '', /input_tokens/);
});

test('실행 정보의 모델은 app이 최상위로 보내는 model_id를 읽는다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse({
    data: { core: { ready: true }, model_id: 'fixture-model', app_version: 'x', reproduction: {}, debug: {} },
  }));
  const result = await readRuntime(fetchFn);
  assert.ok(result.ok);
  assert.equal(result.value.model, 'fixture-model');
});

test('실행 정보는 없는 값을 null로 두고 추정하지 않는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: {
      core: { provider: 'fake', model: 'fixture-model', ready: true },
      app_version: 'unversioned',
      extensions: [],
      checkers: ['docast.v1', 'public-file-integrity.v1'],
      reproduction: { status: 'not_configured' },
      debug: { content_logging: false, retention: 'operator_managed' },
    },
  }));
  const result = await readRuntime(fetchFn);
  assert.equal(calls[0]?.url, '/api/v1/runtime');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.provider, 'fake');
  assert.equal(result.value.ready, true);
  assert.deepEqual(result.value.checkers, ['docast.v1', 'public-file-integrity.v1']);
  assert.equal(result.value.reproductionStatus, 'not_configured');
  assert.equal(result.value.contentLogging, false);
});

test('실행 정보의 null 필드는 null 그대로 남는다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse({
    data: { core: { provider: null }, app_version: null, reproduction: { status: null }, debug: {} },
  }));
  const result = await readRuntime(fetchFn);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.provider, null);
  assert.equal(result.value.model, null);
  assert.equal(result.value.ready, null);
  assert.equal(result.value.contentLogging, null);
  assert.equal(result.value.retention, null);
});
