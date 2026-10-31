// 파일 분석 화면의 표시 전용 포맷 규칙.
// 상태·전송 경계는 analysis-state.ts가 맡고, 이 모듈은 서버 계약의 상한 표기와
// 근거 위치·발췌 문구만 만든다. DOM을 만들지 않는다.

import type { AnalysisEvidence, AnalysisSource } from './analysis-state.ts';

// 서버 계약의 상한이다. 클라이언트는 이 값으로 검증을 복제하지 않고 안내 문구에만 쓴다.
export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;
export const EXCERPT_LIMIT = 600;

export const KIND_LABELS: Record<string, string> = {
  observation: '관측',
  constraint: '제약',
  hypothesis: '가설',
  unknown: '미확인',
  identifier: '식별자',
};

export const UNCERTAINTY_LABELS: Record<string, string> = {
  observed: '관측됨',
  reported: '전달받음',
  inferred: '추론됨',
  unknown: '확실성 미상',
};

export const RELEVANCE_LABELS: Record<string, string> = {
  required: '목적상 필요(모델 추천, 확정 필수 아님)',
  optional: '목적상 선택(모델 추천)',
};

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '크기 미상';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MiB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KiB`;
  return `${value}B`;
}

export function orUnknown(value: string | number | undefined): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '응답에 없음';
}

export function locatorText(evidence: AnalysisEvidence): string {
  const locator = evidence.locator;
  const range = `바이트 ${evidence.start}–${evidence.end}`;
  if (locator.kind === 'csv_cell') {
    return `${range} · CSV 행 ${orUnknown(locator.row)} · 열 ${orUnknown(locator.column)}`;
  }
  if (locator.kind === 'json_pointer') {
    const pointer = locator.pointer ? locator.pointer : '루트(빈 포인터)';
    return `${range} · JSON 포인터 ${pointer}`;
  }
  return range;
}

// 근거 범위는 UTF-8 바이트 오프셋이다. 원본 바이트가 이 결과에 남아 있을 때만 발췌를 만든다.
export function excerptText(
  source: AnalysisSource | undefined,
  evidence: AnalysisEvidence,
): { text: string; truncated: boolean } | null {
  if (!source) return null;
  const { start, end } = evidence;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end < start || end > source.bytes.length) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(source.bytes.subarray(start, end));
  } catch { return null; }
  if (text.length > EXCERPT_LIMIT) return { text: `${text.slice(0, EXCERPT_LIMIT)}…`, truncated: true };
  return { text, truncated: false };
}
