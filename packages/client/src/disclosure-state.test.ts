import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { act } from 'react';

import type { Draft } from './disclosure-state.ts';
import { renderHook } from './test-helpers/react-hook.ts';
import type { HookResult } from './test-helpers/react-hook.ts';
import { useDisclosures } from './ui/hooks/useDisclosures.ts';
import type { DisclosuresApi } from './ui/hooks/useDisclosures.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (call: Call) => Response | Promise<Response> | null) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const rawHeaders = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    rawHeaders.forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === 'string' ? init.body : '';
    const call: Call = { url, method: init?.method ?? 'GET', headers, body };
    calls.push(call);
    const answer = await handler(call);
    if (answer) return answer;
    throw new Error('연결 실패');
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchFn };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    kind: 'observation',
    statement: '관측된 사실',
    uncertainty: 'observed',
    evidence_ids: [],
    required: false,
    selector: 's1',
    origin: 'analysis',
    ...overrides,
  };
}

function scope() {
  return {
    project_id: 'p1',
    purpose_id: 'oss_issue',
    recipient_id: 'r1',
    audience: 'public',
    skill_set_hash: 'h',
  };
}

function savedDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    candidate_id: 'c1',
    disposition: 'allow',
    representation: { kind: 'fact_summary', transform_id: '', parameters: {} },
    revoked: false,
    expires_at: null,
    supersedes_id: '',
    projection_sha256: 'abc123',
    ...overrides,
  };
}

function taskEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 't1',
      revision: 1,
      candidates: [candidate()],
      evidence: [],
      sources: [],
      decisions: {},
      scope: scope(),
      ...overrides,
    },
  };
}

function previewEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      preview_id: 'p1',
      candidate_id: 'c1',
      input_revision: 1,
      representation: { kind: 'fact_summary', transform_id: '', parameters: {} },
      projection: { statement: '공개 문장', columns: null, rows: null },
      projection_sha256: 'abc123',
      ...overrides,
    },
  };
}

function jobEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'job-1',
      kind: 'interpret_disclosure',
      status: 'queued',
      input_revision: 1,
      result: null,
      ...overrides,
    },
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'disclosure_proposal.v1',
    status: 'supported',
    candidate_id: 'c1',
    representation: { kind: 'fact_summary', transform_id: '', parameters: {} },
    requires_clarification: false,
    ...overrides,
  };
}

function draftOf(api: DisclosuresApi, id: string): Draft {
  const draft = api.drafts.get(id);
  assert.ok(draft, '후보 초안이 있어야 합니다');
  return draft;
}

/** 실제 React root에서 훅을 실행하고, 테스트가 끝나면 언마운트한다. */
async function mount(
  t: TestContext,
  options: { csrfToken: string | null; fetch: typeof fetch; onAuthRequired?: () => void },
): Promise<HookResult<DisclosuresApi>> {
  const hook = await renderHook(() => useDisclosures(options));
  t.after(async () => {
    await hook.unmount();
  });
  return hook;
}

/** 명령 호출은 매번 act 안에서 수행해 상태 flush 뒤 값을 읽는다. 반환값은 쓰지 않는다. */
async function run<T>(change: () => T | Promise<T>): Promise<void> {
  await act(async () => {
    await change();
  });
}

test('쓰기 토큰이 없으면 모든 쓰기가 전송 없이 차단된다', async t => {
  const { calls, fetch } = stubFetch(() => jsonResponse({}));
  const { result } = await mount(t, { fetch, csrfToken: null });
  assert.notEqual(result.current.writeBlockReason, '');
  await run(() => result.current.loadTask('t1'));
  assert.equal(calls.length, 1);
  await run(() => result.current.preview('c1'));
  await run(() => result.current.interpret('c1'));
  await run(() => result.current.refreshInterpretation('c1'));
  await run(() => result.current.apply());
  await run(() => result.current.revoke('d1'));
  assert.equal(calls.length, 1);
  assert.notEqual(result.current.message, '');
});

test('revision이 바뀌면 미리보기·해석은 무효화되고 조건은 남는다', async t => {
  let revision = 1;
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews') ? jsonResponse(previewEnvelope()) : jsonResponse(taskEnvelope({ revision })),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.setCondition('c1', '조건'));
  await run(() => result.current.preview('c1'));
  assert.ok(draftOf(result.current, 'c1').preview);
  revision = 2;
  await run(() => result.current.loadTask('t1'));
  const draft = draftOf(result.current, 'c1');
  assert.equal(draft.preview, null);
  assert.equal(draft.interpretation, 'uninterpreted');
  assert.equal(draft.condition, '조건');
  assert.equal(draft.disposition, 'allow');
});

test('작업 aggregate는 소비 필드를 검증하고 엉뚱한 응답을 성공으로 두지 않는다', async t => {
  const { fetch } = stubFetch(() => jsonResponse({ data: { id: 't1' } }));
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  assert.equal(result.current.snapshot, null);
  assert.notEqual(result.current.message, '');
});

test('candidate 필수 필드가 빠지면 스냅샷을 두지 않는다', async t => {
  const { required: _required, ...broken } = candidate();
  const { fetch } = stubFetch(() => jsonResponse(taskEnvelope({ candidates: [broken] })));
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  assert.equal(result.current.snapshot, null);
});

test('요청한 작업 ID와 응답 ID가 다르면 성공으로 처리하지 않는다', async t => {
  const { fetch } = stubFetch(() => jsonResponse(taskEnvelope({ id: 't2' })));
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  assert.equal(result.current.snapshot, null);
  assert.notEqual(result.current.message, '');
});

test('조회 실패는 기존 스냅샷을 유지하면서 stale로 묶어 저장을 막는다', async t => {
  let fail = false;
  const { fetch } = stubFetch(() =>
    fail ? jsonResponse({ error: { code: 'E', message: 'm', retryable: true } }, 500) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  assert.ok(result.current.snapshot);
  fail = true;
  await run(() => result.current.loadTask('t1'));
  assert.ok(result.current.snapshot);
  assert.notEqual(result.current.batchBlockReason, '');
  assert.equal(result.current.canGenerate, false);
});

test('다른 작업을 열면 이전 초안과 범위 축소 동의가 격리된다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/t2') ? jsonResponse(taskEnvelope({ id: 't2' })) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  await run(() => result.current.setScopeReduction(true));
  await run(() => result.current.loadTask('t2'));
  assert.equal(result.current.drafts.size, 0);
  assert.equal(result.current.acceptScopeReduction, false);
});

test('로컬 선택은 토큰 없이도 정상 동작한다', async t => {
  const { calls, fetch } = stubFetch(() => jsonResponse(taskEnvelope()));
  const { result } = await mount(t, { fetch, csrfToken: null });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.setCondition('c1', '메모'));
  await run(() => result.current.setReusable('c1', true));
  assert.equal(calls.length, 1);
  assert.equal(draftOf(result.current, 'c1').reusable, true);
});

test('B는 한 CSV 한 열의 서로 다른 행 근거에만 열리고 C는 필드 목록 전까지 차단된다', async t => {
  const cell = (id: string, row: number, column = 'count', source = 's1') => ({
    id,
    source_version_id: source,
    start: 0,
    end: 2,
    locator: { kind: 'csv_cell', row, column },
  });
  const { fetch } = stubFetch(() =>
    jsonResponse(
      taskEnvelope({
        candidates: [
          candidate({ id: 'c1', evidence_ids: ['e1', 'e2', 'e3'] }),
          candidate({ id: 'c2', evidence_ids: ['e1', 'e4'] }),
          candidate({ id: 'c3', evidence_ids: ['e1', 'e5'] }),
        ],
        evidence: [cell('e1', 1), cell('e2', 2), cell('e3', 3), cell('e4', 1, 'other'), cell('e5', 1, 'count', 's2')],
      }),
    ),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  // 같은 자료·같은 열·서로 다른 행만 서버 계열 변환 조건을 만족한다.
  await run(() => result.current.chooseMode('c1', 'B'));
  assert.deepEqual(draftOf(result.current, 'c1').representation, {
    kind: 'derived_table',
    transform_id: 'series_direction_only.v1',
    parameters: {},
  });
  await run(() => result.current.chooseMode('c2', 'B'));
  assert.equal(draftOf(result.current, 'c2').representation, null);
  assert.notEqual(draftOf(result.current, 'c2').message, '');
  await run(() => result.current.chooseMode('c3', 'B'));
  assert.equal(draftOf(result.current, 'c3').representation, null);
  await run(() => result.current.chooseMode('c1', 'C'));
  assert.equal(draftOf(result.current, 'c1').representation, null);
});

test('조건이 바뀌면 해석·미리보기가 폐기된다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews') ? jsonResponse(previewEnvelope()) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  assert.ok(draftOf(result.current, 'c1').preview);
  await run(() => result.current.setCondition('c1', '바뀐 조건'));
  assert.equal(draftOf(result.current, 'c1').preview, null);
});

test('미리보기는 후보·revision·표현이 어긋나면 폐기하고 해시 쌍을 함께 보관한다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews')
      ? jsonResponse(previewEnvelope({ candidate_id: '다른후보' }))
      : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  assert.equal(draftOf(result.current, 'c1').preview, null);
  assert.notEqual(draftOf(result.current, 'c1').message, '');
});

test('해시가 비어 있는 미리보기는 성공으로 두지 않는다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews')
      ? jsonResponse(previewEnvelope({ projection_sha256: '' }))
      : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  assert.equal(draftOf(result.current, 'c1').preview, null);
});

test('늦게 도착한 미리보기는 조건이 바뀌었으면 폐기된다', async t => {
  const gate = Promise.withResolvers<Response>();
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews') ? gate.promise : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  // 요청은 act 안에서 시작하되 기다리지 않는다. 응답은 다음 act에서 연다.
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.preview('c1');
  });
  await act(async () => {
    result.current.setCondition('c1', '도중에 바뀜');
    gate.resolve(jsonResponse(previewEnvelope()));
    await pending;
  });
  assert.equal(draftOf(result.current, 'c1').preview, null);
});

test('D는 지원 판정 뒤에야 미리보기가 가능하고 추가 확인 요구는 막힌다', async t => {
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) {
      return jsonResponse(jobEnvelope({ status: 'succeeded', result: proposal({ requires_clarification: true }) }), 202);
    }
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '이 조건으로'));
  await run(() => result.current.interpret('c1'));
  assert.equal(draftOf(result.current, 'c1').interpretation, 'ambiguous');
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.preview('c1'));
  assert.equal(draftOf(result.current, 'c1').preview, null);
});

test('조건 해석은 interpret_disclosure 작업으로 전송되고 성공 판정이 표현을 남긴다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) return jsonResponse(jobEnvelope({ status: 'succeeded', result: proposal() }), 202);
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '이 조건으로'));
  await run(() => result.current.interpret('c1'));
  const sent = calls.find(call => call.url.endsWith('/jobs'));
  assert.ok(sent);
  assert.deepEqual(JSON.parse(sent.body), {
    expected_revision: 1,
    kind: 'interpret_disclosure',
    arguments: { candidate_id: 'c1', text: '이 조건으로' },
  });
  assert.equal(sent.headers['x-csrf-token'], 'fixture-token');
  assert.equal(draftOf(result.current, 'c1').interpretation, 'supported');
  assert.deepEqual(draftOf(result.current, 'c1').representation, { kind: 'fact_summary', transform_id: '', parameters: {} });
});

test('해석 조회는 대기·진행 중일 때만 job을 단건 조회한다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) return jsonResponse(jobEnvelope(), 202);
    if (call.url.includes('/api/v1/jobs/')) return jsonResponse(jobEnvelope({ status: 'succeeded', result: proposal() }));
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '이 조건으로'));
  await run(() => result.current.interpret('c1'));
  assert.equal(draftOf(result.current, 'c1').jobStatus, 'queued');
  await run(() => result.current.refreshInterpretation('c1'));
  const seen = calls.filter(call => call.url.includes('/api/v1/jobs/'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.headers['x-csrf-token'], undefined);
  assert.equal(draftOf(result.current, 'c1').interpretation, 'supported');
  await run(() => result.current.refreshInterpretation('c1'));
  assert.equal(calls.filter(call => call.url.includes('/api/v1/jobs/')).length, 1);
});

test('같은 tick에 해석 요청을 두 번 보내도 한 번만 전송한다', async t => {
  const gate = Promise.withResolvers<Response>();
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) return gate.promise;
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '이 조건으로'));
  let first!: Promise<void>;
  let duplicate!: Promise<void>;
  await act(async () => {
    first = result.current.interpret('c1');
    duplicate = result.current.interpret('c1');
  });
  assert.equal(calls.filter(call => call.url.endsWith('/jobs')).length, 1);
  assert.equal(result.current.busy, true);
  await act(async () => {
    gate.resolve(jsonResponse(jobEnvelope(), 202));
    await first;
    await duplicate;
  });
  assert.equal(result.current.busy, false);
});

test('다른 후보를 가리키는 해석 결과는 폐기된다', async t => {
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) {
      return jsonResponse(jobEnvelope({ status: 'succeeded', result: proposal({ candidate_id: 'c9' }) }), 202);
    }
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '이 조건으로'));
  await run(() => result.current.interpret('c1'));
  assert.equal(draftOf(result.current, 'c1').interpretation, 'uninterpreted');
});

test('재사용 토글은 exact_value 표현에서 강제 false가 된다', async t => {
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/jobs')) {
      return jsonResponse(
        jobEnvelope({
          status: 'succeeded',
          result: proposal({ representation: { kind: 'exact_value', transform_id: '', parameters: {} } }),
        }),
        202,
      );
    }
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '정확한 값 공개'));
  await run(() => result.current.interpret('c1'));
  await run(() => result.current.setReusable('c1', true));
  assert.equal(draftOf(result.current, 'c1').reusable, false);
});

test('전체 적용은 allow만 미리보기 참조를 싣고 미선택은 빼며 필수 자동 공개를 하지 않는다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) return jsonResponse({ data: {} });
    if (call.method === 'GET') {
      const revision = calls.some(seen => seen.url.endsWith('/decision-batches')) ? 2 : 1;
      return jsonResponse(taskEnvelope({ revision }));
    }
    return jsonResponse({}, 500);
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  await run(() => result.current.apply());
  const sent = calls.find(call => call.url.endsWith('/decision-batches'));
  assert.ok(sent);
  const body = JSON.parse(sent.body) as { expected_revision: number; accept_scope_reduction: boolean; operations: unknown[] };
  assert.equal(body.expected_revision, 1);
  assert.equal(body.operations.length, 1);
  assert.deepEqual(body.operations[0], {
    candidate_id: 'c1',
    disposition: 'allow',
    representation: { kind: 'fact_summary', transform_id: '', parameters: {} },
    preview_id: 'p1',
    projection_sha256: 'abc123',
    save_reusable_rule: false,
  });
  assert.ok(sent.headers['idempotency-key']);
  assert.equal(sent.headers['x-csrf-token'], 'fixture-token');
  assert.ok(calls.some(call => call.method === 'GET' && call.url.endsWith('/t1')));
  assert.equal(result.current.snapshot?.revision, 2);
});

test('필수 후보가 미선택이어도 다른 후보의 결정은 저장되고 자동 공개되지 않는다', async t => {
  const { calls, fetch } = stubFetch(call =>
    call.url.endsWith('/decision-batches')
      ? jsonResponse({ data: {} })
      : jsonResponse(taskEnvelope({ candidates: [candidate({ id: 'c1', required: true }), candidate({ id: 'c2' })] })),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c2', 'defer'));
  // 미선택 required가 남아 있어도 저장은 막지 않고, 미완료 표시만 남긴다.
  assert.equal(result.current.batchBlockReason, '');
  assert.equal(result.current.canGenerate, false);
  await run(() => result.current.apply());
  const sent = calls.find(call => call.url.endsWith('/decision-batches'));
  assert.ok(sent);
  const sentBody: { operations: { candidate_id: string; disposition: string }[] } = JSON.parse(sent.body);
  assert.deepEqual(sentBody.operations, [{ candidate_id: 'c2', disposition: 'defer' }]);
});

test('필수 제외만 범위 축소 동의를 요구하고 보류는 동의 없이 저장된다', async t => {
  const { calls, fetch } = stubFetch(call =>
    call.url.endsWith('/decision-batches')
      ? jsonResponse({ data: {} })
      : jsonResponse(taskEnvelope({ candidates: [candidate({ id: 'c1', required: true })] })),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'exclude'));
  await run(() => result.current.apply());
  assert.ok(!calls.some(call => call.url.endsWith('/decision-batches')));
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  assert.equal(result.current.batchBlockReason, '');
  assert.equal(result.current.canGenerate, false);
  await run(() => result.current.apply());
  const sent = calls.find(call => call.url.endsWith('/decision-batches'));
  assert.ok(sent);
  const sentBody: { operations: { candidate_id: string; disposition: string }[] } = JSON.parse(sent.body);
  assert.deepEqual(sentBody.operations, [{ candidate_id: 'c1', disposition: 'defer' }]);
});

test('충돌 묶음은 저장을 임의로 막지 않고 두 후보 결정을 그대로 보낸다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) {
      const parsed = JSON.parse(call.body) as { candidate_id: string };
      return jsonResponse(previewEnvelope({ candidate_id: parsed.candidate_id, preview_id: `p-${parsed.candidate_id}` }));
    }
    return jsonResponse(
      taskEnvelope({ candidates: [candidate({ id: 'c1', conflict_group: 'g' }), candidate({ id: 'c2', conflict_group: 'g' })] }),
    );
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  for (const id of ['c1', 'c2']) {
    await run(() => result.current.chooseDisposition(id, 'allow'));
    await run(() => result.current.chooseMode(id, 'A'));
    await run(() => result.current.preview(id));
  }
  // F03 §3은 양쪽 근거를 보여주고 하나를 몰래 고르지 말라는 것뿐이다.
  // 클라이언트가 해결 규칙을 만들어 배치를 막거나 한쪽을 빼지 않는다.
  assert.equal(result.current.batchBlockReason, '');
  await run(() => result.current.apply());
  const sent = calls.find(call => call.url.endsWith('/decision-batches'));
  assert.ok(sent);
  const sentBody: { operations: { candidate_id: string; disposition: string }[] } = JSON.parse(sent.body);
  assert.deepEqual(
    sentBody.operations.map(op => [op.candidate_id, op.disposition]),
    [
      ['c1', 'allow'],
      ['c2', 'allow'],
    ],
  );
});

test('전송 실패는 같은 내용의 재시도에서 같은 키를 쓴다', async t => {
  let attempt = 0;
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) {
      attempt += 1;
      if (attempt === 1) return null;
      return jsonResponse({ data: {} });
    }
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  await run(() => result.current.apply());
  await run(() => result.current.apply());
  const sent = calls.filter(call => call.url.endsWith('/decision-batches'));
  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.headers['idempotency-key'], sent[1]?.headers['idempotency-key']);
});

test('내용을 바꾸면 새 Idempotency-Key를 쓴다', async t => {
  let revision = 1;
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) {
      revision += 1;
      return jsonResponse({ data: {} });
    }
    return jsonResponse(taskEnvelope({ revision }));
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  await run(() => result.current.apply());
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  await run(() => result.current.apply());
  const sent = calls.filter(call => call.url.endsWith('/decision-batches'));
  assert.equal(sent.length, 2);
  assert.notEqual(sent[0]?.headers['idempotency-key'], sent[1]?.headers['idempotency-key']);
});

test('409는 미리보기를 무효화하고 작업 조회로 복구한다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) {
      return jsonResponse({ error: { code: 'CONFLICT', message: 'm', retryable: false } }, 409);
    }
    return jsonResponse(taskEnvelope({ revision: 2 }));
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  await run(() => result.current.apply());
  assert.equal(draftOf(result.current, 'c1').preview, null);
  assert.equal(result.current.snapshot?.revision, 2);
  assert.ok(calls.some(call => call.method === 'GET'));
});

test('배치 실패는 기존 결정을 유지한다', async t => {
  const before = savedDecision();
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) {
      return jsonResponse({ error: { code: 'BATCH', message: 'm', retryable: false } }, 422);
    }
    return jsonResponse(taskEnvelope({ decisions: { d1: before } }));
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  await run(() => result.current.apply());
  assert.deepEqual(result.current.snapshot?.decisions, { d1: before });
  assert.notEqual(result.current.message, '');
});

test('철회는 revision을 싣고 성공 뒤 조회로 갱신하며 과거 허용을 되살리지 않는다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/revoke')) return jsonResponse({ data: {} });
    return jsonResponse(taskEnvelope({ decisions: { d1: savedDecision() } }));
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  await run(() => result.current.revoke('d1'));
  const sent = calls.find(call => call.url.endsWith('/revoke'));
  assert.ok(sent);
  assert.deepEqual(JSON.parse(sent.body), { expected_revision: 1 });
  assert.equal(sent.headers['x-csrf-token'], 'fixture-token');
  assert.ok(sent.headers['idempotency-key']);
  assert.equal(draftOf(result.current, 'c1').disposition, 'defer');
  assert.ok(calls.some(call => call.method === 'GET'));
});

test('제외 결정은 투영이 없어 빈 해시로도 유효하게 읽는다', async t => {
  const { fetch } = stubFetch(() =>
    jsonResponse(
      taskEnvelope({
        decisions: { d2: savedDecision({ id: 'd2', disposition: 'exclude', projection_sha256: '' }) },
      }),
    ),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  assert.ok(result.current.snapshot);
  assert.equal(result.current.snapshot?.decisions.d2?.disposition, 'exclude');
});

test('늦게 온 적용 응답이 사용자가 새로 고른 작업을 되돌리지 않는다', async t => {
  const batch = Promise.withResolvers<Response>();
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return jsonResponse(previewEnvelope());
    if (call.url.endsWith('/decision-batches')) return batch.promise;
    if (call.url.endsWith('/t2')) return jsonResponse(taskEnvelope({ id: 't2' }));
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  let applying!: Promise<void>;
  await act(async () => {
    applying = result.current.apply();
  });
  await run(() => result.current.loadTask('t2'));
  await act(async () => {
    batch.resolve(jsonResponse({ data: {} }));
    await applying;
  });
  assert.equal(result.current.snapshot?.id, 't2');
  assert.equal(calls.filter(call => call.method === 'GET' && call.url.endsWith('/t1')).length, 1);
});

test('이전 요청 실패가 최신 요청의 busy를 풀지 않는다', async t => {
  const preview = Promise.withResolvers<Response>();
  const load = Promise.withResolvers<Response>();
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/disclosure-previews')) return preview.promise;
    if (call.url.endsWith('/t2')) return load.promise;
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  let previewing!: Promise<void>;
  let loading!: Promise<void>;
  await act(async () => {
    previewing = result.current.preview('c1');
    loading = result.current.loadTask('t2');
  });
  await act(async () => {
    preview.reject(new Error('연결 끊김'));
    await previewing;
  });
  assert.equal(result.current.busy, true);
  assert.ok(!result.current.message.includes('미리보기 전송에 실패'));
  await act(async () => {
    load.resolve(jsonResponse(taskEnvelope({ id: 't2' })));
    await loading;
  });
  assert.equal(result.current.busy, false);
  assert.equal(result.current.snapshot?.id, 't2');
});

test('생성 가능 여부는 철회·만료·supersedes를 반영한 현재 저장 결정만 센다', async t => {
  const draftOnly = taskEnvelope({ revision: 1 });
  const saved = taskEnvelope({ revision: 2, decisions: { d1: savedDecision() } });
  const revoked = taskEnvelope({
    revision: 3,
    decisions: {
      d1: savedDecision(),
      d2: savedDecision({
        id: 'd2',
        disposition: 'defer',
        projection_sha256: '',
        revoked: true,
        supersedes_id: 'd1',
      }),
    },
  });
  const superseded = taskEnvelope({
    revision: 4,
    decisions: {
      d1: savedDecision(),
      d2: savedDecision({ id: 'd2', disposition: 'exclude', projection_sha256: '', supersedes_id: 'd1' }),
    },
  });
  const expired = taskEnvelope({
    revision: 5,
    decisions: { d1: savedDecision({ expires_at: '2000-01-01T00:00:00Z' }) },
  });
  const envelopes = [draftOnly, saved, revoked, superseded, expired];
  let index = 0;
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews') ? jsonResponse(previewEnvelope()) : jsonResponse(envelopes[index] ?? draftOnly),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  assert.equal(result.current.canGenerate, false);
  for (const expected of [true, false, false, false]) {
    index += 1;
    await run(() => result.current.loadTask('t1'));
    assert.equal(result.current.canGenerate, expected);
  }
});

function fieldsEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      candidate_id: 'c1',
      input_revision: 1,
      source_version_id: 's1',
      fields: ['name', '', 'amount'],
      reusable: false,
      ...overrides,
    },
  };
}

/** fetch 응답 마이크로태스크·매크로태스크를 한 번 흘려보내 실제 응답 반영을 기다린다. */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}

test('C는 서버 필드 목록을 그대로 쓰고 빈 JSON pointer 선택을 표현에 남긴다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url.endsWith('/fields')) return jsonResponse(fieldsEnvelope());
    if (call.url.endsWith('/disclosure-previews')) {
      return jsonResponse(
        previewEnvelope({
          representation: { kind: 'selected_fields', transform_id: 'select_fields.v1', parameters: { fields: ['name', ''] } },
          projection: { statement: '', columns: ['name', ''], rows: [['a', 'b']] },
        }),
      );
    }
    return jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'C'));
  await run(settle);
  const entry = result.current.fields.get('c1');
  assert.ok(entry);
  assert.equal(entry.status, 'ready');
  assert.deepEqual(entry.fields, ['name', '', 'amount']);
  await run(() => result.current.toggleField('c1', 'name', true));
  await run(() => result.current.toggleField('c1', '', true));
  const draft = draftOf(result.current, 'c1');
  assert.deepEqual(draft.representation, {
    kind: 'selected_fields',
    transform_id: 'select_fields.v1',
    parameters: { fields: ['name', ''] },
  });
  await run(() => result.current.preview('c1'));
  const sent = calls.find(call => call.url.endsWith('/disclosure-previews'));
  assert.ok(sent);
  const body = JSON.parse(sent.body) as { representation: { kind: string; parameters: { fields: string[] } } };
  assert.equal(body.representation.kind, 'selected_fields');
  assert.deepEqual(body.representation.parameters.fields, ['name', '']);
  assert.deepEqual(draftOf(result.current, 'c1').preview?.projection.columns, ['name', '']);
});

test('필드 목록 revision이 현재 작업과 다르면 선택·미리보기를 버리고 작업을 다시 조회한다', async t => {
  const { calls, fetch } = stubFetch(call =>
    call.url.endsWith('/fields') ? jsonResponse(fieldsEnvelope({ input_revision: 2 })) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'C'));
  await run(settle);
  const entry = result.current.fields.get('c1');
  assert.equal(entry?.status, 'failed');
  assert.equal(entry?.inputRevision, 2);
  assert.equal(draftOf(result.current, 'c1').representation, null);
  assert.equal(draftOf(result.current, 'c1').selection.size, 0);
  // 재조회로 복구하기 전에는 미리보기를 보내지 않는다.
  await run(() => result.current.preview('c1'));
  assert.equal(calls.filter(call => call.url.endsWith('/disclosure-previews')).length, 0);
  await run(() => result.current.toggleField('c1', 'name', true));
  assert.equal(draftOf(result.current, 'c1').representation, null);
  assert.notEqual(draftOf(result.current, 'c1').message, '');
});

test('401은 성공으로 두지 않고 세션 재확인 콜백을 한 번 부른다', async t => {
  let authRequests = 0;
  const { fetch } = stubFetch(() => jsonResponse({ error: 'UNAUTHENTICATED' }, 401));
  const { result } = await mount(t, {
    fetch,
    csrfToken: 'fixture-token',
    onAuthRequired: () => {
      authRequests += 1;
    },
  });
  await run(() => result.current.loadTask('t1'));
  assert.equal(authRequests, 1);
  assert.equal(result.current.snapshot, null);
  assert.notEqual(result.current.message, '');
});

test('cancel_requested 해석 작업은 진행 상태로 파싱되고 계속 조회된다', async t => {
  const { calls, fetch } = stubFetch(call => {
    if (call.url === '/api/v1/jobs/job-1') return jsonResponse(jobEnvelope({ status: 'cancel_requested' }));
    return call.method === 'POST' ? jsonResponse(jobEnvelope({ status: 'running' })) : jsonResponse(taskEnvelope());
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'D'));
  await run(() => result.current.setCondition('c1', '조건'));
  await run(() => result.current.interpret('c1'));
  assert.equal(draftOf(result.current, 'c1').jobStatus, 'running');
  await run(() => result.current.refreshInterpretation('c1'));
  assert.equal(draftOf(result.current, 'c1').jobStatus, 'cancel_requested');
  assert.match(draftOf(result.current, 'c1').message, /취소/);
  await run(() => result.current.refreshInterpretation('c1'));
  assert.equal(calls.filter(call => call.method === 'GET' && call.url === '/api/v1/jobs/job-1').length, 2);
});

test('작업을 비우면 snapshot·초안·필드 목록이 모두 사라진다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/fields') ? jsonResponse(fieldsEnvelope()) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'C'));
  await run(settle);
  assert.ok(result.current.fields.get('c1'));
  await run(() => result.current.clearTask());
  assert.equal(result.current.snapshot, null);
  assert.equal(result.current.drafts.size, 0);
  assert.equal(result.current.fields.size, 0);
  assert.notEqual(result.current.message, '');
});
