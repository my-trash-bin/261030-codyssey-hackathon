// 작업 생성과 원자료 등록. 인증된 세션의 CSRF 토큰이 있어야 하며, 응답의 revision을
// 다음 요청에 그대로 넘겨 서버 판본 검사를 통과시킨다. docs/api.md의 인증된 task API를 따른다.
import { isRecord, newIdempotencyKey } from './disclosure-contract.ts';
import type { WireSource } from './analysis-state.ts';

export interface TaskState {
  id: string;
  revision: number;
}

export type TaskFailureKind =
  | 'auth'
  | 'boundary'
  | 'conflict'
  | 'invalid'
  | 'not_found'
  | 'malformed'
  | 'network'
  | 'server';

export interface TaskFailure {
  kind: TaskFailureKind;
  status: number;
  code: string;
}

export type TaskResult = { ok: true; value: TaskState } | { ok: false; failure: TaskFailure };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function failureKind(status: number): TaskFailureKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'boundary';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413 || status === 422) return 'invalid';
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

function parseTask(body: unknown): TaskState | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const id = body.data.id;
  const revision = body.data.revision;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
  return { id, revision };
}

async function send(
  fetchFn: FetchFn,
  method: 'POST' | 'PUT',
  path: string,
  csrfToken: string,
  payload: unknown,
): Promise<TaskResult> {
  let response: Response;
  try {
    response = await fetchFn(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': newIdempotencyKey(),
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  const value = parseTask(body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 목적·수신처로 작업을 만든다. 응답의 revision은 원자료 등록에 그대로 쓴다. */
export function createTask(
  fetchFn: FetchFn,
  csrfToken: string,
  context: { purpose: string; recipient: string },
): Promise<TaskResult> {
  return send(fetchFn, 'POST', '/api/v1/tasks', csrfToken, { context });
}

/** 원자료 판본을 등록한다. 응답 revision은 한 번 증가한 값이다. */
export function replaceSources(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  sources: readonly WireSource[],
): Promise<TaskResult> {
  return send(fetchFn, 'PUT', `/api/v1/tasks/${encodeURIComponent(taskId)}/sources`, csrfToken, {
    expected_revision: expectedRevision,
    sources,
  });
}

export type AnalysisJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale';

export interface AnalysisJobState {
  id: string;
  revision: number;
  status: AnalysisJobStatus;
  errorCode: string | null;
}

export type JobResult = { ok: true; value: AnalysisJobState } | { ok: false; failure: TaskFailure };

const JOB_STATUSES: Record<string, true> = { running: true, succeeded: true, failed: true, cancelled: true, stale: true };

function parseJob(body: unknown): AnalysisJobState | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  const data = body.data;
  const id = data.id;
  const revision = data.revision;
  const status = data.status;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null;
  if (typeof status !== 'string' || JOB_STATUSES[status] !== true) return null;
  const errorCode = data.error_code;
  if (errorCode !== null && typeof errorCode !== 'string') return null;
  return { id, revision, status: status as AnalysisJobStatus, errorCode };
}

async function sendJson(
  fetchFn: FetchFn,
  method: 'POST' | 'GET',
  path: string,
  csrfToken: string,
  payload?: unknown,
): Promise<{ ok: true; body: unknown; status: number } | { ok: false; failure: TaskFailure }> {
  let response: Response;
  try {
    response = await fetchFn(path, {
      method,
      headers: {
        Accept: 'application/json',
        'X-CSRF-Token': csrfToken,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(payload === undefined ? {} : { 'Idempotency-Key': newIdempotencyKey() }),
      },
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  try {
    return { ok: true, body: await response.json(), status: response.status };
  } catch {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
}

/** 분석 job을 시작한다. 서버는 202와 함께 실행 중인 job 요약을 돌려준다. */
export async function startAnalysis(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
): Promise<JobResult> {
  const response = await sendJson(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs`, csrfToken, {
    expected_revision: expectedRevision,
    kind: 'analyze',
  });
  if (!response.ok) return response;
  const value = parseJob(response.body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 분석 job의 현재 상태를 읽는다. snapshot은 서버가 내려주지 않는다. */
export async function readAnalysisJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
): Promise<JobResult> {
  const response = await sendJson(
    fetchFn,
    'GET',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}`,
    csrfToken,
  );
  if (!response.ok) return response;
  const value = parseJob(response.body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 실행 중인 분석 job을 취소한다. */
export async function cancelAnalysis(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
  expectedRevision: number,
): Promise<{ ok: true; value: { cancelled: boolean } } | { ok: false; failure: TaskFailure }> {
  const response = await sendJson(
    fetchFn,
    'POST',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    csrfToken,
    { expected_revision: expectedRevision },
  );
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body) || !isRecord(body.data) || typeof body.data.cancelled !== 'boolean') {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  return { ok: true, value: { cancelled: body.data.cancelled } };
}

/** 화면에 표시할 사유. 토큰 값이나 서버 내부 정보를 담지 않는다. */
export function taskFailureMessage(failure: TaskFailure): string {
  switch (failure.kind) {
    case 'auth':
      return '세션이 없거나 만료되었습니다. 로컬 접속에서 토큰을 다시 입력하세요.';
    case 'boundary':
      return '요청이 서버의 Host·Origin 검사에서 거부되었습니다. 브라우저 주소를 확인하세요.';
    case 'conflict':
      return '작업 판본이 이미 바뀌었습니다. 최신 작업을 다시 불러온 뒤 시도하세요.';
    case 'invalid':
      return `서버가 입력을 거부했습니다.${failure.code === '' ? '' : ` (${failure.code})`} 목적·수신처와 원자료를 확인하세요.`;
    case 'not_found':
      return '작업을 찾을 수 없습니다. 삭제되었는지 확인하세요.';
    case 'malformed':
      return '응답 형식이 예상과 다릅니다. 작업 상태를 서버에서 다시 확인하세요.';
    case 'network':
      return '서버에 연결할 수 없습니다.';
    default:
      return `요청을 처리하지 못했습니다.${failure.code === '' ? '' : ` (${failure.code})`}`;
  }
}
