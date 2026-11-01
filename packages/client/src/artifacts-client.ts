// 초안 작성/검토 job, DocAST 편집, 사람 의미 검토, 확정과 내보내기 다운로드의 HTTP 경계.
// 서버 workflow-http/workflow-routes/artifact-store가 정본이며, 응답 DTO를 여기서 엄격히 검증한다.
// 파일 bytes는 텍스트로만 돌려주고 HTML로 실행하는 경로를 만들지 않는다.
import { asInt, asString, isRecord, newIdempotencyKey } from './disclosure-contract.ts';

export type ArtifactFailureKind =
  | 'auth'
  | 'boundary'
  | 'conflict'
  | 'invalid'
  | 'not_found'
  | 'malformed'
  | 'network'
  | 'server';

export interface ArtifactFailure {
  kind: ArtifactFailureKind;
  status: number;
  code: string;
}

export type ArtifactResult<T> = { ok: true; value: T } | { ok: false; failure: ArtifactFailure };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ArtifactJobStatus = 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'stale';

export interface ArtifactJob {
  id: string;
  taskId: string;
  kind: string;
  inputRevision: number;
  status: ArtifactJobStatus;
  artifactId: string | null;
  errorCode: string | null;
}

export interface ArtifactFileMeta {
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
}

export interface DraftDocument {
  schema_version: 'draft.v1';
  blocks: Record<string, unknown>[];
}

export interface ReviewIssueView {
  targetKind: string;
  blockId: string | null;
  reasonCode: string;
  action: string | null;
  approvedFactIds: string[];
  candidateIds: string[];
  internalExplanation: string;
}

export interface ArtifactReviewView {
  result: 'pass' | 'needs_changes' | 'needs_decision' | 'error';
  issues: ReviewIssueView[];
}

export interface HumanReviewView {
  targetHash: string;
  fallbackReason: string;
}

export interface ArtifactView {
  id: string;
  taskId: string;
  revision: number;
  draft: DraftDocument;
  review: ArtifactReviewView | null;
  reviewErrorCode: string | null;
  documentHash: string;
  artifactSetHash: string;
  reviewTargetHash: string | null;
  files: ArtifactFileMeta[];
  hardErrors: string[];
  humanReview: HumanReviewView | null;
  isCurrent: boolean;
  finalizable: boolean;
}

export interface TaskAggregate {
  id: string;
  revision: number;
  phase: string;
  goalVariant: string | null;
  currentArtifactId: string | null;
  currentJobId: string | null;
}

export interface ExportInfo {
  id: string;
  taskId: string;
  revision: number;
  artifactId: string;
  artifactSetHash: string;
  archiveSha256: string;
}

export interface HumanReviewChecklist {
  reviewed_all_files: boolean;
  approved_facts_only: boolean;
  uncertainty_preserved: boolean;
}

export interface DownloadedBytes {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mediaType: string;
}

const JOB_STATUSES: Record<string, true> = {
  running: true,
  cancel_requested: true,
  succeeded: true,
  failed: true,
  cancelled: true,
  stale: true,
};

const REVIEW_RESULTS: Record<string, true> = {
  pass: true,
  needs_changes: true,
  needs_decision: true,
  error: true,
};

// 서버가 돌려준 고정 오류 코드에만 붙이는 안내. 없는 코드는 일반 문구로 처리한다.
const ADVICE: Record<string, string> = {
  NEEDS_DISCLOSURE_DECISION: '승인된 공개 사실이 없어 작성할 수 없습니다. 공개 결정을 먼저 저장하세요.',
  DECISION_INVALIDATED: '공개 결정이 바뀌거나 만료되어 이전 판본을 쓸 수 없습니다. 작업을 다시 불러오세요.',
  ARTIFACT_STALE: '초안이 현재 작업 판본과 맞지 않습니다. 작업을 다시 불러온 뒤 시도하세요.',
  ARTIFACT_HASH_CONFLICT: '검토 대상 해시가 현재 파일 집합과 다릅니다. 최신 초안을 다시 불러오세요.',
  ARTIFACT_CORRUPT: '서버가 보관한 파일 내용과 해시가 맞지 않아 이 초안으로는 진행할 수 없습니다.',
  DOCUMENT_HASH_CONFLICT: '편집 대상 문서가 이미 바뀌었습니다. 최신 초안을 다시 불러온 뒤 편집하세요.',
  HUMAN_REVIEW_REJECTED:
    '서버의 사람 검토 조건을 만족하지 않았습니다. 현재 파일, 모델 검토 실패 상태, 확인 항목, 사유를 확인하세요.',
  FINALIZATION_BLOCKED:
    '서버 확정 조건이 남아 있습니다. 미결정·보류·만료·철회된 공개 결정과 파일 검사 상태를 확인하세요. 체크로 우회할 수 없습니다.',
  FINALIZATION_REJECTED: '현재 파일 집합이나 작업 판본이 확정 요청과 다릅니다. 작업을 다시 불러오세요.',
  EXPORT_INVALIDATED: '작업 판본·결정·규칙이 바뀌어 이 확정 파일은 더 이상 내려받을 수 없습니다.',
  EXPORT_TOO_LARGE: '내보내기 크기 한도(20MiB)를 넘었습니다.',
  FILE_NOT_FOUND: '확정 파일 목록에 그 경로가 없습니다.',
  JOB_NOT_FOUND: '초안 작성·검토 기록을 찾을 수 없습니다. 초안을 다시 불러오세요.',
  JOB_LIMIT: '서버가 허용하는 동시 실행 수를 넘었습니다. 실행 중인 작업이 끝난 뒤 다시 시도하세요.',
  INVALID_DRAFT: '문서 구조가 허용 형식이 아닙니다. 블록의 type·text·items·fact_ids를 확인하세요.',
  MISSING_REQUIRED_FACT: '필수 승인 사실 참조가 빠졌습니다. 공개 결정에서 허용한 사실을 다시 넣으세요.',
  UNSUPPORTED_PUBLIC_SLOT: '이 서버 경로는 승인 발췌·공개 자산 슬롯 파일 생성을 지원하지 않습니다.',
  MODEL_TIMEOUT: '모델 호출이 시간 안에 끝나지 않았습니다.',
  MODEL_UNAVAILABLE: '모델을 사용할 수 없습니다.',
};

export function artifactFailureMessage(failure: ArtifactFailure): string {
  const advice = failure.code === '' ? '' : ADVICE[failure.code];
  const suffix = advice === undefined
    ? (failure.code === '' ? '' : ` (${failure.code})`)
    : ` ${advice}`;
  switch (failure.kind) {
    case 'auth':
      return '세션이 없거나 만료되었습니다. 세션을 다시 확인한 뒤 시도하세요.';
    case 'boundary':
      return '요청이 서버의 Host·Origin 검사에서 거부되었습니다. 브라우저 주소를 확인하세요.';
    case 'conflict':
      return `현재 판본·해시와 요청이 맞지 않습니다.${suffix}`;
    case 'invalid':
      return `서버가 요청을 거부했습니다.${suffix}`;
    case 'not_found':
      return `대상을 찾을 수 없습니다.${suffix}`;
    case 'malformed':
      return '응답 형식이 예상과 다릅니다. 작업 상태를 서버에서 다시 확인하세요.';
    case 'network':
      return '서버에 연결할 수 없습니다.';
    default:
      return `요청을 처리하지 못했습니다.${suffix}`;
  }
}

function failureKind(status: number): ArtifactFailureKind {
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

function malformed(status: number): { ok: false; failure: ArtifactFailure } {
  return { ok: false, failure: { kind: 'malformed', status, code: '' } };
}

type HttpOutcome =
  | { ok: true; body: unknown; status: number }
  | { ok: false; failure: ArtifactFailure };

async function requestJson(
  fetchFn: FetchFn,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  csrfToken: string | null,
  options: { payload?: unknown; idempotencyKey?: string } = {},
): Promise<HttpOutcome> {
  const writing = method !== 'GET';
  let response: Response;
  try {
    response = await fetchFn(path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(writing && csrfToken !== null ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(writing ? { 'Content-Type': 'application/json' } : {}),
        ...(options.idempotencyKey === undefined ? {} : { 'Idempotency-Key': options.idempotencyKey }),
      },
      credentials: 'same-origin',
      ...(options.payload === undefined ? {} : { body: JSON.stringify(options.payload) }),
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
    return malformed(response.status);
  }
}

function dataOf(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !isRecord(body.data)) return null;
  return body.data;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

export function parseDraftDocument(value: unknown): DraftDocument {
  if (!isRecord(value)) throw new Error('draft가 객체가 아닙니다.');
  if (value.schema_version !== 'draft.v1') throw new Error('draft.schema_version이 draft.v1이 아닙니다.');
  if (!Array.isArray(value.blocks)) throw new Error('draft.blocks가 배열이 아닙니다.');
  const blocks: Record<string, unknown>[] = [];
  for (const block of value.blocks) {
    if (!isRecord(block) || typeof block.type !== 'string' || block.type === '') {
      throw new Error('draft block에 type이 없습니다.');
    }
    blocks.push(block);
  }
  return { schema_version: 'draft.v1', blocks };
}



function parseReviewIssue(value: unknown): ReviewIssueView | null {
  if (!isRecord(value) || !isRecord(value.target)) return null;
  const targetKind = asString(value.target.kind);
  // 문서 전체를 가리키는 지적에는 서버가 block_id를 넣지 않는다.
  const blockId = value.target.block_id === undefined ? null : nullableString(value.target.block_id);
  const reasonCode = asString(value.reason_code);
  const action = nullableString(value.action);
  const approved = stringArray(value.approved_fact_ids);
  const candidates = stringArray(value.candidate_ids);
  const explanation = asString(value.internal_explanation);
  if (targetKind === null || blockId === undefined || reasonCode === null || action === undefined ||
    approved === null || candidates === null || explanation === null) return null;
  return { targetKind, blockId, reasonCode, action, approvedFactIds: approved, candidateIds: candidates, internalExplanation: explanation };
}

function parseReview(value: unknown): ArtifactReviewView | null {
  if (!isRecord(value)) return null;
  const result = asString(value.result);
  if (result === null || REVIEW_RESULTS[result] !== true) return null;
  if (!Array.isArray(value.issues)) return null;
  const issues: ReviewIssueView[] = [];
  for (const issue of value.issues) {
    const parsed = parseReviewIssue(issue);
    if (!parsed) return null;
    issues.push(parsed);
  }
  return { result: result as ArtifactReviewView['result'], issues };
}

function parseFiles(value: unknown): ArtifactFileMeta[] | null {
  if (!Array.isArray(value)) return null;
  const files: ArtifactFileMeta[] = [];
  for (const file of value) {
    if (!isRecord(file)) return null;
    const path = asString(file.path);
    const mediaType = asString(file.media_type);
    const size = asInt(file.size);
    const sha256 = asString(file.sha256);
    if (path === null || path === '' || mediaType === null || size === null || size < 0 || sha256 === null) return null;
    files.push({ path, mediaType, size, sha256 });
  }
  return files;
}

/** GET /api/v1/artifacts/{id} · GET /api/v1/tasks/{id}/bundle 공통 DTO. */
export function parseArtifact(body: unknown): ArtifactView {
  const data = dataOf(body);
  if (!data) throw new Error('초안 응답에 data 객체가 없습니다.');
  const id = asString(data.id);
  const taskId = asString(data.task_id);
  const revision = asInt(data.revision);
  const documentHash = asString(data.document_hash);
  const artifactSetHash = asString(data.artifact_set_hash);
  if (id === null || id === '' || taskId === null || taskId === '' || revision === null || revision < 1 ||
    documentHash === null || documentHash === '' || artifactSetHash === null) {
    throw new Error('초안 응답에 식별자·판본·hash가 온전하지 않습니다.');
  }
  const draft = parseDraftDocument(data.draft);
  const review = data.review === null ? null : parseReview(data.review);
  if (data.review !== null && review === null) throw new Error('초안 검토 기록 형식이 예상과 다릅니다.');
  const reviewErrorCode = nullableString(data.review_error_code);
  const reviewTargetHash = nullableString(data.review_target_hash);
  if (reviewErrorCode === undefined || reviewTargetHash === undefined) throw new Error('초안 검토 hash·오류 코드 형식이 다릅니다.');
  const files = parseFiles(data.files);
  if (files === null) throw new Error('초안 파일 목록 형식이 예상과 다릅니다.');
  const hardErrors = stringArray(data.hard_errors);
  if (hardErrors === null) throw new Error('초안 hard_errors가 문자열 배열이 아닙니다.');
  let humanReview: HumanReviewView | null = null;
  if (data.human_review !== null) {
    if (!isRecord(data.human_review)) throw new Error('사람 검토 기록 형식이 다릅니다.');
    const targetHash = asString(data.human_review.target_hash);
    const fallbackReason = asString(data.human_review.fallback_reason);
    if (targetHash === null || fallbackReason === null) throw new Error('사람 검토 기록 필드가 빠졌습니다.');
    humanReview = { targetHash, fallbackReason };
  }
  if (typeof data.is_current !== 'boolean' || typeof data.finalizable !== 'boolean') {
    throw new Error('초안 응답에 현재 여부·확정 가능 여부가 없습니다.');
  }
  return {
    id,
    taskId,
    revision,
    draft,
    review,
    reviewErrorCode,
    documentHash,
    artifactSetHash,
    reviewTargetHash,
    files,
    hardErrors,
    humanReview,
    isCurrent: data.is_current,
    finalizable: data.finalizable,
  };
}

/** GET /api/v1/tasks/{id} 응답에서 초안 영역이 쓰는 현재 판본 메타데이터만 읽는다. */
export function parseTaskAggregate(body: unknown): TaskAggregate {
  const data = dataOf(body);
  if (!data) throw new Error('작업 응답에 data 객체가 없습니다.');
  const id = asString(data.id);
  const revision = asInt(data.revision);
  const phase = asString(data.phase);
  const currentArtifactId = nullableString(data.current_artifact_id);
  const currentJobId = nullableString(data.current_job_id);
  if (id === null || id === '' || revision === null || revision < 1 || phase === null ||
    currentArtifactId === undefined || currentJobId === undefined) {
    throw new Error('작업 응답에 id·revision·phase가 온전하지 않습니다.');
  }
  let goalVariant: string | null = null;
  // intake로 만든 작업의 context에는 goal_variant 키가 아예 없다. 없는 키는 null로 읽고,
  // 키가 있는데 문자열/null이 아니면 형식 오류로 남긴다.
  if (isRecord(data.context) && Object.hasOwn(data.context, 'goal_variant')) {
    const goal = nullableString(data.context.goal_variant);
    if (goal === undefined) throw new Error('작업 context.goal_variant 형식이 다릅니다.');
    goalVariant = goal;
  }
  return { id, revision, phase, goalVariant, currentArtifactId, currentJobId };
}

export function parseArtifactJob(body: unknown): ArtifactJob {
  const data = dataOf(body);
  if (!data) throw new Error('job 응답에 data 객체가 없습니다.');
  const id = asString(data.id);
  const taskId = asString(data.task_id);
  const kind = asString(data.kind);
  const inputRevision = asInt(data.input_revision);
  const status = asString(data.status);
  const artifactId = nullableString(data.artifact_id);
  const errorCode = nullableString(data.error_code);
  if (id === null || id === '' || taskId === null || taskId === '' || kind === null || kind === '' ||
    inputRevision === null || inputRevision < 1 || status === null || JOB_STATUSES[status] !== true ||
    artifactId === undefined || errorCode === undefined) {
    throw new Error('job 응답 형식이 예상과 다릅니다.');
  }
  return { id, taskId, kind, inputRevision, status: status as ArtifactJobStatus, artifactId, errorCode };
}

export function parseExport(body: unknown): ExportInfo {
  const data = dataOf(body);
  if (!data) throw new Error('확정 응답에 data 객체가 없습니다.');
  const id = asString(data.id);
  const taskId = asString(data.task_id);
  const revision = asInt(data.revision);
  const artifactId = asString(data.artifact_id);
  const artifactSetHash = asString(data.artifact_set_hash);
  const archiveSha256 = asString(data.archive_sha256);
  if (id === null || id === '' || taskId === null || taskId === '' || revision === null || revision < 1 ||
    artifactId === null || artifactId === '' || artifactSetHash === null || archiveSha256 === null || archiveSha256 === '') {
    throw new Error('확정 응답에 식별자·판본·hash가 온전하지 않습니다.');
  }
  return { id, taskId, revision, artifactId, artifactSetHash, archiveSha256 };
}

export async function readTask(fetchFn: FetchFn, taskId: string): Promise<ArtifactResult<TaskAggregate>> {
  const response = await requestJson(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}`, null);
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseTaskAggregate(response.body) };
  } catch {
    return malformed(response.status);
  }
}

/** 현재 초안을 읽는다. 초안이 아직 없으면 null이며 오류가 아니다. */
export async function readCurrentArtifact(fetchFn: FetchFn, taskId: string): Promise<ArtifactResult<ArtifactView | null>> {
  const response = await requestJson(fetchFn, 'GET', `/api/v1/tasks/${encodeURIComponent(taskId)}/bundle`, null);
  if (!response.ok) {
    if (response.failure.kind === 'not_found') return { ok: true, value: null };
    return response;
  }
  try {
    return { ok: true, value: parseArtifact(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export type ArtifactJobArguments = { provisional?: boolean } | { artifact_id: string; expected_artifact_set_hash: string };

/** compose/review job을 시작한다. expected_revision은 현재 작업 판본이어야 한다. */
export async function startArtifactJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  kind: 'compose' | 'review',
  args: ArtifactJobArguments | null,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ArtifactJob>> {
  const response = await requestJson(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs`, csrfToken, {
    payload: {
      expected_revision: expectedRevision,
      kind,
      ...(args === null ? {} : { arguments: args }),
    },
    idempotencyKey,
  });
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifactJob(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function readArtifactJob(
  fetchFn: FetchFn,
  taskId: string,
  jobId: string,
): Promise<ArtifactResult<ArtifactJob>> {
  const response = await requestJson(
    fetchFn,
    'GET',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}`,
    null,
  );
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifactJob(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function cancelArtifactJob(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  jobId: string,
  expectedRevision: number,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<{ cancelRequested: boolean }>> {
  const response = await requestJson(
    fetchFn,
    'POST',
    `/api/v1/tasks/${encodeURIComponent(taskId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
    csrfToken,
    { payload: { expected_revision: expectedRevision }, idempotencyKey },
  );
  if (!response.ok) return response;
  const data = dataOf(response.body);
  if (!data || typeof data.cancel_requested !== 'boolean') return malformed(response.status);
  return { ok: true, value: { cancelRequested: data.cancel_requested } };
}


export async function recordHumanReview(
  fetchFn: FetchFn,
  csrfToken: string,
  artifactId: string,
  expectedRevision: number,
  targetHash: string,
  checklist: HumanReviewChecklist,
  fallbackReason: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ArtifactView>> {
  const response = await requestJson(
    fetchFn,
    'POST',
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/human-review`,
    csrfToken,
    {
      payload: { expected_revision: expectedRevision, target_hash: targetHash, checklist, fallback_reason: fallbackReason },
      idempotencyKey,
    },
  );
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseArtifact(response.body) };
  } catch {
    return malformed(response.status);
  }
}

export async function finalizeTask(
  fetchFn: FetchFn,
  csrfToken: string,
  taskId: string,
  expectedRevision: number,
  artifactId: string,
  expectedArtifactSetHash: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<ArtifactResult<ExportInfo>> {
  const response = await requestJson(fetchFn, 'POST', `/api/v1/tasks/${encodeURIComponent(taskId)}/finalize`, csrfToken, {
    payload: {
      expected_revision: expectedRevision,
      artifact_id: artifactId,
      expected_artifact_set_hash: expectedArtifactSetHash,
    },
    idempotencyKey,
  });
  if (!response.ok) return response;
  try {
    return { ok: true, value: parseExport(response.body) };
  } catch {
    return malformed(response.status);
  }
}

/** 내부 확인용 실제 파일 bytes. 확정 다운로드와 별개다. */
export async function readArtifactFile(
  fetchFn: FetchFn,
  artifactId: string,
  path: string,
): Promise<ArtifactResult<{ bytes: Uint8Array<ArrayBuffer>; mediaType: string }>> {
  let response: Response;
  try {
    response = await fetchFn(
      `/api/v1/artifacts/${encodeURIComponent(artifactId)}/files/${encodeURIComponent(path)}`,
      { method: 'GET', headers: { Accept: '*/*' }, credentials: 'same-origin' },
    );
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ok: true, value: { bytes, mediaType: response.headers.get('content-type') ?? 'application/octet-stream' } };
  } catch {
    return malformed(response.status);
  }
}

function basename(value: string): string {
  const cleaned = value.replaceAll('\\', '/').split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
  return cleaned.at(-1) ?? '';
}

function filenameFrom(disposition: string | null, fallback: string): string {
  if (disposition !== null) {
    const quoted = /filename="([^"]+)"/.exec(disposition);
    const plain = quoted === null ? /filename=([^;]+)/.exec(disposition) : null;
    const candidate = basename(quoted?.[1] ?? plain?.[1] ?? '');
    if (candidate !== '') return candidate;
  }
  return basename(fallback) === '' ? 'safehandoff-download' : basename(fallback);
}

/** 확정된 동일 bytes만 내려받는다. 아카이브(path=null)와 개별 파일 모두 서버 재검사를 거친다. */
export async function readExportBytes(
  fetchFn: FetchFn,
  exportId: string,
  path: string | null,
): Promise<ArtifactResult<DownloadedBytes>> {
  const url = path === null
    ? `/api/v1/exports/${encodeURIComponent(exportId)}/archive`
    : `/api/v1/exports/${encodeURIComponent(exportId)}/files/${encodeURIComponent(path)}`;
  let response: Response;
  try {
    response = await fetchFn(url, { method: 'GET', headers: { Accept: '*/*' }, credentials: 'same-origin' });
  } catch {
    return { ok: false, failure: { kind: 'network', status: 0, code: '' } };
  }
  if (!response.ok) {
    return { ok: false, failure: { kind: failureKind(response.status), status: response.status, code: await readErrorCode(response) } };
  }
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      value: {
        bytes,
        filename: filenameFrom(response.headers.get('content-disposition'), path ?? 'safehandoff.zip'),
        mediaType: response.headers.get('content-type') ?? 'application/octet-stream',
      },
    };
  } catch {
    return malformed(response.status);
  }
}

/** 브라우저 저장 동작. DOM이 없는 환경에서는 false를 돌려주고 성공을 가장하지 않는다. */
export function saveDownload(file: DownloadedBytes): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([file.bytes], { type: file.mediaType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 클릭 뒤 즉시 해제하면 일부 브라우저가 저장을 시작하지 못하므로 다음 작업으로 미룬다.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return true;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
