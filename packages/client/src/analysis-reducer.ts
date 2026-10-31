// 파일 분석 화면의 상태 전이. React useReducer가 상태의 단일 원천이며 이 모듈은
// 순수 전이·파생 값·문구만 만든다. 파일 읽기·네트워크 요청은 ui/hooks/useAnalysis.ts가 맡는다.
//
// 정직 규칙(analysis-state.ts와 같은 계약):
// - 입력(파일·목적·수신처)이나 동의가 바뀌면 진행 중인 분석을 취소하고 동의를 해제한다.
//   이때 이전 성공 결과는 지우지 않고, 현재 입력 기준인지만 resultIsCurrent로 알린다.
// - 실패·취소는 이전 성공 결과를 보존하며, 늦게 도착한 응답은 요청 소유권이 없어 채택되지 않는다.

import type { AnalysisProblem, AnalysisResult } from './analysis-state.ts';

export interface AnalysisState {
  readonly purpose: string;
  readonly recipient: string;
  readonly consent: boolean;
  readonly busy: boolean;
  readonly message: string;
  readonly problem: AnalysisProblem | null;
  readonly files: readonly File[];
  readonly result: AnalysisResult | null;
  readonly inputSeq: number;
  readonly resultInputSeq: number;
}

export const initialAnalysisState: AnalysisState = {
  purpose: '',
  recipient: '',
  consent: false,
  busy: false,
  message: '',
  problem: null,
  files: [],
  result: null,
  inputSeq: 0,
  resultInputSeq: -1,
};

export type AnalysisAction =
  | { readonly type: 'files'; readonly files: readonly File[] }
  | { readonly type: 'context'; readonly purpose: string; readonly recipient: string }
  | { readonly type: 'consent'; readonly consent: boolean }
  | { readonly type: 'reentry' }
  | { readonly type: 'invalid'; readonly problem: AnalysisProblem }
  | { readonly type: 'begin' }
  | { readonly type: 'cancel' }
  | { readonly type: 'fail'; readonly message: string }
  | { readonly type: 'settle'; readonly result: AnalysisResult; readonly inputSeq: number };

export function resultIsCurrentOf(state: AnalysisState): boolean {
  return state.result !== null && state.resultInputSeq === state.inputSeq;
}

function withPreviousResult(state: AnalysisState, message: string): string {
  if (state.result === null) return message;
  return resultIsCurrentOf(state)
    ? `${message} 직전 분석 결과는 그대로 유지합니다.`
    : `${message} 이전 분석 결과는 이전 입력 기준으로 유지합니다.`;
}

function cancelled(state: AnalysisState, reason: string): AnalysisState {
  return { ...state, busy: false, message: withPreviousResult(state, reason) };
}

function inputChanged(
  state: AnalysisState,
  patch: Partial<Pick<AnalysisState, 'files' | 'purpose' | 'recipient'>>,
  reason: string,
): AnalysisState {
  const next: AnalysisState = {
    ...state,
    ...patch,
    inputSeq: state.inputSeq + 1,
    consent: false,
    problem: null,
  };
  return state.busy ? cancelled(next, reason) : next;
}

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'files': {
      const files = action.files;
      if (files.length === state.files.length && files.every((file, index) => file === state.files[index])) return state;
      return inputChanged(state, { files }, '입력 파일이 바뀌어 진행 중인 분석을 취소했습니다.');
    }
    case 'context': {
      if (action.purpose === state.purpose && action.recipient === state.recipient) return state;
      return inputChanged(
        state,
        { purpose: action.purpose, recipient: action.recipient },
        '목적·수신처가 바뀌어 진행 중인 분석을 취소했습니다.',
      );
    }
    case 'consent': {
      if (action.consent === state.consent) return state;
      if (action.consent) return { ...state, consent: true };
      const cleared: AnalysisState = { ...state, consent: false, problem: null };
      return state.busy ? cancelled(cleared, '동의를 해제해 진행 중인 분석을 취소했습니다.') : cleared;
    }
    case 'reentry':
      return { ...state, message: '이미 분석을 진행 중입니다. 끝나거나 취소된 뒤 다시 시도하세요.' };
    case 'invalid':
      return { ...state, busy: false, problem: action.problem, message: action.problem.message };
    case 'begin':
      return { ...state, busy: true, problem: null, message: '파일을 읽고 분석을 요청하는 중입니다.' };
    case 'cancel':
      // 진행 중인 요청이 없으면 이미 표시 중인 결과·메시지를 지우지 않는다.
      if (!state.busy) return state;
      return cancelled({ ...state, problem: null }, '분석을 취소했습니다.');
    case 'fail':
      return {
        ...state,
        busy: false,
        problem: { field: 'request', message: action.message },
        message: withPreviousResult(state, action.message),
      };
    case 'settle': {
      const { result, inputSeq } = action;
      return {
        ...state,
        busy: false,
        problem: null,
        result,
        resultInputSeq: inputSeq,
        message:
          `분석을 마쳤습니다: 근거 ${result.evidence.length}개, 후보 ${result.proposals.candidates.length}개, ` +
          `충돌 ${result.proposals.conflicts.length}개. 후보의 required는 모델 추천이며 확정 필수나 공개 허가가 아닙니다.`,
      };
    }
  }
}
