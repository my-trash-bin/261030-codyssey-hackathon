// 규칙 API 소비자 동작. 전송 본문·오류 분류·표현 지원 경계만 확인한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRules,
  buildRuleRepresentation,
  createRuleVersion,
  listRules,
  readTaskDetail,
  saveRule,
} from './rules-client.ts';

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

const SCOPE = {
  project_id: 'project-1',
  purpose_id: 'vendor_support',
  recipient_id: 'recipient-1',
  audience: 'named_external',
  skill_set_hash: 'a'.repeat(64),
};

function ruleData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    version: 2,
    scope: SCOPE,
    selector: '{"schema_id":"numeric-series.v1","source_slot":"observations","column":"count"}',
    representation: { kind: 'derived_table', transform_id: 'series_index_base100.v1', parameters: { decimal_places: 2 } },
    expires_at: '2027-01-01T00:00:00.000Z',
    revoked: false,
    goal_variant: 'default',
    ...overrides,
  };
}

function ruleBody(overrides: Record<string, unknown> = {}): unknown {
  return { data: ruleData(overrides) };
}

test('규칙 목록은 최신 판본의 scope·표현·만료·철회를 읽는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ data: { rules: [ruleData(), ruleData({ id: 'r2', version: 1, revoked: true })] } }));
  const result = await listRules(fetchFn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/v1/rules');
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.headers['x-csrf-token'], undefined);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0]?.version, 2);
  assert.equal(result.value[0]?.scope.audience, 'named_external');
  assert.equal(result.value[0]?.expiresAt, '2027-01-01T00:00:00.000Z');
  assert.equal(result.value[1]?.revoked, true);
  assert.equal(result.value[1]?.goalVariant, 'default');
});

test('형식이 깨진 규칙이 섞인 목록은 일부를 숨기지 않고 거부한다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse({ data: { rules: [ruleData(), { id: 'broken' }] } }));
  const result = await listRules(fetchFn);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'malformed');
});

test('규칙 저장은 선택한 작업 판본과 결정 ID를 그대로 보낸다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse(ruleBody(), 201));
  const result = await saveRule(fetchFn, 'csrf-value', { taskId: 'task-1', expectedRevision: 7, decisionId: 'decision-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.headers['x-csrf-token'], 'csrf-value');
  assert.equal((calls[0]?.headers['idempotency-key'] ?? '').length > 0, true);
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {
    task_id: 'task-1',
    expected_revision: 7,
    decision_id: 'decision-1',
  });
  assert.ok(result.ok);
});

test('CSRF 토큰이 없으면 규칙 쓰기를 네트워크로 보내지 않는다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse(ruleBody(), 201));
  const result = await saveRule(fetchFn, '', { taskId: 'task-1', expectedRevision: 1, decisionId: 'decision-1' });
  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.code, 'NO_CSRF_TOKEN');
});

test('새 판본은 기대 판본과 지원 표현만 보낸다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse(ruleBody({ version: 3 })));
  const representation = buildRuleRepresentation({ transformId: 'series_index_base100.v1', decimalPlaces: 1 });
  const result = await createRuleVersion(fetchFn, 'csrf-value', 'rule-1', 2, representation, null);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.url, '/api/v1/rules/rule-1/versions');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {
    expected_rule_version: 2,
    representation: { kind: 'derived_table', transform_id: 'series_index_base100.v1', parameters: { decimal_places: 1 } },
    expires_at: null,
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.value.version, 3);
});

test('방향 변환은 추가 인자 없이 만들고 지수 소수 자리 범위를 지킨다', () => {
  assert.deepEqual(buildRuleRepresentation({ transformId: 'series_direction_only.v1', decimalPlaces: 0 }), {
    kind: 'derived_table',
    transform_id: 'series_direction_only.v1',
  });
  assert.throws(() => buildRuleRepresentation({ transformId: 'series_index_base100.v1', decimalPlaces: 5 }), /0~4/);
});

test('명시 적용은 작업 판본과 규칙 참조를 한 번에 보내고 409를 충돌로 분류한다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({ error: 'RULE_CONFLICT' }, 409));
  const result = await applyRules(fetchFn, 'csrf-value', 'task-1', 4, [
    { id: 'rule-1', version: 2 },
    { id: 'rule-2', version: 1 },
  ]);
  assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {
    expected_revision: 4,
    rule_refs: [{ id: 'rule-1', version: 2 }, { id: 'rule-2', version: 1 }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.kind, 'conflict');
    assert.equal(result.failure.code, 'RULE_CONFLICT');
  }
});

test('작업 상세는 intake가 없으면 null로 남겨 저장 가능 여부를 서버 값으로 판단한다', async () => {
  const { calls, fetchFn } = stubFetch(() => jsonResponse({
    data: { id: 'task-1', revision: 3, scope: SCOPE, intake: null },
  }));
  const result = await readTaskDetail(fetchFn, 'task-1');
  assert.equal(calls[0]?.url, '/api/v1/tasks/task-1');
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.intake, null);
    assert.equal(result.value.revision, 3);
  }
});

test('작업 상세의 intake 필드가 온전하지 않으면 형식 오류로 거부한다', async () => {
  const { fetchFn } = stubFetch(() => jsonResponse({
    data: { id: 'task-1', revision: 3, scope: SCOPE, intake: { internal_title: '제목' } },
  }));
  const result = await readTaskDetail(fetchFn, 'task-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'malformed');
});
