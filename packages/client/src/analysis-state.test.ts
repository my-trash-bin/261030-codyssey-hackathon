import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisWorkspace } from './analysis-state.ts';

interface Call {
  url: string;
  method: string;
  body: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (call: Call, index: number) => Response | Promise<Response> | null) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' };
    calls.push(call);
    const answer = await handler(call, calls.length - 1);
    if (answer) return answer;
    throw new Error('연결 실패');
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchFn };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

// tsconfig의 lib이 ES2023이라 Promise.withResolvers 타입을 쓰지 않는다.
function deferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sourceOf(body: string): { id: string; bytes: number } {
  const parsed = JSON.parse(body) as { sources: { id: string; raw_bytes: string }[] };
  const first = parsed.sources[0]!;
  return { id: first.id, bytes: Buffer.from(first.raw_bytes, 'base64').length };
}

function validBody(sourceVersionId: string, end: number, candidateEvidenceIds: string[] = ['ev_1']) {
  return {
    evidence: [{
      id: 'ev_1',
      source_version_id: sourceVersionId,
      locator: { kind: 'byte_range' },
      start: 0,
      end,
      evidence_sha256: 'a'.repeat(64),
    }],
    proposals: {
      schema_version: 'candidate_proposals.v1',
      candidates: [{
        local_key: 'c1',
        kind: 'observation',
        uncertainty: 'observed',
        statement: '로그에 오류가 한 줄 있다.',
        evidence_ids: candidateEvidenceIds,
        relevance: 'required',
        purpose_relevance: '수신처가 원인을 판단하려면 필요하다.',
      }],
      conflicts: [],
    },
  };
}

function workspaceFor(fetchFn: typeof fetch, onChange: () => void = () => {}): AnalysisWorkspace {
  return new AnalysisWorkspace(onChange, { fetch: fetchFn });
}

function txt(name = 'a.txt', text = 'alpha\n'): File {
  return new File([new TextEncoder().encode(text)], name);
}

test('파일을 고르기만 하면 전송하지 않고, 동의 없이 실행해도 전송하지 않는다', async () => {
  const stub = stubFetch(() => null);
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  assert.equal(stub.calls.length, 0);

  await workspace.run();
  assert.equal(stub.calls.length, 0);
  assert.equal(workspace.problem?.field, 'consent');
  assert.match(workspace.message, /동의/);
  assert.equal(workspace.busy, false);
});

test('지원하지 않는 파일이 섞이면 나머지만 골라 보내지 않는다', async () => {
  const stub = stubFetch(() => null);
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt(), new File(['x'], 'bad.exe')]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(stub.calls.length, 0);
  assert.equal(workspace.problem?.field, 'files');
  assert.match(workspace.problem?.message ?? '', /bad\.exe/);
  assert.equal(workspace.busy, false);
});

test('객체 상속 속성 이름의 확장자는 지원 형식으로 취급하지 않는다', async () => {
  for (const name of ['자료.constructor', '자료.__proto__', '자료.toString']) {
    const stub = stubFetch(() => null);
    const workspace = workspaceFor(stub.fetch);
    workspace.setFiles([txt(), new File(['x'], name)]);
    workspace.setContext('목적', '수신처');
    workspace.setConsent(true);

    await workspace.run();
    assert.equal(stub.calls.length, 0, name);
    assert.equal(workspace.problem?.field, 'files', name);
    assert.match(workspace.problem?.message ?? '', /지원하지 않는 파일 형식/, name);
  }
});

test('취소 뒤 늦게 도착한 성공 응답은 결과로 채택하지 않는다', async () => {
  const gate = deferred<Response>();
  const reached = deferred<void>();
  const stub = stubFetch(() => {
    reached.resolve();
    return gate.promise;
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  const running = workspace.run();
  await reached.promise;
  workspace.cancel();
  assert.equal(workspace.busy, false);
  const sent = sourceOf(stub.calls[0]!.body);
  gate.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await running;

  assert.equal(workspace.result, null);
  assert.equal(workspace.busy, false);
  assert.match(workspace.message, /취소/);
});

test('입력이 바뀌면 진행 중 요청을 취소하고 늦은 결과를 채택하지 않는다', async () => {
  const gate = deferred<Response>();
  const reached = deferred<void>();
  const stub = stubFetch(() => {
    reached.resolve();
    return gate.promise;
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  const running = workspace.run();
  await reached.promise;
  workspace.setContext('목적', '다른 수신처');
  assert.equal(workspace.consent, false);

  const sent = sourceOf(stub.calls[0]!.body);
  gate.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await running;

  assert.equal(workspace.result, null);
  assert.equal(workspace.busy, false);
  assert.match(workspace.message, /취소/);
});

test('취소 뒤 새 분석을 시작하면 이전 응답은 무시하고 새 응답만 채택한다', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const reachedFirst = deferred<void>();
  const reachedSecond = deferred<void>();
  const stub = stubFetch((_call, index) => {
    if (index === 0) {
      reachedFirst.resolve();
      return first.promise;
    }
    reachedSecond.resolve();
    return second.promise;
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  const runningFirst = workspace.run();
  await reachedFirst.promise;
  workspace.cancel();

  const runningSecond = workspace.run();
  await reachedSecond.promise;

  const sent = sourceOf(stub.calls[0]!.body);
  first.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await runningFirst;
  const pendingBeforeSecond = workspace.result;
  assert.equal(pendingBeforeSecond, null);
  assert.equal(workspace.busy, true);

  second.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await runningSecond;
  assert.equal(workspace.result?.proposals.candidates.length, 1);
  assert.equal(workspace.busy, false);
});

test('이전 성공 결과는 입력 변경 뒤에도 남고 resultIsCurrent만 false가 된다', async () => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes));
  });
  const state = workspaceFor(stub.fetch);
  state.setFiles([txt()]);
  state.setContext('목적', '수신처');
  state.setConsent(true);
  await state.run();
  assert.equal(state.resultIsCurrent, true);
  const previous = state.result;
  assert.ok(previous);

  state.setContext('목적', '다른 수신처');
  assert.equal(state.result, previous);
  assert.equal(state.resultIsCurrent, false);
  assert.equal(state.consent, false);
  assert.equal(state.purpose, '목적');
  assert.equal(state.recipient, '다른 수신처');
  assert.equal(state.files.length, 1);
});

test('요청 실패는 입력과 이전 성공 결과를 보존한다', async () => {
  let failNext = false;
  const stub = stubFetch((call) => {
    if (failNext) return null;
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes));
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);
  await workspace.run();
  const previous = workspace.result;
  assert.ok(previous);
  assert.equal(workspace.resultIsCurrent, true);

  failNext = true;
  await workspace.run();
  assert.equal(workspace.result, previous);
  assert.equal(workspace.files.length, 1);
  assert.equal(workspace.purpose, '목적');
  assert.equal(workspace.recipient, '수신처');
  assert.equal(workspace.consent, true);
  assert.equal(workspace.busy, false);
  assert.equal(workspace.resultIsCurrent, true);
  assert.equal(workspace.problem?.field, 'request');
  assert.match(workspace.message, /직전 분석 결과는 그대로 유지합니다/);
});

test('원본을 벗어난 근거 바이트 범위를 담은 응답은 통째로 거부한다', async () => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes + 1));
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(workspace.result, null);
  assert.equal(workspace.problem?.field, 'request');
  assert.match(workspace.message, /해석할 수 없어/);
});

test('없는 근거를 참조하는 후보가 있으면 응답 전체를 거부한다', async () => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes, ['ev_missing']));
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(workspace.result, null);
  assert.equal(workspace.problem?.field, 'request');
});

test('crypto.subtle가 없으면 전송하지 않고 HTTPS·localhost 안내를 남긴다', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const stub = stubFetch(() => null);
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    await workspace.run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
  }

  assert.equal(stub.calls.length, 0);
  assert.equal(workspace.problem?.field, 'request');
  assert.match(workspace.message, /HTTPS 또는 localhost/);
});

test('오류 본문의 문자열 코드를 메시지에 표시하고 자동 재시도하지 않는다', async () => {
  const stub = stubFetch(() => jsonResponse({ error: 'MODEL_BUDGET_EXCEEDED' }, 503));
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt()]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(stub.calls.length, 1);
  assert.equal(workspace.result, null);
  assert.equal(workspace.problem?.field, 'request');
  assert.match(workspace.message, /MODEL_BUDGET_EXCEEDED/);
  assert.match(workspace.message, /자동 재시도하지 않습니다/);
  assert.equal(workspace.busy, false);
});

test('같은 목적·수신처를 다시 설정하면 알리지 않고 동의를 유지한다', () => {
  let changes = 0;
  const workspace = workspaceFor(stubFetch(() => null).fetch, () => {
    changes += 1;
  });
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);
  const before = changes;

  workspace.setContext('목적', '수신처');
  assert.equal(changes, before);
  assert.equal(workspace.consent, true);
});

test('빈 바이트 범위(start===end) 근거는 유효한 근거로 받는다', async () => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, 0));
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt('빈.txt', 'alpha\n')]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(workspace.result?.evidence[0]?.start, 0);
  assert.equal(workspace.result?.evidence[0]?.end, 0);
});

test('UTF-8 문자 중간에서 끊긴 근거 범위는 거부한다', async () => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, 1));
  });
  const workspace = workspaceFor(stub.fetch);
  workspace.setFiles([txt('한글.txt', '한\n')]);
  workspace.setContext('목적', '수신처');
  workspace.setConsent(true);

  await workspace.run();
  assert.equal(workspace.result, null);
  assert.equal(workspace.problem?.field, 'request');
});
