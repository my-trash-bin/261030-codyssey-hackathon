// 세션을 늦게 연 화면에서 목록 재조회가 누락되던 소비자 상태 회귀.
// /api/documents 첫 GET이 401로 끝나기 전에 세션 CSRF 토큰이 도착하면, 진행 중 조회와 같은
// dedup(documentsRequest)에 걸려 새 GET이 나가지 않고 records가 비어 있던 문제를 검사한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';

import { renderHook } from './test-helpers/react-hook.ts';
import { useDocuments } from './ui/hooks/useDocuments.ts';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const stored = { id: 'd1', text: '저장된 메모', createdAt: '2026-11-01T00:00:00.000Z' };

test('세션을 늦게 열면 401로 끝난 첫 조회 뒤에 목록을 다시 조회해 records를 채운다', async t => {
  const pendingFirst = Promise.withResolvers<Response>();
  let gets = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, '/api/documents');
    if ((init?.method ?? 'GET') !== 'GET') return jsonResponse({ document: stored }, 201);
    gets += 1;
    return gets === 1 ? pendingFirst.promise : jsonResponse({ documents: [stored] });
  }) as unknown as typeof fetch;

  // App과 같은 구조: 세션 토큰은 상위 화면 상태이고, 훅은 그 값을 props로 받는다.
  const control: { openSession?: (token: string) => void } = {};
  const mounted = await renderHook(() => {
    const [csrfToken, setCsrfToken] = useState<string | null>(null);
    control.openSession = setCsrfToken;
    return useDocuments({ csrfToken, fetch: fetchFn });
  });
  t.after(mounted.unmount);

  // 첫 조회는 아직 진행 중이고(401 대기), 그 사이에 세션이 열린다.
  await act(async () => { control.openSession?.('fixture-session-csrf'); });
  assert.equal(gets, 1, '진행 중인 조회와 같은 요청을 중복 발행하지 않는다');
  assert.deepEqual(mounted.result.current.records, []);

  await act(async () => { pendingFirst.resolve(jsonResponse({ error: 'AUTH_REQUIRED' }, 401)); });

  assert.equal(gets, 2, '세션이 열렸으면 401로 끝난 조회 뒤에 목록을 다시 조회해야 합니다');
  assert.deepEqual(mounted.result.current.records, [stored]);
  assert.equal(mounted.result.current.loaded, true);
});
