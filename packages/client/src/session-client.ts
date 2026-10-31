// 로컬 접속 세션. 운영자 토큰을 POST /api/v1/session으로 교환하고 CSRF 토큰만 돌려준다.
// 토큰은 메모리에만 두며 저장소·로그·URL에 남기지 않는다. 응답 DTO는 docs/design/api.md의
// "인증된 task·공개 결정 API" 절을 따른다.
import { isRecord } from './disclosure-contract.ts';

export interface SessionEnvironment {
  providerOrigin: string | null;
  approvalStatus: string;
  verifiedAt: string | null;
}

export interface SessionInfo {
  csrfToken: string;
  expiresAt: string;
  environment: SessionEnvironment | null;
  capabilities: Record<string, boolean>;
}

export type SessionFailureKind =
  | 'invalid_token'
  | 'no_session'
  | 'boundary'
  | 'disabled'
  | 'limit'
  | 'malformed'
  | 'network'
  | 'server';

export interface SessionFailure {
  kind: SessionFailureKind;
  status: number;
  code: string;
}

export type SessionResult = { ok: true; session: SessionInfo } | { ok: false; failure: SessionFailure };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type SessionLogoutResult = { ok: true } | { ok: false; failure: SessionFailure };

/** 멱등 키. 브라우저에 없으면 시간·난수 조합으로 만든다. 저장하지 않는다. */
function idempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === 'function') return random.call(globalThis.crypto);
  return `logout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function parseEnvironment(value: unknown): SessionEnvironment | null {
  if (!isRecord(value)) return null;
  return {
    providerOrigin: typeof value.provider_origin === 'string' ? value.provider_origin : null,
    approvalStatus: typeof value.approval_status === 'string' ? value.approval_status : '',
    verifiedAt: typeof value.verified_at === 'string' ? value.verified_at : null,
  };
}

function parseCapabilities(value: unknown): Record<string, boolean> {
  const capabilities: Record<string, boolean> = {};
  if (!isRecord(value)) return capabilities;
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'boolean') capabilities[key] = entry;
  return capabilities;
}

/** 성공 응답 본문을 검사한다. 형식이 다르면 null을 돌려주고 쓰기를 열지 않는다. */
export function parseSession(body: unknown): SessionInfo | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const data = body.data;
  const csrfToken = data.csrf_token;
  const expiresAt = data.expires_at;
  if (typeof csrfToken !== 'string' || csrfToken === '') return null;
  if (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))) return null;
  return {
    csrfToken,
    expiresAt,
    environment: parseEnvironment(data.analysis_environment),
    capabilities: parseCapabilities(data.capabilities),
  };
}

function failureKind(status: number, mode: 'open' | 'restore'): SessionFailureKind {
  if (status === 401) return mode === 'open' ? 'invalid_token' : 'no_session';
  if (status === 403) return 'boundary';
  if (status === 503) return 'disabled';
  if (status === 429) return 'limit';
  return 'server';
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === 'string') return body.error;
    if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') return body.error.code;
  } catch {
    // 본문이 JSON이 아니면 상태 코드만 남긴다.
  }
  return '';
}

async function requestSession(
  fetchFn: FetchFn,
  mode: 'open' | 'restore',
  token?: string,
): Promise<SessionResult> {
  let response: Response;
  try {
    response = mode === 'open'
      ? await fetchFn('/api/v1/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token }),
      })
      : await fetchFn('/api/v1/session', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status, mode), status: response.status, code: await readErrorCode(response) } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  const session = parseSession(body);
  if (!session) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, session };
}

/** 운영자 토큰으로 세션을 연다. 빈 토큰은 요청 없이 거부한다. */
export function openSession(fetchFn: FetchFn, token: string): Promise<SessionResult> {
  const trimmed = token.trim();
  if (trimmed === '') return Promise.resolve({ ok: false, failure: { kind: 'invalid_token', status: 0, code: 'EMPTY_TOKEN' } });
  return requestSession(fetchFn, 'open', trimmed);
}

/** 이미 열린 세션(쿠키)을 조회한다. 토큰을 다시 보내지 않는다. */
export function restoreSession(fetchFn: FetchFn): Promise<SessionResult> {
  return requestSession(fetchFn, 'restore');
}

/**
 * 열린 세션을 닫는다. 서버는 Origin·CSRF·멱등 키를 확인하고 쿠키를 지운다.
 * 쿠키를 지우지 못한 경우에도 화면은 사유를 보여 주고 세션 상태를 유지한다.
 */
export async function logoutSession(fetchFn: FetchFn, csrfToken: string): Promise<SessionLogoutResult> {
  let response: Response;
  try {
    response = await fetchFn('/api/v1/session', {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': idempotencyKey(),
      },
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status, 'restore'), status: response.status, code: await readErrorCode(response) } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  if (!isRecord(body) || !isRecord(body.data) || body.data.logged_out !== true) {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  return { ok: true };
}

/** 화면에 표시할 사유. 토큰 값이나 서버 내부 정보를 담지 않는다. */
export function sessionFailureMessage(failure: SessionFailure): string {
  switch (failure.kind) {
    case 'invalid_token':
      return failure.code === 'EMPTY_TOKEN'
        ? '접속 토큰을 입력하세요.'
        : '토큰이 일치하지 않거나 이미 사용했거나 5분이 지났습니다. 서버를 다시 시작하면 터미널에 새 시작 토큰이 한 번 표시됩니다.';
    case 'no_session':
      return '열린 세션이 없습니다. 서버를 시작할 때 터미널에 한 번 표시된 시작 토큰을 입력해 세션을 시작하세요. 서버를 다시 시작했다면 새 토큰이 필요합니다.';
    case 'boundary':
      return '이 브라우저 주소는 서버가 허용한 loopback origin과 다릅니다. SAFEHANDOFF_WORKFLOW_BROWSER_ORIGIN을 확인하세요.';
    case 'disabled':
      return '인증 API가 비활성입니다. 서버를 SAFEHANDOFF_WORKFLOW_ENABLED=1로 시작하면 터미널에 5분 동안 한 번만 쓸 수 있는 시작 토큰이 표시됩니다. 32자 이상 SAFEHANDOFF_WORKFLOW_TOKEN을 설정한 경우에는 그 토큰을 그대로 입력하세요.';
    case 'limit':
      return '세션을 더 열 수 없습니다. 서버를 다시 시작하거나 기존 세션이 만료될 때까지 기다리세요.';
    case 'malformed':
      return '세션 응답 형식이 예상과 다릅니다. 쓰기를 열지 않았습니다.';
    case 'network':
      return '서버에 연결할 수 없습니다.';
    default:
      return `세션을 열지 못했습니다.${failure.code === '' ? '' : ` (${failure.code})`}`;
  }
}
