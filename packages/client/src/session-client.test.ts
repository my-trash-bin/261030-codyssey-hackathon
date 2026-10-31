import assert from 'node:assert/strict';
import test from 'node:test';
import { openSession, restoreSession } from './session-client.ts';

interface Call {
  url: string;
  method: string;
  body: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const call = { url: input, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchFn };
}

function sessionBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      csrf_token: 'csrf-token-value',
      expires_at: '2026-10-31T15:00:00.000Z',
      analysis_environment: {
        provider_origin: 'https://api.example.test',
        approval_status: 'operator_confirmation_required',
        verified_at: null,
      },
      capabilities: { tasks: true, reusable_rules: false },
      ...overrides,
    },
  };
}

test('운영자 토큰을 POST /api/v1/session으로 보내고 CSRF 토큰을 돌려준다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse(sessionBody()));
  const result = await openSession(fetchFn, '  operator-secret  ');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/v1/session');
  assert.equal(calls[0]?.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), { token: 'operator-secret' });
  assert.ok(result.ok);
  assert.equal(result.session.csrfToken, 'csrf-token-value');
  assert.equal(result.session.environment?.providerOrigin, 'https://api.example.test');
  assert.equal(result.session.capabilities.reusable_rules, false);
});

test('빈 토큰은 요청을 보내지 않는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse(sessionBody()));
  const result = await openSession(fetchFn, '   ');
  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'invalid_token');
});

test('세션 응답에 csrf_token이 없으면 쓰기를 열지 않는다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse(sessionBody({ csrf_token: '' })));
  const result = await openSession(fetchFn, 'operator-secret');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'malformed');
});

test('만료 시각이 날짜로 읽히지 않으면 쓰기를 열지 않는다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse(sessionBody({ expires_at: 'not-a-date' })));
  const result = await openSession(fetchFn, 'operator-secret');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'malformed');
});

test('401은 토큰 불일치, 403은 경계 거부, 503은 비활성, 429는 세션 한도로 구분한다', async () => {
  const cases = [
    [401, 'AUTH_REQUIRED', 'invalid_token'],
    [403, 'ORIGIN_REJECTED', 'boundary'],
    [503, 'WORKFLOW_API_DISABLED', 'disabled'],
    [429, 'SESSION_LIMIT', 'limit'],
    [500, 'INTERNAL', 'server'],
  ] as const;
  for (const [status, code, kind] of cases) {
    const { fetchFn } = stubFetch(() => jsonResponse({ error: code }, status));
    const result = await openSession(fetchFn, 'operator-secret');
    assert.equal(result.ok, false, `${status} 응답은 성공이 아니다`);
    if (!result.ok) {
      assert.equal(result.failure.kind, kind);
      assert.equal(result.failure.code, code);
    }
  }
});

test('연결 실패는 network로 돌려준다', async () => {
  const fetchFn = async (): Promise<Response> => { throw new Error('connect ECONNREFUSED'); };
  const result = await openSession(fetchFn, 'operator-secret');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'network');
});

test('이미 열린 세션은 GET으로 조회하고 401이면 세션 없음으로 구분한다', async () => {
  const ok = stubFetch(() => jsonResponse(sessionBody()));
  const restored = await restoreSession(ok.fetchFn);
  assert.equal(ok.calls[0]?.method, 'GET');
  assert.equal(ok.calls[0]?.body, '');
  assert.ok(restored.ok);

  const missing = stubFetch(() => jsonResponse({ error: 'AUTH_REQUIRED' }, 401));
  const result = await restoreSession(missing.fetchFn);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'no_session');
});

test('응답이 JSON이 아니면 malformed로 돌려준다', async () => {
  const { fetchFn } = stubFetch(() => new Response('<html>', { status: 200 }));
  const result = await openSession(fetchFn, 'operator-secret');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'malformed');
});
