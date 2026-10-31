import { DisclosureWorkspace } from './disclosure-state.js';
import type {
  Candidate,
  Disposition,
  Draft,
  Evidence,
  Mode,
  Preview,
  Representation,
  SavedDecision,
  Scope,
  Snapshot,
  Source,
} from './disclosure-state.js';

export type MountOptions = { csrfToken?: string; fetch?: typeof fetch };

export type FocusState = {
  key: string;
  node: HTMLElement | null;
  start: number | null;
  end: number | null;
};

export const MODE_LABELS: Record<Mode, string> = {
  A: 'A. 사실 요약 — 구체적인 값 없이 사실만 문장으로',
  B: 'B. 추이만 — 관측 순서와 증가·감소 방향만, 값·비율·시각 제외',
  C: 'C. 요청 정보 마스킹 — 고른 필드와 값만 남김',
  D: 'D. 기타 직접 입력 — 조건 해석이 지원될 때만',
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  allow: '허용(미리보기 승인)',
  exclude: '이번 결과에서 제외',
  defer: '나중에 결정',
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

// exact_value·approved_excerpt·선택 필드는 재사용 기준 저장이 허용되지 않는다.
export const REUSABLE_FORBIDDEN: readonly Representation['kind'][] = [
  'exact_value',
  'approved_excerpt',
  'selected_fields',
];



export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function line<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = make(tag, className);
  node.textContent = value;
  return node;
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
  return representation.transform_id ? `${name} · ${representation.transform_id}` : name;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

export function scopeSummary(scope: Scope): string {
  const record = asRecord(scope);
  const parts: string[] = [];
  const purpose = readString(record, 'purpose_id');
  if (purpose) parts.push(`목적 ${purpose}`);
  const audience = readString(record, 'audience');
  if (audience) parts.push(`공개 대상 ${audience}`);
  const project = readString(record, 'project_id');
  if (project) parts.push(`프로젝트 ${project}`);
  const recipient = readString(record, 'recipient_id');
  if (recipient) parts.push(`수신처 ${recipient}`);
  const skillHash = readString(record, 'skill_set_hash');
  if (skillHash) parts.push(`스킬 집합 해시 ${shortId(skillHash)}`);
  return parts.length > 0 ? parts.join(' · ') : 'task 응답에 범위 정보가 없습니다.';
}

// 목적 ID는 서버 응답 값이다. 표기 이름을 모르는 값에 이름을 지어내지 않고 ID만 덧붙여 보여준다.
export function purposeName(scope: Scope): string {
  const purpose = readString(asRecord(scope), 'purpose_id');
  if (!purpose) return '';
  const label = PURPOSE_LABELS[purpose];
  return label ? `${label}(${purpose})` : `${purpose}(표시 이름 없음)`;
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
      return '해석 결과: 지원됨 — 미리보기를 만들 수 있습니다.';
    case 'ambiguous':
      return '해석 결과: 모호함 — 조건을 더 구체화해야 하며 미리보기와 적용이 차단됩니다.';
    case 'unsupported':
      return '해석 결과: 지원되지 않음 — 이 조건으로는 공개할 수 없습니다.';
    default:
      return '해석 결과: 아직 해석되지 않았습니다. 미리보기를 만들려면 해석을 먼저 요청하세요.';
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
    message: '',
  };
}

export function isEditable(node: Element | null): node is HTMLInputElement | HTMLTextAreaElement {
  if (node instanceof HTMLTextAreaElement) return true;
  if (node instanceof HTMLInputElement) return ['text', 'search', 'url', 'email'].includes(node.type);
  return false;
}

export function findFocusable(scope: ParentNode, key: string): HTMLElement | null {
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>('[data-focus-key]'))) {
    if (node.dataset.focusKey === key) return node;
  }
  return null;
}

