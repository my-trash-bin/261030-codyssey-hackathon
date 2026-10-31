// 인증된 workflow API 공통 전송과 실패 분류. 이 파일은 규칙·작업 목록·이력 화면이 함께 쓴다.
// 응답 DTO 검사는 각 클라이언트(rules-client.ts, task-browser-client.ts)가 맡고 이 파일은
// HTTP·CSRF·멱등 키·오류 코드만 다룬다. GET은 CSRF 토큰을 보내지 않고 쓰기 요청에만 붙인다.
import { isRecord, newIdempotencyKey } from './disclosure-contract.ts';

export type WorkflowMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type WorkflowFailureKind =
  | 'auth'
  | 'boundary'
  | 'conflict'
  | 'invalid'
  | 'not_found'
  | 'rate_limit'
  | 'network'
  | 'malformed'
  | 'server';

export interface WorkflowFailure {
  kind: WorkflowFailureKind;
  status: number;
  code: string;
}

export type WorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: WorkflowFailure };

export interface WorkflowRequest<T> {
  method: WorkflowMethod;
  path: string;
  csrfToken?: string | null;
  payload?: unknown;
  /** 성공 본문(data envelope 포함)을 검사한다. 형식이 다르면 null을 돌려주고 화면 상태를 바꾸지 않는다. */
  parse: (body: unknown) => T | null;
}

function workflowFailureKind(status: number): WorkflowFailureKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'boundary';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 413 || status === 422) return 'invalid';
  if (status === 429) return 'rate_limit';
  return 'server';
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === 'string') return body.error;
    if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') return body.error.code;
  } catch {
    // JSON이 아니면 상태 코드만 남긴다.
  }
  return '';
}

const malformed = (status: number): { ok: false; failure: WorkflowFailure } => ({
  ok: false,
  failure: { kind: 'malformed', status, code: '' },
});

/** 세션 쿠키로 API를 호출한다. 쓰기는 CSRF 토큰과 새 멱등 키가 반드시 있어야 한다. */
export async function requestJson<T>(
  fetchFn: typeof fetch,
  request: WorkflowRequest<T>,
): Promise<WorkflowResult<T>> {
  const write = request.method !== 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (write) {
    const token = request.csrfToken ?? '';
    if (token === '') return { ok: false, failure: { kind: 'auth', status: 0, code: 'NO_CSRF_TOKEN' } };
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = token;
    headers['Idempotency-Key'] = newIdempotencyKey();
  }
  let response: Response;
  try {
    response = await fetchFn(request.path, {
      method: request.method,
      headers,
      credentials: 'same-origin',
      ...(write ? { body: JSON.stringify(request.payload ?? {}) } : {}),
    });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return {
      ok: false,
      failure: { kind: workflowFailureKind(response.status), status: response.status, code: await readErrorCode(response) },
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return malformed(response.status);
  }
  let value: T | null;
  try {
    value = request.parse(body);
  } catch {
    return malformed(response.status);
  }
  if (value === null) return malformed(response.status);
  return { ok: true, value };
}

// 서버 고정 오류 코드별 안내. 상세 원인을 추측하지 않고 코드가 뜻하는 범위만 말한다.
const CODE_MESSAGES: Record<string, string> = {
  NO_CSRF_TOKEN: '세션의 CSRF 토큰이 없어 쓰기를 보내지 않았습니다.',
  REVISION_CONFLICT: '작업 판본이 이미 바뀌었습니다. 최신 작업을 다시 불러온 뒤 다시 시도하세요.',
  TASK_DELETING: '이 작업은 삭제가 진행 중입니다. 다른 작업을 선택하세요.',
  INVALID_CURSOR: '목록 커서가 만료되었습니다. 첫 페이지부터 다시 조회하세요.',
  DELETE_CONFIRMATION_REQUIRED: '삭제 확인 문자열 DELETE와 재사용 규칙 보존 확인이 모두 필요합니다.',
  INVALID_RULE: '표현 변환 값이나 만료 시각이 서버 규칙에 맞지 않습니다.',
  RULE_SCOPE_REQUIRED: '이 작업에는 catalog intake가 없어 재사용 규칙을 저장하거나 명시 적용할 수 없습니다. intake로 만든 작업에서만 가능합니다.',
  RULE_NOT_REUSABLE: '선택한 결정의 값은 재사용 규칙으로 저장할 수 없습니다. 숫자 CSV 한 열의 방향·지수 변환만 저장됩니다.',
  RULE_NOT_APPLICABLE: '선택한 규칙이 이 작업의 후보·scope·goal과 맞지 않아 적용하지 않았습니다. 적용은 전부 성공하거나 전부 거부됩니다.',
  RULE_CONFLICT: '선택한 규칙들의 계산 결과가 서로 달라 충돌해 전체 적용을 거부했습니다. 규칙을 하나씩 다시 선택하세요.',
  RULE_INVALIDATED: '규칙이 철회되었거나 만료되어 적용할 수 없습니다. 규칙 목록을 새로 고친 뒤 다시 시도하세요.',
  RULE_VERSION_CONFLICT: '규칙 판본이 이미 바뀌었습니다. 규칙 목록을 새로 고친 뒤 다시 시도하세요.',
  RULE_NOT_FOUND: '규칙을 찾을 수 없습니다. 규칙 목록을 새로 고치세요.',
  INVALID_DECISION: '선택한 결정이 더 이상 유효하지 않습니다. 작업을 다시 조회하세요.',
  INVALID_IDEMPOTENCY_KEY: '요청 키가 서버 한도를 넘었습니다. 화면을 새로 고친 뒤 다시 시도하세요.',
  JOB_LIMIT: '동시 작업 한도에 걸렸습니다. 진행 중인 작업이 끝난 뒤 다시 시도하세요.',
};

/** 화면에 표시할 사유. 토큰 값이나 서버 내부 정보를 담지 않는다. */
export function workflowFailureMessage(failure: WorkflowFailure): string {
  const code = CODE_MESSAGES[failure.code];
  if (code !== undefined) return code;
  switch (failure.kind) {
    case 'auth':
      return '인증된 세션이 없거나 만료되었습니다. 세션을 다시 연 뒤 시도하세요.';
    case 'boundary':
      return '요청이 서버의 Host·Origin 검사에서 거부되었습니다. 브라우저 주소를 확인하세요.';
    case 'conflict':
      return '서버가 요청 전체를 거부했습니다(409). 작업 판본을 다시 불러온 뒤 다시 시도하세요.';
    case 'invalid':
      return `서버가 입력을 거부했습니다.${failure.status === 0 ? '' : ` (HTTP ${failure.status})`}`;
    case 'not_found':
      return '대상을 찾을 수 없습니다. 삭제되었거나 아직 만들어지지 않았습니다.';
    case 'rate_limit':
      return '요청 한도에 걸렸습니다. 진행 중인 작업이 끝난 뒤 다시 시도하세요.';
    case 'network':
      return '서버에 연결할 수 없습니다.';
    case 'malformed':
      return '서버 응답 형식이 예상과 다릅니다. 화면을 새로 고친 뒤 다시 확인하세요.';
    default:
      return `요청을 처리하지 못했습니다.${failure.status === 0 ? '' : ` (HTTP ${failure.status})`}`;
  }
}

/** 서버 시각 문자열을 화면 문구로 만든다. 형식을 확인할 수 없으면 값을 추정하지 않는다. */
export function formatWorkflowTimestamp(value: string | null): string {
  if (value === null || value === '') return '표시 없음';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '표시 없음';
  return at.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
