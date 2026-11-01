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
