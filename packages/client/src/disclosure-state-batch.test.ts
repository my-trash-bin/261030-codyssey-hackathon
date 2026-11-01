import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { candidate, draftOf, jobEnvelope, jsonResponse, mount, previewEnvelope, proposal, run, savedDecision, scope, stubFetch, taskEnvelope } from './disclosure-state-test-fixture.ts';

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

test('제외와 보류는 선택 후 바로 저장하며 범위 축소는 실제 필수 제외에만 보낸다', async t => {
  const { calls, fetch } = stubFetch(call =>
    call.url.endsWith('/decision-batches')
      ? jsonResponse({ data: {} })
      : jsonResponse(taskEnvelope({ candidates: [candidate({ id: 'c1', required: true })] })),
  );
  const { result } = await mount(t, { fetch, csrfToken: 'fixture-token' });
  await run(() => result.current.loadTask('t1'));
  for (const disposition of ['exclude', 'defer'] as const) {
    await run(() => result.current.chooseDisposition('c1', disposition));
    assert.equal(result.current.batchBlockReason, '');
    assert.equal(result.current.canGenerate, false);
    await run(() => result.current.apply());
    const sent = calls.filter(call => call.url.endsWith('/decision-batches')).at(-1);
    assert.ok(sent);
    const body = JSON.parse(sent.body);
    assert.equal(body.accept_scope_reduction, disposition === 'exclude');
    assert.deepEqual(body.operations, [{ candidate_id: 'c1', disposition }]);
  }
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
