// 파일 분석 소비자 동작 검사. 실제 React 훅(useAnalysis)을 jsdom root에 mount하고
// 명령은 React act 안에서 호출한다. 상태는 렌더별 snapshot이므로 매번 result.current에서 읽는다.

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { toWireSources } from './analysis-state.ts';
import { renderHook } from './test-helpers/react-hook.ts';
import { useAnalysis } from './ui/hooks/useAnalysis.ts';
import type { AnalysisApi } from './ui/hooks/useAnalysis.ts';

interface Call {
  url: string;
  method: string;
  body: string;
  signal: AbortSignal | undefined;
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
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      signal: init?.signal ?? undefined,
    };
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

function deferred<T>(): Deferred<T> {
  return Promise.withResolvers<T>();
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

interface Mounted {
  result: { readonly current: AnalysisApi };
  unmount: () => Promise<void>;
}

function analysisFor(fetchFn: typeof fetch): Promise<Mounted> {
  return renderHook(() => useAnalysis({ fetch: fetchFn }));
}

function txt(name = 'a.txt', text = 'alpha\n'): File {
  return new File([new TextEncoder().encode(text)], name);
}

// 파일·목적·수신처·동의를 갖춘 상태로 만든다. 각 명령은 별도 act에서 flush한다.
async function prepare(mounted: Mounted): Promise<void> {
  await act(() => { mounted.result.current.setFiles([txt()]); });
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  await act(() => { mounted.result.current.setConsent(true); });
}

test('파일을 고르기만 하면 전송하지 않고, 동의 없이 실행해도 전송하지 않는다', async (t) => {
  const stub = stubFetch(() => null);
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);

  await act(() => { mounted.result.current.setFiles([txt()]); });
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  assert.equal(stub.calls.length, 0);

  await act(() => mounted.result.current.run());
  assert.equal(stub.calls.length, 0);
  assert.equal(mounted.result.current.problem?.field, 'consent');
  assert.match(mounted.result.current.message, /동의/);
  assert.equal(mounted.result.current.busy, false);
});

test('지원하지 않는 파일이 섞이면 나머지만 골라 보내지 않는다', async (t) => {
  const stub = stubFetch(() => null);
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);

  await act(() => { mounted.result.current.setFiles([txt(), new File(['x'], 'bad.exe')]); });
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  await act(() => { mounted.result.current.setConsent(true); });

  await act(() => mounted.result.current.run());
  assert.equal(stub.calls.length, 0);
  assert.equal(mounted.result.current.problem?.field, 'files');
  assert.match(mounted.result.current.problem?.message ?? '', /bad\.exe/);
  assert.equal(mounted.result.current.busy, false);
});

test('객체 상속 속성 이름의 확장자는 지원 형식으로 취급하지 않는다', async () => {
  for (const name of ['자료.constructor', '자료.__proto__', '자료.toString']) {
    const stub = stubFetch(() => null);
    const mounted = await analysisFor(stub.fetch);
    await act(() => { mounted.result.current.setFiles([txt(), new File(['x'], name)]); });
    await act(() => { mounted.result.current.setContext('목적', '수신처'); });
    await act(() => { mounted.result.current.setConsent(true); });

    await act(() => mounted.result.current.run());
    assert.equal(stub.calls.length, 0, name);
    assert.equal(mounted.result.current.problem?.field, 'files', name);
    assert.match(mounted.result.current.problem?.message ?? '', /지원하지 않는 파일 형식/, name);
    await mounted.unmount();
  }
});

test('취소 뒤 늦게 도착한 성공 응답은 결과로 채택하지 않는다', async (t) => {
  const gate = deferred<Response>();
  const reached = deferred<void>();
  const stub = stubFetch(() => {
    reached.resolve();
    return gate.promise;
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  let running!: Promise<void>;
  await act(async () => {
    running = mounted.result.current.run();
    await reached.promise;
  });
  const sent = sourceOf(stub.calls[0]!.body);
  await act(() => { mounted.result.current.cancel(); });
  assert.equal(mounted.result.current.busy, false);

  gate.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await act(async () => { await running; });

  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.busy, false);
  assert.match(mounted.result.current.message, /취소/);
});

test('입력이 바뀌면 진행 중 요청을 취소하고 늦은 결과를 채택하지 않는다', async (t) => {
  const gate = deferred<Response>();
  const reached = deferred<void>();
  const stub = stubFetch(() => {
    reached.resolve();
    return gate.promise;
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  let running!: Promise<void>;
  await act(async () => {
    running = mounted.result.current.run();
    await reached.promise;
  });
  await act(() => { mounted.result.current.setContext('목적', '다른 수신처'); });
  assert.equal(mounted.result.current.consent, false);

  const sent = sourceOf(stub.calls[0]!.body);
  gate.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await act(async () => { await running; });

  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.busy, false);
  assert.match(mounted.result.current.message, /취소/);
});

test('취소 뒤 새 분석을 시작하면 이전 응답은 무시하고 새 응답만 채택한다', async (t) => {
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
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  let runningFirst!: Promise<void>;
  await act(async () => {
    runningFirst = mounted.result.current.run();
    await reachedFirst.promise;
  });
  await act(() => { mounted.result.current.cancel(); });

  let runningSecond!: Promise<void>;
  await act(async () => {
    runningSecond = mounted.result.current.run();
    await reachedSecond.promise;
  });

  const sent = sourceOf(stub.calls[0]!.body);
  first.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await act(async () => { await runningFirst; });
  // 첫 응답은 무시되고 두 번째 요청이 아직 진행 중이다. null 단언이 이후 조회까지 좁히지 않도록
  // 스냅숏을 지역 변수로 읽는다.
  const stillPending = mounted.result.current.result;
  assert.equal(stillPending, null);
  assert.equal(mounted.result.current.busy, true);

  second.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await act(async () => { await runningSecond; });
  assert.equal(mounted.result.current.result?.proposals.candidates.length, 1);
  assert.equal(mounted.result.current.busy, false);
});

test('이전 성공 결과는 입력 변경 뒤에도 남고 resultIsCurrent만 false가 된다', async (t) => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.resultIsCurrent, true);
  const previous = mounted.result.current.result;
  assert.ok(previous);

  await act(() => { mounted.result.current.setContext('목적', '다른 수신처'); });
  assert.equal(mounted.result.current.result, previous);
  assert.equal(mounted.result.current.resultIsCurrent, false);
  assert.equal(mounted.result.current.consent, false);
  assert.equal(mounted.result.current.purpose, '목적');
  assert.equal(mounted.result.current.recipient, '다른 수신처');
  assert.equal(mounted.result.current.files.length, 1);
});

test('요청 실패는 입력과 이전 성공 결과를 보존한다', async (t) => {
  let failNext = false;
  const stub = stubFetch((call) => {
    if (failNext) return null;
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  await act(() => mounted.result.current.run());
  const previous = mounted.result.current.result;
  assert.ok(previous);
  assert.equal(mounted.result.current.resultIsCurrent, true);

  failNext = true;
  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.result, previous);
  assert.equal(mounted.result.current.files.length, 1);
  assert.equal(mounted.result.current.purpose, '목적');
  assert.equal(mounted.result.current.recipient, '수신처');
  assert.equal(mounted.result.current.consent, true);
  assert.equal(mounted.result.current.busy, false);
  assert.equal(mounted.result.current.resultIsCurrent, true);
  assert.equal(mounted.result.current.problem?.field, 'request');
  assert.match(mounted.result.current.message, /직전 분석 결과는 그대로 유지합니다/);
});

test('원본을 벗어난 근거 바이트 범위를 담은 응답은 통째로 거부한다', async (t) => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes + 1));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.problem?.field, 'request');
  assert.match(mounted.result.current.message, /해석할 수 없어/);
});

test('없는 근거를 참조하는 후보가 있으면 응답 전체를 거부한다', async (t) => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, sent.bytes, ['ev_missing']));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.problem?.field, 'request');
});

test('crypto.subtle가 없으면 전송하지 않고 HTTPS·localhost 안내를 남긴다', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const stub = stubFetch(() => null);
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    await act(() => mounted.result.current.run());
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
  }

  assert.equal(stub.calls.length, 0);
  assert.equal(mounted.result.current.problem?.field, 'request');
  assert.match(mounted.result.current.message, /HTTPS 또는 localhost/);
});

test('오류 본문의 문자열 코드를 메시지에 표시하고 자동 재시도하지 않는다', async (t) => {
  const stub = stubFetch(() => jsonResponse({ error: 'MODEL_BUDGET_EXCEEDED' }, 503));
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await prepare(mounted);

  await act(() => mounted.result.current.run());
  assert.equal(stub.calls.length, 1);
  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.problem?.field, 'request');
  assert.match(mounted.result.current.message, /MODEL_BUDGET_EXCEEDED/);
  assert.match(mounted.result.current.message, /자동 재시도하지 않습니다/);
  assert.equal(mounted.result.current.busy, false);
});

test('같은 목적·수신처를 다시 설정하면 동의를 유지한다', async (t) => {
  const stub = stubFetch(() => null);
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  await act(() => { mounted.result.current.setConsent(true); });

  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  assert.equal(mounted.result.current.consent, true);
  assert.equal(mounted.result.current.purpose, '목적');
  assert.equal(mounted.result.current.recipient, '수신처');
  assert.equal(mounted.result.current.problem, null);
  assert.equal(stub.calls.length, 0);
});

test('빈 바이트 범위(start===end) 근거는 유효한 근거로 받는다', async (t) => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, 0));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await act(() => { mounted.result.current.setFiles([txt('빈.txt', 'alpha\n')]); });
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  await act(() => { mounted.result.current.setConsent(true); });

  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.result?.evidence[0]?.start, 0);
  assert.equal(mounted.result.current.result?.evidence[0]?.end, 0);
});

test('UTF-8 문자 중간에서 끊긴 근거 범위는 거부한다', async (t) => {
  const stub = stubFetch((call) => {
    const sent = sourceOf(call.body);
    return jsonResponse(validBody(sent.id, 1));
  });
  const mounted = await analysisFor(stub.fetch);
  t.after(mounted.unmount);
  await act(() => { mounted.result.current.setFiles([txt('한글.txt', '한\n')]); });
  await act(() => { mounted.result.current.setContext('목적', '수신처'); });
  await act(() => { mounted.result.current.setConsent(true); });

  await act(() => mounted.result.current.run());
  assert.equal(mounted.result.current.result, null);
  assert.equal(mounted.result.current.problem?.field, 'request');
});

test('언마운트하면 진행 중인 분석 요청을 중단한다', async () => {
  const gate = deferred<Response>();
  const reached = deferred<void>();
  const stub = stubFetch(() => {
    reached.resolve();
    return gate.promise;
  });
  const mounted = await analysisFor(stub.fetch);
  await prepare(mounted);

  let running!: Promise<void>;
  await act(async () => {
    running = mounted.result.current.run();
    await reached.promise;
  });
  const signal = stub.calls[0]!.signal;
  await mounted.unmount();
  assert.equal(signal?.aborted, true);

  const sent = sourceOf(stub.calls[0]!.body);
  gate.resolve(jsonResponse(validBody(sent.id, sent.bytes)));
  await running;
});

test('지원하지 않는 형식은 원자료로 만들지 않는다', async () => {
  await assert.rejects(() => toWireSources([new File(['x'], 'a.pdf')], crypto.subtle), /지원하지 않는 파일 형식/);
});

test('파일 없이 원자료를 만들지 않는다', async () => {
  await assert.rejects(() => toWireSources([], crypto.subtle), /하나 이상/);
});

test('파일 한도를 넘는 원자료를 거부한다', async () => {
  await assert.rejects(() => toWireSources([new File([new Uint8Array(262145)], 'big.txt')], crypto.subtle), /파일 한도/);
});

test('원자료는 형식·sha256·UTF-8 원본을 함께 담는다', async () => {
  const wire = await toWireSources([new File(['한글 로그'], 'a.log')], crypto.subtle);
  assert.equal(wire.length, 1);
  const first = wire[0]!;
  assert.equal(first.format, 'log');
  assert.equal(first.source_id, 'local_source_1');
  assert.equal(first.included, true);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(first.raw_bytes, 'base64').toString('utf8'), '한글 로그');
});
