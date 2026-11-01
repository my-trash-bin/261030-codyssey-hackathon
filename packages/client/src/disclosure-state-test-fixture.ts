import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { act } from 'react';
import type { Draft } from './disclosure-state.ts';
import { renderHook } from './test-helpers/react-hook.ts';
import type { HookResult } from './test-helpers/react-hook.ts';
import { useDisclosures } from './ui/hooks/useDisclosures.ts';
import type { DisclosuresApi } from './ui/hooks/useDisclosures.ts';

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function stubFetch(handler: (call: Call) => Response | Promise<Response> | null) {
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

export function candidate(overrides: Record<string, unknown> = {}) {
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

export function scope() {
  return {
    project_id: 'p1',
    purpose_id: 'oss_issue',
    recipient_id: 'r1',
    audience: 'public',
    skill_set_hash: 'h',
  };
}

export function savedDecision(overrides: Record<string, unknown> = {}) {
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

export function taskEnvelope(overrides: Record<string, unknown> = {}) {
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

export function previewEnvelope(overrides: Record<string, unknown> = {}) {
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

export function jobEnvelope(overrides: Record<string, unknown> = {}) {
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

export function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'disclosure_proposal.v1',
    status: 'supported',
    candidate_id: 'c1',
    representation: { kind: 'fact_summary', transform_id: '', parameters: {} },
    requires_clarification: false,
    ...overrides,
  };
}

export function draftOf(api: DisclosuresApi, id: string): Draft {
  const draft = api.drafts.get(id);
  assert.ok(draft, '후보 초안이 있어야 합니다');
  return draft;
}

/** 실제 React root에서 훅을 실행하고, 테스트가 끝나면 언마운트한다. */
export async function mount(
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
export async function run<T>(change: () => T | Promise<T>): Promise<void> {
  await act(async () => {
    await change();
  });
}
