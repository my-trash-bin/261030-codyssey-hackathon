// 공개 결정 HTTP DTO 검증과 직렬화. Node API 없이 브라우저에서도 사용한다.
export type Mode = 'A' | 'B' | 'C' | 'D';
export type Disposition = 'allow' | 'exclude' | 'defer';
export type Interpretation = 'uninterpreted' | 'supported' | 'ambiguous' | 'unsupported';

export interface Representation {
  kind: 'fact_summary' | 'derived_table' | 'selected_fields' | 'exact_value' | 'approved_excerpt';
  transform_id?: string;
  parameters?: Record<string, number | string[]>;
}

export interface Candidate {
  id: string;
  kind: string;
  statement: string;
  uncertainty: string;
  evidence_ids: string[] | null;
  required: boolean;
  conflict_group?: string;
  conflict_reason?: string;
  [key: string]: unknown;
}

export interface Projection {
  statement: string;
  columns: string[] | null;
  rows: string[][] | null;
  excerpt?: string;
}

export interface Preview {
  preview_id: string;
  candidate_id: string;
  input_revision: number;
  representation: Representation;
  projection: Projection;
  projection_sha256: string;
}

export interface SavedDecision {
  id: string;
  candidate_id: string;
  disposition: Disposition;
  representation: Representation;
  revoked: boolean;
  expires_at: string | null;
  supersedes_id?: string;
  projection_sha256: string;
}

export interface EvidenceLocator {
  kind: string;
  column?: string;
  pointer?: string;
  row?: number;
  value_sha256?: string;
}

export interface Evidence {
  id: string;
  source_version_id: string;
  start: number;
  end: number;
  locator: EvidenceLocator;
  evidence_sha256?: string;
}

export interface Source {
  id: string;
  source_id: string;
  version: number;
  display_name: string;
  format: string;
  source_slot: string;
  included: boolean;
  raw_bytes?: string;
  sha256?: string;
}

export interface Scope {
  project_id: string;
  purpose_id: string;
  recipient_id: string;
  audience: string;
  skill_set_hash: string;
}

// task 집계의 context·intake는 서버가 정본이다. 화면은 표시만 하고 값을 만들지 않는다.
export interface TaskContext {
  purpose: string;
  recipient: string;
  goal_variant?: string;
  output_language?: string;
}

export interface TaskIntake {
  internal_title: string;
  project_id: string;
  purpose_id: string;
  recipient_id: string;
  audience: string;
  skill_ids: string[];
}

// GET /tasks/{id}/candidates/{candidate_id}/fields 응답. fields는 서버가 정렬한 필드 이름 목록이며
// 빈 JSON pointer("")도 하나의 필드 이름으로 남는다. 선택 필드 표현은 재사용 저장을 지원하지 않는다.
export interface FieldList {
  candidateId: string;
  inputRevision: number;
  sourceVersionId: string;
  fields: string[];
  reusable: false;
}

export interface Snapshot {
  id: string;
  revision: number;
  // 아래 값은 실제 task 집계 응답에 실리는 메타데이터다. 기존 fixtures 호환을 위해 전부 optional로 둔다.
  phase?: string;
  context?: TaskContext;
  intake?: TaskIntake;
  current_job_id?: string | null;
  current_artifact_id?: string | null;
  cancellation_requested?: boolean;
  candidates: Candidate[];
  evidence: Evidence[];
  sources: Source[];
  decisions: Record<string, SavedDecision>;
  scope: Scope;
}

export interface Draft {
  disposition: Disposition | null;
  mode: Mode | null;
  condition: string;
  reusable: boolean;
  preview: Preview | null;
  interpretation: Interpretation;
  jobId: string | null;
  jobStatus: string | null;
  representation: Representation | null;
  // C(선택 필드)의 체크박스 상태. 필드 이름을 그대로 key로 두어 빈 JSON pointer("")도 잃지 않는다.
  selection: ReadonlyMap<string, boolean>;
  message: string;
}

export interface BatchRetry {
  taskId: string;
  body: string;
  key: string;
}

export interface Proposal {
  status: 'supported' | 'ambiguous' | 'unsupported';
  candidate_id: string;
  representation: Representation | null;
  requires_clarification: boolean;
}

export interface Job {
  id: string;
  kind: string;
  status: string;
  input_revision: number;
  result: Proposal | null;
}

export const REPRESENTATION_KINDS: Record<string, true> = {
  fact_summary: true,
  derived_table: true,
  selected_fields: true,
  exact_value: true,
  approved_excerpt: true,
};

// cancel_requested는 서버가 취소를 접수하고 작업이 아직 정리 중인 진행 상태다.
export const JOB_STATUSES: Record<string, true> = {
  queued: true,
  running: true,
  cancel_requested: true,
  succeeded: true,
  failed: true,
  cancelled: true,
  stale: true,
};

// 재사용 저장이 강제 금지인 표현 종류.
export const REUSABLE_FORBIDDEN: Record<string, true> = {
  exact_value: true,
  approved_excerpt: true,
  selected_fields: true,
};

// C(선택 필드) 표현은 이 변환 id와 parameters.fields만 서버가 받는다(core validateRepresentation).
export const SELECTED_FIELDS_TRANSFORM = 'select_fields.v1';

export const KNOWN_CANDIDATE_KEYS: Record<string, true> = {
  id: true,
  kind: true,
  statement: true,
  uncertainty: true,
  evidence_ids: true,
  required: true,
  conflict_group: true,
  conflict_reason: true,
};

type RepresentationKind = Representation['kind'];

export function isRepresentationKind(value: string): value is RepresentationKind {
  return REPRESENTATION_KINDS[value] === true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

export function parseRepresentation(value: unknown): Representation {
  if (!isRecord(value)) throw new Error('representation이 객체가 아닙니다.');
  const kind = asNonEmptyString(value.kind);
  if (kind === null || !isRepresentationKind(kind)) {
    throw new Error('representation.kind가 계약에 없습니다.');
  }
  const out: Representation = { kind };
  if (value.transform_id !== undefined) {
    if (typeof value.transform_id !== 'string') throw new Error('transform_id가 문자열이 아닙니다.');
    out.transform_id = value.transform_id;
  }
  if (value.parameters !== undefined) {
    if (!isRecord(value.parameters)) throw new Error('parameters가 객체가 아닙니다.');
    const parameters: Record<string, number | string[]> = {};
    for (const [key, entry] of Object.entries(value.parameters)) {
      if (key === 'fields' && Array.isArray(entry) && entry.length > 0 && entry.length <= 100 &&
        entry.every(field => typeof field === 'string') && new Set(entry).size === entry.length) {
        parameters[key] = entry;
      } else if (typeof entry === 'number' && Number.isFinite(entry)) parameters[key] = entry;
      else throw new Error('parameters는 유한한 수 또는 중복 없는 fields 문자열 배열이어야 합니다.');
    }
    out.parameters = parameters;
  }
  return out;
}

export function representationSignature(rep: Representation | null | undefined): string {
  if (!rep) return '';
  const parameters = rep.parameters ?? {};
  const keys = Object.keys(parameters).sort();
  return `${rep.kind}|${rep.transform_id ?? ''}|${keys.map((key) => `${key}=${JSON.stringify(parameters[key])}`).join(',')}`;
}

export function toWireRepresentation(rep: Representation): Record<string, unknown> {
  return { kind: rep.kind, transform_id: rep.transform_id ?? '', parameters: rep.parameters ?? {} };
}

export function parseProjection(value: unknown): Projection {
  if (!isRecord(value)) throw new Error('projection이 객체가 아닙니다.');
  const statement = asString(value.statement);
  if (statement === null) throw new Error('projection.statement가 없습니다.');
  const columns = value.columns === null ? null : asStringArray(value.columns);
  if (columns === null && value.columns !== null) throw new Error('projection.columns가 문자열 배열이 아닙니다.');
  let rows: string[][] | null = null;
  if (value.rows !== null) {
    if (!Array.isArray(value.rows)) throw new Error('projection.rows가 배열이 아닙니다.');
    const parsed: string[][] = [];
    for (const row of value.rows) {
      const line = asStringArray(row);
      if (line === null) throw new Error('projection.rows 안이 문자열 배열이 아닙니다.');
      parsed.push(line);
    }
    rows = parsed;
  }
  const out: Projection = { statement, columns, rows };
  if (value.excerpt !== undefined) {
    if (typeof value.excerpt !== 'string') throw new Error('projection.excerpt가 문자열이 아닙니다.');
    out.excerpt = value.excerpt;
  }
  return out;
}

export function parsePreview(body: unknown): Preview {
  if (!isRecord(body) || !isRecord(body.data)) throw new Error('미리보기 응답에 data 객체가 없습니다.');
  const data = body.data;
  const preview_id = asNonEmptyString(data.preview_id);
  const candidate_id = asNonEmptyString(data.candidate_id);
  const input_revision = asInt(data.input_revision);
  const projection_sha256 = asNonEmptyString(data.projection_sha256);
  if (preview_id === null || candidate_id === null || input_revision === null || projection_sha256 === null) {
    throw new Error('미리보기 응답에 식별자·후보·revision·해시가 없습니다.');
  }
  return {
    preview_id,
    candidate_id,
    input_revision,
    representation: parseRepresentation(data.representation),
    projection: parseProjection(data.projection),
    projection_sha256,
  };
}

export function parseCandidate(value: unknown): Candidate {
  if (!isRecord(value)) throw new Error('candidate가 객체가 아닙니다.');
  const id = asNonEmptyString(value.id);
  const kind = asNonEmptyString(value.kind);
  const statement = asString(value.statement);
  const uncertainty = asNonEmptyString(value.uncertainty);
  if (id === null || kind === null || statement === null || uncertainty === null) {
    throw new Error('candidate에 id·kind·statement·uncertainty가 없습니다.');
  }
  const evidence_ids = value.evidence_ids === null ? null : asStringArray(value.evidence_ids);
  if (evidence_ids === null && value.evidence_ids !== null) {
    throw new Error('candidate.evidence_ids가 문자열 배열이 아닙니다.');
  }
  if (typeof value.required !== 'boolean') throw new Error('candidate.required가 불리언이 아닙니다.');
  const out: Candidate = { id, kind, statement, uncertainty, evidence_ids, required: value.required };
  for (const [key, entry] of Object.entries(value)) {
    if (KNOWN_CANDIDATE_KEYS[key] !== true) out[key] = entry;
  }
  if (typeof value.conflict_group === 'string' && value.conflict_group !== '') {
    out.conflict_group = value.conflict_group;
  }
  if (typeof value.conflict_reason === 'string' && value.conflict_reason !== '') {
    out.conflict_reason = value.conflict_reason;
  }
  return out;
}

export function parseSavedDecision(value: unknown): SavedDecision {
  if (!isRecord(value)) throw new Error('decision이 객체가 아닙니다.');
  const id = asNonEmptyString(value.id);
  const candidate_id = asNonEmptyString(value.candidate_id);
  const disposition = asNonEmptyString(value.disposition);
  if (id === null || candidate_id === null) {
    throw new Error('decision에 id·candidate_id가 없습니다.');
  }
  if (disposition !== 'allow' && disposition !== 'exclude' && disposition !== 'defer') {
    throw new Error('decision.disposition이 계약에 없습니다.');
  }
  // exclude/defer는 투영·미리보기를 만들지 않아 빈 해시가 계약상 유효하다.
  // allow만 적용 시 해시 대조에 쓰이므로 비어 있으면 거부한다.
  let projection_sha256: string;
  if (value.projection_sha256 === undefined && disposition !== 'allow') {
    projection_sha256 = '';
  } else {
    const hash = asNonEmptyString(value.projection_sha256);
    if (hash === null) {
      if (disposition === 'allow') throw new Error('allow decision에 projection_sha256이 없습니다.');
      projection_sha256 = '';
    } else {
      projection_sha256 = hash;
    }
  }
  if (typeof value.revoked !== 'boolean') throw new Error('decision.revoked가 불리언이 아닙니다.');
  if (typeof value.expires_at !== 'string' && value.expires_at !== null) {
    throw new Error('decision.expires_at이 문자열이 아닙니다.');
  }
  const out: SavedDecision = {
    id,
    candidate_id,
    disposition,
    representation: parseRepresentation(value.representation),
    revoked: value.revoked,
    expires_at: value.expires_at,
    projection_sha256,
  };
  if (typeof value.supersedes_id === 'string') out.supersedes_id = value.supersedes_id;
  return out;
}

export function parseEvidence(value: unknown): Evidence {
  if (!isRecord(value)) throw new Error('evidence가 객체가 아닙니다.');
  const id = asNonEmptyString(value.id);
  const source_version_id = asString(value.source_version_id);
  const start = asInt(value.start);
  const end = asInt(value.end);
  if (id === null || source_version_id === null || start === null || end === null) {
    throw new Error('evidence에 id·source_version_id·start·end가 없습니다.');
  }
  if (!isRecord(value.locator)) throw new Error('evidence.locator가 객체가 아닙니다.');
  const locatorKind = asNonEmptyString(value.locator.kind);
  if (locatorKind === null) throw new Error('evidence.locator.kind가 없습니다.');
  const locator: EvidenceLocator = { kind: locatorKind };
  if (typeof value.locator.column === 'string') locator.column = value.locator.column;
  if (typeof value.locator.pointer === 'string') locator.pointer = value.locator.pointer;
  if (typeof value.locator.value_sha256 === 'string') locator.value_sha256 = value.locator.value_sha256;
  const row = asInt(value.locator.row);
  if (value.locator.row !== undefined) {
    if (row === null) throw new Error('evidence.locator.row가 정수가 아닙니다.');
    locator.row = row;
  }
  const out: Evidence = { id, source_version_id, start, end, locator };
  if (typeof value.evidence_sha256 === 'string') out.evidence_sha256 = value.evidence_sha256;
  return out;
}

export function parseSource(value: unknown): Source {
  if (!isRecord(value)) throw new Error('source가 객체가 아닙니다.');
  const id = asNonEmptyString(value.id);
  const source_id = asString(value.source_id);
  const display_name = asString(value.display_name);
  const source_slot = asString(value.source_slot);
  const format = asString(value.format);
  const version = asInt(value.version);
  if (id === null || source_id === null || display_name === null || source_slot === null || format === null || version === null) {
    throw new Error('source에 id·source_id·display_name·source_slot·format·version이 없습니다.');
  }
  if (typeof value.included !== 'boolean') throw new Error('source.included가 불리언이 아닙니다.');
  const out: Source = {
    id,
    source_id,
    version,
    display_name,
    format,
    source_slot,
    included: value.included,
  };
  if (typeof value.raw_bytes === 'string') out.raw_bytes = value.raw_bytes;
  if (typeof value.sha256 === 'string') out.sha256 = value.sha256;
  return out;
}

export function parseScope(value: unknown): Scope {
  if (!isRecord(value)) throw new Error('scope 객체가 없습니다.');
  const project_id = asString(value.project_id);
  const purpose_id = asString(value.purpose_id);
  const recipient_id = asString(value.recipient_id);
  const audience = asString(value.audience);
  const skill_set_hash = asString(value.skill_set_hash);
  if (project_id === null || purpose_id === null || recipient_id === null || audience === null || skill_set_hash === null) {
    throw new Error('scope 필드가 온전하지 않습니다.');
  }
  return { project_id, purpose_id, recipient_id, audience, skill_set_hash };
}

function parseTaskContext(value: unknown): TaskContext {
  if (!isRecord(value)) throw new Error('작업 응답의 context가 객체가 아닙니다.');
  const purpose = asString(value.purpose);
  const recipient = asString(value.recipient);
  if (purpose === null || recipient === null) throw new Error('작업 응답의 context에 purpose·recipient가 없습니다.');
  const out: TaskContext = { purpose, recipient };
  for (const key of ['goal_variant', 'output_language'] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'string') throw new Error(`작업 응답의 context.${key}가 문자열이 아닙니다.`);
    out[key] = entry;
  }
  return out;
}

function parseTaskIntake(value: unknown): TaskIntake {
  if (!isRecord(value)) throw new Error('작업 응답의 intake가 객체가 아닙니다.');
  const texts: Record<string, string> = {};
  for (const key of ['internal_title', 'project_id', 'purpose_id', 'recipient_id', 'audience'] as const) {
    const entry = asString(value[key]);
    if (entry === null) throw new Error(`작업 응답의 intake.${key}가 없습니다.`);
    texts[key] = entry;
  }
  const skill_ids = asStringArray(value.skill_ids);
  if (skill_ids === null) throw new Error('작업 응답의 intake.skill_ids가 문자열 배열이 아닙니다.');
  return {
    internal_title: texts.internal_title!,
    project_id: texts.project_id!,
    purpose_id: texts.purpose_id!,
    recipient_id: texts.recipient_id!,
    audience: texts.audience!,
    skill_ids,
  };
}

export function parseFieldList(body: unknown): FieldList {
  if (!isRecord(body) || !isRecord(body.data)) throw new Error('필드 목록 응답에 data 객체가 없습니다.');
  const data = body.data;
  const candidateId = asNonEmptyString(data.candidate_id);
  const inputRevision = asInt(data.input_revision);
  const sourceVersionId = asNonEmptyString(data.source_version_id);
  if (candidateId === null || inputRevision === null || sourceVersionId === null) {
    throw new Error('필드 목록 응답에 후보·revision·자료 식별자가 없습니다.');
  }
  if (!Array.isArray(data.fields)) throw new Error('필드 목록 응답의 fields가 배열이 아닙니다.');
  // 선택 필드 표현은 서버(core validateRepresentation)가 1~100개만 받는다. 같은 한도를 화면에서도 지킨다.
  if (data.fields.length === 0 || data.fields.length > 100) {
    throw new Error('필드 목록은 1개 이상 100개 이하여야 합니다.');
  }
  const fields: string[] = [];
  for (const entry of data.fields) {
    // 빈 문자열도 유효한 JSON pointer(문서 루트)라 falsy 검사로 걸러내지 않는다.
    if (typeof entry !== 'string') throw new Error('필드 이름이 문자열이 아닙니다.');
    fields.push(entry);
  }
  if (new Set(fields).size !== fields.length) throw new Error('필드 목록에 중복된 이름이 있습니다.');
  if (data.reusable !== undefined && data.reusable !== false) {
    throw new Error('선택 필드 표현은 재사용 저장을 지원하지 않습니다(서버 응답 불일치).');
  }
  return { candidateId, inputRevision, sourceVersionId, fields, reusable: false };
}

export function parseSnapshot(body: unknown): Snapshot {
  if (!isRecord(body) || !isRecord(body.data)) throw new Error('작업 응답에 data 객체가 없습니다.');
  const data = body.data;
  const id = asNonEmptyString(data.id);
  const revision = asInt(data.revision);
  if (id === null || revision === null || revision < 1) {
    throw new Error('작업 응답에 id·revision이 온전하지 않습니다.');
  }
  // 키 자체가 없으면 비정상 응답이다. null 값은 빈 목록으로 둔다.
  for (const key of ['candidates', 'evidence', 'sources', 'decisions', 'scope'] as const) {
    if (!(key in data)) throw new Error(`작업 응답에 ${key}가 없습니다.`);
  }
  const candidates: Candidate[] = [];
  if (data.candidates !== null) {
    if (!Array.isArray(data.candidates)) throw new Error('candidates가 배열이 아닙니다.');
    for (const item of data.candidates) candidates.push(parseCandidate(item));
  }
  const evidence: Evidence[] = [];
  if (data.evidence !== null) {
    if (!Array.isArray(data.evidence)) throw new Error('evidence가 배열이 아닙니다.');
    for (const item of data.evidence) evidence.push(parseEvidence(item));
  }
  const sources: Source[] = [];
  if (data.sources !== null) {
    if (!Array.isArray(data.sources)) throw new Error('sources가 배열이 아닙니다.');
    for (const item of data.sources) sources.push(parseSource(item));
  }
  const decisions: Record<string, SavedDecision> = {};
  if (data.decisions !== null) {
    if (!isRecord(data.decisions)) throw new Error('decisions가 객체가 아닙니다.');
    for (const [key, entry] of Object.entries(data.decisions)) decisions[key] = parseSavedDecision(entry);
  }
  const snapshot: Snapshot = { id, revision, candidates, evidence, sources, decisions, scope: parseScope(data.scope) };
  // 서버 집계는 phase·context·intake·현재 job/artifact를 함께 준다. 없는 응답도 계약상 정상이라 optional로만 채운다.
  if (data.phase !== undefined) {
    const phase = asNonEmptyString(data.phase);
    if (phase === null) throw new Error('작업 응답의 phase가 문자열이 아닙니다.');
    snapshot.phase = phase;
  }
  if (data.context !== undefined && data.context !== null) snapshot.context = parseTaskContext(data.context);
  if (data.intake !== undefined && data.intake !== null) snapshot.intake = parseTaskIntake(data.intake);
  for (const key of ['current_job_id', 'current_artifact_id'] as const) {
    const value = data[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new Error(`작업 응답의 ${key}가 문자열이 아닙니다.`);
    snapshot[key] = value;
  }
  if (data.cancellation_requested !== undefined) {
    if (typeof data.cancellation_requested !== 'boolean') {
      throw new Error('작업 응답의 cancellation_requested가 불리언이 아닙니다.');
    }
    snapshot.cancellation_requested = data.cancellation_requested;
  }
  return snapshot;
}

export function parseProposal(value: unknown): Proposal {
  if (!isRecord(value)) throw new Error('해석 결과가 객체가 아닙니다.');
  const status = asNonEmptyString(value.status);
  const candidate_id = asNonEmptyString(value.candidate_id);
  if (status !== 'supported' && status !== 'ambiguous' && status !== 'unsupported') {
    throw new Error('해석 상태가 계약에 없습니다.');
  }
  if (candidate_id === null) throw new Error('해석 결과에 candidate_id가 없습니다.');
  if (typeof value.requires_clarification !== 'boolean') {
    throw new Error('requires_clarification이 불리언이 아닙니다.');
  }
  let representation: Representation | null = null;
  if (value.representation !== null && value.representation !== undefined) {
    representation = parseRepresentation(value.representation);
  }
  return { status, candidate_id, representation, requires_clarification: value.requires_clarification };
}

export function parseJob(body: unknown): Job {
  if (!isRecord(body) || !isRecord(body.data)) throw new Error('작업 응답에 data 객체가 없습니다.');
  const data = body.data;
  const id = asNonEmptyString(data.id);
  const kind = asNonEmptyString(data.kind);
  const status = asNonEmptyString(data.status);
  const input_revision = asInt(data.input_revision);
  if (id === null || kind === null || status === null || input_revision === null) {
    throw new Error('job 응답에 id·kind·status·input_revision이 없습니다.');
  }
  if (JOB_STATUSES[status] !== true) throw new Error('job 상태가 계약에 없습니다.');
  let result: Proposal | null = null;
  if (data.result !== null && data.result !== undefined) result = parseProposal(data.result);
  return { id, kind, status, input_revision, result };
}

export function serverErrorCode(body: unknown): string {
  if (isRecord(body) && typeof body.error === 'string') return ` ${body.error}`;
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string' && body.error.code !== '') {
    return ` ${body.error.code}`;
  }
  return '';
}

export function newIdempotencyKey(): string {
  try {
    const random = globalThis.crypto?.randomUUID;
    if (typeof random === 'function') return random.call(globalThis.crypto);
  } catch {
    // 아래 대체 키로 진행한다.
  }
  return `ui-${Date.now().toString(36)}-${Math.floor(Math.random() * 4294967296).toString(36)}`;
}

export const NO_TOKEN_REASON =
  '쓰기가 차단됩니다: 운영 화면에 인증된 세션의 CSRF 토큰이 제공되지 않았습니다. ' +
  '미리보기·조건 확인·전체 적용·철회는 토큰을 명시적으로 받은 뒤에야 보낼 수 있습니다.';

