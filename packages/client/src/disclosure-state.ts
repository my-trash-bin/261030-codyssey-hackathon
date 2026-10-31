// 공개 결정 상태. React reducer가 상태의 단일 원천이고 모든 전이는 불변 갱신으로만 이뤄진다.
// 파싱·직렬화·검증은 disclosure-contract.ts가 맡고, 이 모듈은 상태 전이와 사용자 문구만 표현한다.
import { REUSABLE_FORBIDDEN, representationSignature } from './disclosure-contract.ts';
import type { Candidate, Disposition, Draft, Mode, Proposal, Snapshot } from './disclosure-contract.ts';
import type { DisclosuresAction, JobOutcome, JobRequest, PreviewOutcome, PreviewRequest } from './disclosure-actions.ts';
export type * from './disclosure-contract.ts';
// 요청 시점 조건과 액션 타입은 disclosure-actions.ts에 있다. 상태 쪽에서도 같은 이름으로 노출한다.
export type { DisclosuresAction, JobOutcome, JobRequest, PreviewOutcome, PreviewRequest } from './disclosure-actions.ts';

export interface ReloadRequest {
  id: number;
  taskId: string;
}

export interface DisclosuresState {
  snapshot: Snapshot | null;
  drafts: ReadonlyMap<string, Draft>;
  busy: boolean;
  message: string;
  acceptScopeReduction: boolean;
  stale: boolean;
  // 작업 조회가 성공할 때마다 증가한다. 늦게 도착한 응답의 폐기 판단에 쓴다.
  loadSeq: number;
  // reducer가 재조회가 필요하다고 판단한 경우에만 채워진다. 훅의 효과가 소비한다.
  reload: ReloadRequest | null;
  reloadSeq: number;
}

export const initialDisclosuresState: DisclosuresState = {
  snapshot: null,
  drafts: new Map<string, Draft>(),
  busy: false,
  message: '',
  acceptScopeReduction: false,
  stale: false,
  loadSeq: 0,
  reload: null,
  reloadSeq: 0,
};

export function blankDraft(): Draft {
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

// 같은 tick에서 명령을 잇달아 부를 때 렌더 지연 없이 다음 초안을 계산한다.
// reducer의 draft/mode 전이와 같은 규칙이며 두 곳이 어긋나지 않도록 reducer도 이 함수를 쓴다.
export function withMode(candidate: Candidate, draft: Draft, mode: Mode): Draft {
  const base: Draft = {
    ...draft,
    mode,
    preview: null,
    interpretation: 'uninterpreted',
    jobId: null,
    jobStatus: null,
    message: '',
    representation: null,
  };
  if (mode === 'A') return { ...base, representation: { kind: 'fact_summary', transform_id: '', parameters: {} } };
  if (mode === 'B') {
    if (candidate.kind !== 'series') {
      return { ...base, message: 'B(추이 표)는 series 후보에만 쓸 수 있어 근거 없는 매핑을 만들지 않습니다.' };
    }
    return { ...base, representation: { kind: 'derived_table', transform_id: 'series_direction_only.v1', parameters: {} } };
  }
  if (mode === 'C') {
    return {
      ...base,
      message: 'C(선택 필드)는 선택 가능한 필드 목록과 서버 변환이 아직 제공되지 않아 미리보기·저장이 차단됩니다.',
    };
  }
  return { ...base, message: 'D는 아래 조건을 적고 조건 확인(해석)이 지원(supported)되어야 미리보기가 가능합니다.' };
}

export function withDisposition(draft: Draft, disposition: Disposition | null): Draft {
  return {
    ...draft,
    disposition,
    preview: disposition === 'allow' ? draft.preview : null,
    message: '',
  };
}

export function withCondition(draft: Draft, text: string): Draft {
  if (draft.condition === text) return draft;
  return {
    ...draft,
    condition: text,
    interpretation: 'uninterpreted',
    preview: null,
    representation: draft.mode === 'D' ? null : draft.representation,
    jobId: null,
    jobStatus: null,
  };
}

export function withReusable(draft: Draft, value: boolean): Draft {
  const kind = draft.representation?.kind;
  if (value && kind !== undefined && REUSABLE_FORBIDDEN[kind] === true) {
    return { ...draft, reusable: false, message: '이 표현 종류는 재사용 저장이 강제 금지라 토글이 꺼져 있습니다.' };
  }
  return { ...draft, reusable: value };
}

export function applyProposal(draft: Draft, candidateId: string, result: Proposal): Draft {
  if (result.candidate_id !== candidateId) {
    return { ...draft, message: '해석 결과가 다른 후보를 가리켜 폐기했습니다.' };
  }
  if (result.status === 'supported' && !result.requires_clarification) {
    if (!result.representation) {
      return {
        ...draft,
        interpretation: 'ambiguous',
        representation: null,
        preview: null,
        message: '지원 판정이지만 표현이 비어 있어 확정하지 않았습니다. 조건을 고쳐 다시 확인하세요.',
      };
    }
    return {
      ...draft,
      interpretation: 'supported',
      representation: result.representation,
      preview: null,
      message: '조건이 지원(supported)됩니다. 미리보기를 확인한 뒤 전체 적용하세요.',
    };
  }
  if (result.status === 'supported') {
    return {
      ...draft,
      interpretation: 'ambiguous',
      representation: null,
      preview: null,
      message: '조건에 추가 확인이 필요해 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.',
    };
  }
  if (result.status === 'ambiguous') {
    return {
      ...draft,
      interpretation: 'ambiguous',
      representation: null,
      preview: null,
      message: '조건이 모호(ambiguous)해 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.',
    };
  }
  return {
    ...draft,
    interpretation: 'unsupported',
    representation: null,
    preview: null,
    message: '조건이 지원되지 않아(unsupported) 미리보기가 차단됩니다. 조건을 고쳐 다시 확인하세요.',
  };
}

function withDraft(state: DisclosuresState, id: string, draft: Draft): DisclosuresState {
  const drafts = new Map(state.drafts);
  drafts.set(id, draft);
  return { ...state, drafts };
}

function withDraftMessage(state: DisclosuresState, id: string, message: string): DisclosuresState {
  const current = state.drafts.get(id) ?? blankDraft();
  return withDraft(state, id, { ...current, message });
}

function requireCandidate(state: DisclosuresState, id: string): { state: DisclosuresState; candidate: Candidate | null } {
  if (!state.snapshot) return { state: { ...state, message: '작업을 먼저 불러오세요.' }, candidate: null };
  const candidate = state.snapshot.candidates.find((item) => item.id === id) ?? null;
  if (!candidate) return { state: { ...state, message: '목록에 없는 후보라 선택을 두지 않았습니다.' }, candidate: null };
  return { state, candidate };
}

function reloadOf(state: DisclosuresState, taskId: string): ReloadRequest {
  return { id: state.reloadSeq + 1, taskId };
}

function invalidatePreviews(state: DisclosuresState): ReadonlyMap<string, Draft> {
  const drafts = new Map<string, Draft>();
  for (const [id, draft] of state.drafts) drafts.set(id, { ...draft, preview: null });
  return drafts;
}

function previewResult(
  state: DisclosuresState,
  id: string,
  request: PreviewRequest,
  result: PreviewOutcome,
): DisclosuresState {
  const draft = state.drafts.get(id);
  if (!draft || state.loadSeq !== request.loadSeq) return state;
  if (
    draft.mode !== request.mode ||
    draft.condition !== request.condition ||
    representationSignature(draft.representation) !== request.signature
  ) {
    return state;
  }
  if (result.kind === 'network') {
    return withDraftMessage(state, id, '미리보기 전송에 실패했습니다. 입력은 그대로 두었습니다.');
  }
  if (result.kind === 'http') {
    if (result.status === 409) {
      return {
        ...withDraftMessage(state, id, '작업 revision이 바뀌었습니다(409). 최신 상태를 다시 불러옵니다.'),
        reload: reloadOf(state, state.snapshot?.id ?? ''),
      };
    }
    return withDraftMessage(
      state,
      id,
      `미리보기에 실패했습니다(${result.status}${result.code}). 입력은 그대로 두었습니다.`,
    );
  }
  if (result.kind === 'unreadable') {
    return withDraftMessage(state, id, '미리보기 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.');
  }
  const preview = result.preview;
  if (
    preview.candidate_id !== id ||
    preview.input_revision !== request.revision ||
    representationSignature(preview.representation) !== request.signature
  ) {
    return withDraftMessage(state, id, '미리보기 응답이 요청한 후보·revision·표현과 달라 폐기했습니다.');
  }
  return withDraft(state, id, {
    ...draft,
    preview,
    message: '미리보기를 확인했습니다. 해시를 대조한 뒤 전체 적용에 쓰세요.',
  });
}

function jobResult(
  state: DisclosuresState,
  id: string,
  usage: 'interpret' | 'refresh',
  request: JobRequest,
  result: JobOutcome,
): DisclosuresState {
  const draft = state.drafts.get(id);
  if (!draft || state.loadSeq !== request.loadSeq) return state;
  if (draft.mode !== 'D' || draft.condition !== request.condition) return state;
  if (usage === 'refresh' && draft.jobId !== request.jobId) return state;
  if (result.kind === 'network') {
    return withDraftMessage(
      state,
      id,
      usage === 'interpret'
        ? '조건 확인 전송에 실패했습니다. 입력은 그대로 두었습니다.'
        : '해석 조회에 실패했습니다. 입력은 그대로 두었습니다.',
    );
  }
  if (result.kind === 'http') {
    if (usage === 'interpret' && result.status === 409) {
      return {
        ...withDraftMessage(state, id, '작업 revision이 바뀌었습니다(409). 최신 상태를 다시 불러옵니다.'),
        reload: reloadOf(state, state.snapshot?.id ?? ''),
      };
    }
    return withDraftMessage(
      state,
      id,
      usage === 'interpret'
        ? `조건 확인에 실패했습니다(${result.status}${result.code}). 입력은 그대로 두었습니다.`
        : `해석 조회에 실패했습니다(${result.status}${result.code}). 입력은 그대로 두었습니다.`,
    );
  }
  if (result.kind === 'unreadable') {
    return withDraftMessage(
      state,
      id,
      usage === 'interpret'
        ? '해석 작업 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.'
        : '해석 조회 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.',
    );
  }
  const job = result.job;
  const mismatched = usage === 'interpret'
    ? job.kind !== 'interpret_disclosure' || job.input_revision !== request.revision
    : job.id !== request.jobId || job.kind !== 'interpret_disclosure' || job.input_revision !== request.revision;
  if (mismatched) {
    return withDraftMessage(
      state,
      id,
      usage === 'interpret'
        ? '해석 작업 응답이 요청과 달라 폐기했습니다.'
        : '해석 조회 응답이 요청과 달라 폐기했습니다.',
    );
  }
  const running = { ...draft, jobId: job.id, jobStatus: job.status };
  if (job.status === 'succeeded' && job.result) {
    return withDraft(state, id, applyProposal(running, id, job.result));
  }
  if (usage === 'interpret') {
    if (job.status === 'succeeded') {
      return withDraft(state, id, {
        ...running,
        interpretation: 'uninterpreted',
        message: '해석 작업은 끝났지만 결과가 비어 있어 판단하지 않았습니다.',
      });
    }
    return withDraft(state, id, { ...running, message: '해석 작업을 시작했습니다. 끝나면 해석 조회를 누르세요.' });
  }
  if (job.status === 'queued' || job.status === 'running') {
    return withDraft(state, id, { ...running, message: '해석이 아직 진행 중입니다. 잠시 뒤 다시 조회하세요.' });
  }
  if (job.status === 'succeeded') {
    return withDraft(state, id, {
      ...running,
      interpretation: 'uninterpreted',
      message: '해석 작업은 끝났지만 결과가 비어 있어 판단하지 않았습니다.',
    });
  }
  return withDraft(state, id, {
    ...running,
    interpretation: 'uninterpreted',
    message: `해석 작업이 ${job.status}로 끝났습니다. 조건을 고쳐 다시 확인하세요.`,
  });
}

export function disclosuresReducer(state: DisclosuresState, action: DisclosuresAction): DisclosuresState {
  switch (action.type) {
    case 'task/load-start':
      return { ...state, busy: true, message: '작업을 불러오는 중입니다.' };
    case 'task/loaded': {
      const previous = state.snapshot;
      const snapshot = action.snapshot;
      const changed = !previous || previous.id !== snapshot.id;
      const next: DisclosuresState = {
        ...state,
        snapshot,
        stale: false,
        loadSeq: state.loadSeq + 1,
      };
      if (changed) {
        return {
          ...next,
          drafts: new Map<string, Draft>(),
          acceptScopeReduction: false,
          message: '작업을 불러왔습니다.',
        };
      }
      if (previous && previous.revision !== snapshot.revision) {
        const drafts = new Map<string, Draft>();
        for (const [id, draft] of state.drafts) {
          drafts.set(id, {
            ...draft,
            preview: null,
            interpretation: 'uninterpreted',
            representation: draft.mode === 'D' ? null : draft.representation,
            jobId: null,
            jobStatus: null,
          });
        }
        return {
          ...next,
          drafts,
          message:
            `작업 revision이 ${previous.revision}에서 ${snapshot.revision}으로 바뀌어 미리보기와 해석 결과를 무효화했습니다. ` +
            '조건 입력은 유지됩니다.',
        };
      }
      return { ...next, message: '작업을 새로고침했습니다.' };
    }
    case 'task/unreadable':
      return {
        ...state,
        stale: state.snapshot ? true : state.stale,
        message: '작업 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.',
      };
    case 'task/mismatch':
      return {
        ...state,
        stale: state.snapshot ? true : state.stale,
        message: '요청한 작업 ID와 응답 ID가 달라 성공으로 처리하지 않았습니다.',
      };
    case 'task/network-error': {
      if (!state.snapshot) {
        return { ...state, message: '작업 조회에 실패했습니다. 백엔드에 연결할 수 없습니다.' };
      }
      return {
        ...state,
        stale: true,
        message: '작업 조회에 실패했습니다. 표시 중인 정보는 오래된 것이므로 저장이 차단됩니다.',
      };
    }
    case 'task/http-error': {
      if (state.snapshot) {
        return {
          ...state,
          stale: true,
          message:
            `작업 조회에 실패했습니다(${action.status}${action.code}). ` +
            '표시 중인 정보는 오래된 것이므로 저장이 차단됩니다.',
        };
      }
      if (action.status === 404) {
        return {
          ...state,
          message: '작업을 조회하지 못했습니다(404). 작업 ID 또는 서버의 작업 조회 API 제공 여부를 확인하세요.',
        };
      }
      return { ...state, message: `작업 조회에 실패했습니다(${action.status}${action.code}).` };
    }
    case 'request/start':
      return { ...state, busy: true };
    case 'request/end':
      return { ...state, busy: false };
    case 'notice':
      return { ...state, message: action.message };
    case 'draft/notice':
      return withDraftMessage(state, action.id, action.message);
    case 'draft/select': {
      const checked = requireCandidate(state, action.id);
      if (!checked.candidate) return checked.state;
      const draft = checked.state.drafts.get(action.id) ?? blankDraft();
      return withDraft(checked.state, action.id, withDisposition(draft, action.disposition));
    }
    case 'draft/mode': {
      const checked = requireCandidate(state, action.id);
      if (!checked.candidate) return checked.state;
      const draft = checked.state.drafts.get(action.id) ?? blankDraft();
      return withDraft(checked.state, action.id, withMode(checked.candidate, draft, action.mode));
    }
    case 'draft/condition': {
      const checked = requireCandidate(state, action.id);
      if (!checked.candidate) return checked.state;
      const draft = checked.state.drafts.get(action.id) ?? blankDraft();
      return withDraft(checked.state, action.id, withCondition(draft, action.text));
    }
    case 'draft/reusable': {
      const checked = requireCandidate(state, action.id);
      if (!checked.candidate) return checked.state;
      const draft = checked.state.drafts.get(action.id) ?? blankDraft();
      return withDraft(checked.state, action.id, withReusable(draft, action.value));
    }
    case 'scope/reduction':
      return { ...state, acceptScopeReduction: action.value };
    case 'draft/preview-result':
      return previewResult(state, action.id, action.request, action.result);
    case 'draft/job-result':
      return jobResult(state, action.id, action.usage, action.request, action.result);
    case 'batch/network-error':
      return { ...state, message: '전체 적용 전송에 실패했습니다. 같은 내용으로 다시 누르면 같은 키로 재시도됩니다.' };
    case 'batch/conflict':
      return {
        ...state,
        drafts: invalidatePreviews(state),
        message: '다른 변경과 충돌했습니다(409). 미리보기를 무효화하고 최신 상태를 다시 불러옵니다.',
        reload: reloadOf(state, state.snapshot?.id ?? ''),
      };
    case 'batch/failed':
      return {
        ...state,
        message:
          `전체 적용에 실패했습니다(${action.status}${action.code}). 기존 결정은 그대로 유지됩니다.`,
      };
    case 'batch/sent':
      return { ...state, message: '결정을 저장했습니다. 최신 상태를 다시 불러옵니다.' };
    case 'revoke/network-error':
      return { ...state, message: '철회 전송에 실패했습니다. 기존 결정은 그대로 유지됩니다.' };
    case 'revoke/conflict':
      return {
        ...state,
        message: '다른 변경과 충돌했습니다(409). 최신 상태를 다시 불러옵니다.',
        reload: reloadOf(state, state.snapshot?.id ?? ''),
      };
    case 'revoke/failed':
      return {
        ...state,
        message: `철회에 실패했습니다(${action.status}${action.code}). 기존 결정은 그대로 유지됩니다.`,
      };
    case 'revoke/sent':
      return { ...state, message: '결정을 철회했습니다. 최신 상태를 다시 불러옵니다.' };
    case 'reload/consumed':
      return state.reload === null ? state : { ...state, reload: null, reloadSeq: state.reloadSeq + 1 };
  }
}
