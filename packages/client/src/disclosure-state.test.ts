import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { orderCandidates } from './disclosure-format.ts';
import { candidate, draftOf, jobEnvelope, jsonResponse, mount, previewEnvelope, proposal, run, savedDecision, scope, stubFetch, taskEnvelope } from './disclosure-state-test-fixture.ts';

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

test('결정을 저장하면 재조회가 저장 결과 문구를 지우지 않는다', async t => {
  let saved = false;
  const { fetch } = stubFetch(call => {
    if (call.url.endsWith('/decision-batches')) { saved = true; return jsonResponse({ data: {} }); }
    return jsonResponse(taskEnvelope({ revision: saved ? 2 : 1, candidates: [candidate({ id: 'c1' }), candidate({ id: 'c2' })] }));
  });
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'exclude'));
  await run(() => result.current.chooseDisposition('c2', 'defer'));
  await run(() => result.current.apply());
  assert.match(result.current.message, /결정 2개를 저장했습니다/);
  assert.match(result.current.message, /보류 1개/);
});

test('판본만 오른 재조회는 문구를 남기지 않는다', async t => {
  let revision = 1;
  const { fetch } = stubFetch(() => jsonResponse(taskEnvelope({ revision })));
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  revision = 2;
  await run(() => result.current.loadTask('t1'));
  assert.equal(result.current.message, '');
});

test('비운 미리보기가 있으면 판본 변경을 알린다', async t => {
  let revision = 1;
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/disclosure-previews') ? jsonResponse(previewEnvelope()) : jsonResponse(taskEnvelope({ revision })),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'allow'));
  await run(() => result.current.chooseMode('c1', 'A'));
  await run(() => result.current.preview('c1'));
  revision = 2;
  await run(() => result.current.loadTask('t1'));
  assert.match(result.current.message, /미리보기와 조건 해석을 다시/);
});

test('후보는 필수 먼저, 확인된 사실 먼저 정렬하고 원본을 바꾸지 않는다', () => {
  const input = [
    { id: 'a', required: false, kind: 'unknown' },
    { id: 'b', required: false, kind: 'observation' },
    { id: 'c', required: true, kind: 'hypothesis' },
  ];
  assert.deepEqual(orderCandidates(input).map(item => item.id), ['c', 'b', 'a']);
  assert.equal(input[0]?.id, 'a');
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

test('다른 작업을 열면 이전 선택 초안이 격리된다', async t => {
  const { fetch } = stubFetch(call =>
    call.url.endsWith('/t2') ? jsonResponse(taskEnvelope({ id: 't2' })) : jsonResponse(taskEnvelope()),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  await run(() => result.current.chooseDisposition('c1', 'defer'));
  await run(() => result.current.loadTask('t2'));
  assert.equal(result.current.drafts.size, 0);
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
