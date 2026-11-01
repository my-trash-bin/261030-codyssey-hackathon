// 공개 결정 화면의 표시 전용 포맷 규칙.
// 상태·전송 경계는 disclosure-state.ts가 맡고, 이 모듈은 라벨·요약·차단 사유 문구만 만든다.
// DOM을 만들지 않는다.

import type { Disposition, Draft, Mode, Representation, Scope } from './disclosure-state.ts';

export const MODE_LABELS: Record<Mode, string> = {
  A: 'A. 사실 요약 — 구체적인 값 없이 사실만 문장으로',
  B: 'B. 추이만 — 관측 순서와 증가·감소 방향만, 값·비율·시각 제외',
  C: 'C. 요청 정보 마스킹 — 고른 필드와 값만 남김',
  D: 'D. 기타 직접 입력 — 조건을 해석해 적용할 수 있을 때만',
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  allow: '허용',
  exclude: '이번 결과에서 제외',
  defer: '보류',
};

export const KIND_LABELS: Record<string, string> = {
  observation: '관측',
  constraint: '제약',
  hypothesis: '가설',
  unknown: '미확인',
  identifier: '식별자',
  series: '추이',
  timeline: '시간 순서',
  synthetic: '합성 예시',
  config_example: '설정 예',
};

export const REPRESENTATION_LABELS: Record<Representation['kind'], string> = {
  fact_summary: '사실 요약',
  derived_table: '추이 표',
  selected_fields: '선택 필드',
  exact_value: '정확한 값',
  approved_excerpt: '승인된 발췌',
};

// 목적 표시 이름은 기존 카탈로그 표기(contracts/catalog.example.json의 purposes[].display_name)를 그대로 쓴다.
export const PURPOSE_LABELS: Record<string, string> = {
  oss_issue: '오픈소스 버그 제보',
  vendor_support: 'B2B 기술지원 문의',
  operations_advice: '외부 운영 자문',
};

export const AUDIENCE_LABELS: Record<string, string> = {
  public: '공개',
  named_external: '지정 외부 수신자',
};

// exact_value·approved_excerpt·선택 필드는 재사용 기준 저장이 허용되지 않는다.
export const REUSABLE_FORBIDDEN: readonly Representation['kind'][] = [
  'exact_value',
  'approved_excerpt',
  'selected_fields',
];

export const UNCERTAINTY_LABELS: Record<string, string> = {
  observed: '관찰됨',
  reported: '전달받음',
  inferred: '추론함',
  unknown: '알 수 없음',
};

const KIND_ORDER = ['observation', 'constraint', 'identifier', 'hypothesis', 'unknown'];

// 서버 후보 순서는 임의 ID 정렬이다. 필수 후보를 앞에 두고 확인된 사실부터 읽게 한다.
export function orderCandidates<T extends { required: boolean; kind: string }>(candidates: readonly T[]): T[] {
  const rank = (kind: string): number => {
    const index = KIND_ORDER.indexOf(kind);
    return index === -1 ? KIND_ORDER.length : index;
  };
  return [...candidates].sort((a, b) => Number(b.required) - Number(a.required) || rank(a.kind) - rank(b.kind));
}

export function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 15)}…` : value;
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function representationLabel(representation: Representation | null): string {
  if (!representation) return '표현 미선택';
  const name = REPRESENTATION_LABELS[representation.kind] ?? representation.kind;
  return representation.transform_id === 'series_index_base100.v1' ? `${name} · 기준 100 지수`
    : representation.transform_id === 'series_direction_only.v1' ? `${name} · 방향만` : name;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

/** 카탈로그 표시 이름. 모르는 ID는 이름을 지어내지 않고 ID 그대로 둔다. */
export interface ScopeNames {
  projects: readonly { id: string; displayName: string }[];
  purposes: readonly { id: string; displayName: string }[];
  recipients: readonly { id: string; displayName: string }[];
}

function displayName(list: readonly { id: string; displayName: string }[] | undefined, id: string): string | null {
  return list?.find((item) => item.id === id)?.displayName ?? null;
}

export function purposeLabel(id: string, names?: ScopeNames | null): string {
  return displayName(names?.purposes, id) ?? PURPOSE_LABELS[id] ?? id;
}

export function scopeSummary(scope: Scope, names?: ScopeNames | null): string {
  const record = asRecord(scope);
  const parts: string[] = [];
  const purpose = readString(record, 'purpose_id');
  if (purpose) parts.push(`목적 ${purposeLabel(purpose, names)}`);
  const audience = readString(record, 'audience');
  if (audience) parts.push(`공개 범위 ${AUDIENCE_LABELS[audience] ?? audience}`);
  const project = readString(record, 'project_id');
  if (project) parts.push(`프로젝트 ${displayName(names?.projects, project) ?? project}`);
  const recipient = readString(record, 'recipient_id');
  if (recipient) parts.push(`수신처 ${displayName(names?.recipients, recipient) ?? recipient}`);
  return parts.length > 0 ? parts.join(' · ') : '범위 정보가 없습니다.';
}

// 목적 ID는 서버 응답 값이다. 표기 이름을 모르는 값에 이름을 지어내지 않고 ID만 덧붙여 보여준다.
export function purposeName(scope: Scope): string {
  const purpose = readString(asRecord(scope), 'purpose_id');
  if (!purpose) return '';
  const label = PURPOSE_LABELS[purpose];
  return label ?? purpose;
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export type DecodedText = { ok: true; text: string } | { ok: false; reason: string };

export function decodeBase64Text(value: string): DecodedText {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { ok: true, text: new TextDecoder('utf-8').decode(bytes) };
  } catch {
    return { ok: false, reason: 'base64를 UTF-8로 해석하지 못했습니다.' };
  }
}

export function interpretationText(draft: Draft): string {
  switch (draft.interpretation) {
    case 'supported':
      return '해석 결과: 적용할 수 있습니다. 미리보기를 만드세요.';
    case 'ambiguous':
      return '해석 결과: 모호합니다. 조건을 더 구체적으로 적어야 미리보기를 만들 수 있습니다.';
    case 'unsupported':
      return '해석 결과: 지원하지 않는 조건이라 이 조건으로는 공개할 수 없습니다.';
    default:
      return '아직 해석하지 않았습니다. 미리보기를 만들려면 조건 해석을 먼저 요청하세요.';
  }
}

export function emptyDraft(): Draft {
  return {
    disposition: null,
    mode: null,
    condition: '',
    reusable: false,
    preview: null,
    interpretation: 'uninterpreted',
    jobId: null,
    jobStatus: null,
    representation: null,
    selection: new Map<string, boolean>(),
    message: '',
  };
}

export function writeNoteText(reason: string): string {
  return reason;
}

export function previewBlockReason(draft: Draft, writeReason: string, busy: boolean): string | null {
  if (writeReason) return writeReason;
  if (busy) return '다른 요청이 진행 중입니다. 끝난 뒤 다시 시도하세요.';
  if (!draft.representation) {
    return draft.mode === 'C'
      ? 'C는 서버가 준 필드 목록에서 공개할 필드를 하나 이상 골라야 미리보기를 만들 수 있습니다.'
      : '표현 방식을 먼저 고르세요.';
  }
  if (draft.mode === 'D' && draft.interpretation !== 'supported') {
    return 'D는 조건 해석이 끝나 적용 가능해야 미리보기를 만들 수 있습니다.';
  }
  return null;
}
