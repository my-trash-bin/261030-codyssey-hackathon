// 작업 카탈로그 조회, 작업 생성, 원자료 등록·삭제, 수동 후보, 분석 job.
// 인증된 세션의 CSRF 토큰이 있어야 하며, 응답의 revision을 다음 요청에 그대로 넘겨
// 서버 판본 검사를 통과시킨다. 실제 서버 경로(workflow-http/workflow-routes)를 따른다.
import { isRecord, newIdempotencyKey } from './disclosure-contract.ts';
import type { WireSource } from './analysis-state.ts';

export interface TaskState {
  id: string;
  revision: number;
}

/** 서버가 내려주는 작업 진행 정보. 목록·상세 응답에 없으면 null로 둔다. */
export interface TaskMeta extends TaskState {
  phase: string | null;
  currentJobId: string | null;
  cancellationRequested: boolean;
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
export type TaskMetaResult = { ok: true; value: TaskMeta } | { ok: false; failure: TaskFailure };

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

function parseTaskMeta(body: unknown): TaskMeta | null {
  const task = parseTask(body);
  if (!task || !isRecord(body) || !isRecord(body.data)) return null;
  const data = body.data;
  return {
    ...task,
    phase: typeof data.phase === 'string' ? data.phase : null,
    currentJobId: typeof data.current_job_id === 'string' && data.current_job_id !== '' ? data.current_job_id : null,
    cancellationRequested: data.cancellation_requested === true,
  };
}

async function send(
  fetchFn: FetchFn,
  method: 'POST' | 'PUT' | 'GET' | 'DELETE',
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

async function sendTask(
  fetchFn: FetchFn,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  csrfToken: string,
  payload: unknown,
): Promise<TaskResult> {
  const response = await send(fetchFn, method, path, csrfToken, payload);
  if (!response.ok) return response;
  const value = parseTask(response.body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 카탈로그 선택지. 서버가 빈 배열을 주면 운영 설정이 없어 선택할 수 없는 상태다. */
export interface CatalogOption {
  id: string;
  displayName: string;
}

export interface CatalogLimits {
  sources: number;
  sourceBytes: number;
  sourceTotalBytes: number;
}

export interface WorkflowCatalog {
  projects: CatalogOption[];
  recipients: CatalogOption[];
  purposes: CatalogOption[];
  goals: string[];
  templates: CatalogOption[];
  limits: CatalogLimits | null;
}

export type CatalogResult = { ok: true; value: WorkflowCatalog } | { ok: false; failure: TaskFailure };

function parseOption(value: unknown): CatalogOption | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const displayName = value.display_name;
  if (typeof id !== 'string' || id === '' || typeof displayName !== 'string' || displayName === '') return null;
  return { id, displayName };
}

function parseOptionList(value: unknown): CatalogOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: CatalogOption[] = [];
  for (const item of value) {
    const option = parseOption(item);
    if (!option) return null;
    options.push(option);
  }
  return options;
}

function parseLimits(value: unknown): CatalogLimits | null {
  if (!isRecord(value)) return null;
  const { sources, source_bytes: sourceBytes, source_total_bytes: sourceTotalBytes } = value;
  if (typeof sources !== 'number' || typeof sourceBytes !== 'number' || typeof sourceTotalBytes !== 'number') return null;
  return { sources, sourceBytes, sourceTotalBytes };
}

/** 화면이 실제 서버 카탈로그로 폼 선택지를 만든다. 카탈로그에 없는 값을 기본값으로 채우지 않는다. */
export async function readCatalog(fetchFn: FetchFn, csrfToken: string): Promise<CatalogResult> {
  const response = await send(fetchFn, 'GET', '/api/v1/catalog', csrfToken);
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body) || !isRecord(body.data)) {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  const data = body.data;
  const projects = parseOptionList(data.projects);
  const recipients = parseOptionList(data.recipients);
  const purposes = parseOptionList(data.purposes);
  const templates = parseOptionList(data.templates);
  const goals = Array.isArray(data.goals) && data.goals.every((goal) => typeof goal === 'string') ? data.goals as string[] : null;
  if (!projects || !recipients || !purposes || !templates || !goals) {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  return { ok: true, value: { projects, recipients, purposes, goals, templates, limits: parseLimits(data.limits) } };
}

export type Audience = 'public' | 'named_external';
export type OutputLanguage = 'ko' | 'en';

/** 서버 intakeContext가 허용하는 필드만 담는다. 양식(template)은 intake 필드가 아니다. */
export interface TaskIntake {
  internal_title: string;
  project_id: string;
  purpose_id: string;
  recipient_id: string;
  audience: Audience;
  skill_ids: string[];
  goal_variant?: string;
  output_language?: OutputLanguage;
}

/** 서버 intake로 작업을 만든다. 응답의 revision은 원자료 등록에 그대로 쓴다. */
export function createTask(
  fetchFn: FetchFn,
  csrfToken: string,
  intake: TaskIntake,
): Promise<TaskResult> {
  return sendTask(fetchFn, 'POST', '/api/v1/tasks', csrfToken, { intake });
}

/** 카탈로그를 쓸 수 없을 때의 기존 목적·수신처 방식. 서버는 이 작업에 intake·규칙 범위를 저장하지 않는다. */
export function createContextTask(
  fetchFn: FetchFn,
  csrfToken: string,
  context: { purpose: string; recipient: string },
): Promise<TaskResult> {
  return sendTask(fetchFn, 'POST', '/api/v1/tasks', csrfToken, { context });
}

/** 작업 상세를 읽어 phase·진행 job·취소 요청 여부를 화면 판본과 맞춘다. */
export async function readTask(fetchFn: FetchFn, csrfToken: string, taskId: string): Promise<TaskMetaResult> {
  const response = await send(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`, csrfToken);
  if (!response.ok) return response;
  const value = parseTaskMeta(response.body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 원자료 판본을 등록한다. 응답 revision은 한 번 증가한 값이다. */
export function replaceSources(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  sources: readonly WireSource[],
): Promise<TaskResult> {
  return sendTask(fetchFn, 'PUT', `/api/v1/tasks/${encodeURIComponent(taskId)}/sources`, csrfToken, {
    expected_revision: expectedRevision,
    sources,
  });
}

export interface TaskSourceInfo {
  id: string;
  sourceId: string;
  version: number;
  displayName: string;
  format: string;
  sourceSlot: string;
  included: boolean;
  byteSize: number | null;
}

export type TaskSourcesResult = { ok: true; value: TaskSourceInfo[] } | { ok: false; failure: TaskFailure };

function parseSourceInfo(value: unknown): TaskSourceInfo | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const sourceId = value.source_id;
  const version = value.version;
  const displayName = value.display_name;
  const format = value.format;
  const sourceSlot = value.source_slot;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof sourceId !== 'string' || sourceId === '') return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (typeof displayName !== 'string' || displayName === '') return null;
  if (typeof format !== 'string' || format === '') return null;
  if (typeof sourceSlot !== 'string' || sourceSlot === '') return null;
  if (typeof value.included !== 'boolean') return null;
  return {
    id,
    sourceId,
    version,
    displayName,
    format,
    sourceSlot,
    included: value.included,
    byteSize: typeof value.byte_size === 'number' ? value.byte_size : null,
  };
}

/** 등록된 원자료 메타데이터를 읽는다. 서버가 raw_bytes를 돌려주지 않으므로 이 응답만으로 재등록할 수 없다. */
export async function readTaskSources(fetchFn: FetchFn, csrfToken: string, taskId: string): Promise<TaskSourcesResult> {
  const response = await send(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}/sources`, csrfToken);
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.sources)) {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  const sources: TaskSourceInfo[] = [];
  for (const item of body.data.sources) {
    const source = parseSourceInfo(item);
    if (!source) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
    sources.push(source);
  }
  return { ok: true, value: sources };
}

/** 선택한 원자료 하나를 해제한다. 서버는 논리 source_id로 찾는다. */
export function deleteSource(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  sourceId: string,
  expectedRevision: number,
): Promise<TaskResult> {
  return sendTask(
    fetchFn,
    'DELETE',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/sources/${encodeURIComponent(sourceId)}`,
    csrfToken,
    { expected_revision: expectedRevision },
  );
}

export const CANDIDATE_KINDS = ['observation', 'constraint', 'hypothesis', 'unknown', 'identifier'] as const;
export const CANDIDATE_UNCERTAINTIES = ['observed', 'reported', 'inferred', 'unknown'] as const;
export const CANDIDATE_RELEVANCES = ['required', 'optional'] as const;

export type CandidateKind = typeof CANDIDATE_KINDS[number];
export type CandidateUncertainty = typeof CANDIDATE_UNCERTAINTIES[number];
export type CandidateRelevance = typeof CANDIDATE_RELEVANCES[number];

export interface ManualCandidateInput {
  candidate: {
    kind: CandidateKind;
    uncertainty: CandidateUncertainty;
    statement: string;
    relevance: CandidateRelevance;
    purpose_relevance: string;
  };
  evidence_ids?: string[];
  user_note?: string;
}

/** 수동 후보를 추가한다. 서버는 evidence_ids와 user_note 중 정확히 하나만 받는다. */
export function addManualCandidate(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  input: ManualCandidateInput,
): Promise<TaskResult> {
  return sendTask(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/manual-candidates`, csrfToken, {
    expected_revision: expectedRevision,
    ...input,
  });
}

export type AnalysisJobStatus = 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'stale';

export interface AnalysisJobState {
  id: string;
  revision: number;
  status: AnalysisJobStatus;
  errorCode: string | null;
}

export type JobResult = { ok: true; value: AnalysisJobState } | { ok: false; failure: TaskFailure };

const JOB_STATUSES: Record<string, true> = {
  running: true,
  cancel_requested: true,
  succeeded: true,
  failed: true,
  cancelled: true,
  stale: true,
};

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

/** 분석 job을 시작한다. 서버는 202와 함께 실행 중인 job 요약을 돌려준다. */
export async function startAnalysis(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
): Promise<JobResult> {
  const response = await send(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs`, csrfToken, {
    expected_revision: expectedRevision,
    kind: 'analyze',
  });
  if (!response.ok) return response;
  const value = parseJob(response.body);
  if (!value) return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  return { ok: true, value };
}

/** 분석 job의 현재 상태를 읽는다. cancel_requested는 진행 중 상태로 취급한다. */
export async function readAnalysisJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
): Promise<JobResult> {
  const response = await send(
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

/** 실행 중인 분석 job에 취소를 요청한다. 서버는 실제 중단 전에도 요청 접수 여부를 돌려준다. */
export async function cancelAnalysis(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
  expectedRevision: number,
): Promise<{ ok: true; value: { requested: boolean } } | { ok: false; failure: TaskFailure }> {
  const response = await send(
    fetchFn,
    'POST',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    csrfToken,
    { expected_revision: expectedRevision },
  );
  if (!response.ok) return response;
  const body = response.body;
  if (!isRecord(body) || !isRecord(body.data)) {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  const requested = body.data.cancel_requested ?? body.data.cancelled;
  if (typeof requested !== 'boolean') {
    return { ok: false, failure: { kind: 'malformed', status: response.status, code: '' } };
  }
  return { ok: true, value: { requested } };
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
      return `서버가 입력을 거부했습니다.${failure.code === '' ? '' : ` (${failure.code})`} 카탈로그 선택과 원자료를 확인하세요.`;
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
