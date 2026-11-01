import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { candidate, draftOf, jobEnvelope, jsonResponse, mount, previewEnvelope, proposal, run, savedDecision, scope, stubFetch, taskEnvelope } from './disclosure-state-test-fixture.ts';

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
