// 공개 결정 상태. React reducer가 상태의 단일 원천이고 모든 전이는 불변 갱신으로만 이뤄진다.
// 파싱·직렬화·검증은 disclosure-contract.ts가 맡고, 이 모듈은 상태 전이와 사용자 문구만 표현한다.
import { REUSABLE_FORBIDDEN, SELECTED_FIELDS_TRANSFORM, representationSignature } from './disclosure-contract.ts';
import type { Candidate, Disposition, Draft, Evidence, Mode, Proposal, Snapshot } from './disclosure-contract.ts';
import type { DisclosuresAction, JobOutcome, JobRequest, PreviewOutcome, PreviewRequest } from './disclosure-actions.ts';
export type * from './disclosure-contract.ts';
// 요청 시점 조건과 액션 타입은 disclosure-actions.ts에 있다. 상태 쪽에서도 같은 이름으로 노출한다.
export type { DisclosuresAction, FieldsOutcome, FieldsRequest, JobOutcome, JobRequest, PreviewOutcome, PreviewRequest } from './disclosure-actions.ts';

export interface ReloadRequest {
  id: number;
  taskId: string;
}

// 후보 한 건의 서버 필드 목록 상태. 목록은 서버 GET 응답이 정본이고 화면은 그대로 표시한다.
export interface FieldEntry {
  status: 'loading' | 'ready' | 'failed';
  candidateId: string;
  inputRevision: number | null;
  fields: string[];
  requestId: number;
  message: string;
}

export interface DisclosuresState {
  snapshot: Snapshot | null;
  drafts: ReadonlyMap<string, Draft>;
  fieldLists: ReadonlyMap<string, FieldEntry>;
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
  fieldLists: new Map<string, FieldEntry>(),
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
    selection: new Map<string, boolean>(),
    message: '',
  };
}

// 서버 calculatePreview의 계열 변환 조건과 같다. 후보 종류가 아니라 근거 모양이 기준이다:
// 한 CSV 자료의 서로 다른 행·같은 한 열의 셀이어야 한다(값의 정수 여부는 서버가 판정).
export function seriesBlockReason(candidate: Candidate, evidence: readonly Evidence[]): string {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const refs = (candidate.evidence_ids ?? []).map((id) => byId.get(id) ?? null);
  if (refs.length === 0 || refs.some((item) => item === null)) {
    return '이 후보의 근거를 찾을 수 없어 추이 표를 만들 수 없습니다.';
  }
  const spans = refs as Evidence[];
  if (spans.some((item) => item.locator.kind !== 'csv_cell' || typeof item.locator.column !== 'string' || typeof item.locator.row !== 'number')) {
    return 'B(추이 표)는 한 CSV의 셀 근거가 모여 있을 때만 쓸 수 있습니다.';
  }
  if (new Set(spans.map((item) => item.source_version_id)).size !== 1) {
    return 'B(추이 표)는 한 자료의 근거만으로 만들 수 있습니다.';
  }
  if (new Set(spans.map((item) => item.locator.column)).size !== 1) {
    return 'B(추이 표)는 한 열의 근거만으로 만들 수 있습니다.';
  }
  if (new Set(spans.map((item) => item.locator.row)).size !== spans.length) {
    return 'B(추이 표)는 행이 서로 다른 근거만으로 만들 수 있습니다.';
  }
  return '';
}

// 같은 tick에서 명령을 잇달아 부를 때 렌더 지연 없이 다음 초안을 계산한다.
// reducer의 draft/mode 전이와 같은 규칙이며 두 곳이 어긋나지 않도록 reducer도 이 함수를 쓴다.
export function withMode(candidate: Candidate, draft: Draft, mode: Mode, evidence: readonly Evidence[] = []): Draft {
  const base: Draft = {
    ...draft,
    mode,
    preview: null,
    interpretation: 'uninterpreted',
    jobId: null,
    jobStatus: null,
    message: '',
    representation: null,
    selection: new Map<string, boolean>(),
  };
  if (mode === 'A') return { ...base, representation: { kind: 'fact_summary', transform_id: '', parameters: {} } };
  if (mode === 'B') {
    const reason = seriesBlockReason(candidate, evidence);
    if (reason !== '') return { ...base, message: reason };
    return { ...base, representation: { kind: 'derived_table', transform_id: 'series_direction_only.v1', parameters: {} } };
  }
  if (mode === 'C') {
    return {
      ...base,
      message: 'C(선택 필드)를 골랐습니다. 서버가 후보 근거의 필드 목록을 주면 공개할 필드를 고르세요.',
    };
  }
  return { ...base, message: 'D는 아래 조건을 적고 조건 해석이 끝나야 미리보기가 가능합니다.' };
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

// C(선택 필드) 체크박스 전이. 필드 이름을 그대로 key로 쓰므로 빈 JSON pointer("")도 선택에 남는다.
// 선택이 바뀌면 이전 미리보기를 즉시 버려 무효한 해시가 저장 경로에 남지 않게 한다.
export function withFieldSelection(draft: Draft, entry: FieldEntry, field: string, checked: boolean): Draft {
  const selection = new Map(draft.selection);
  selection.set(field, checked);
  const fields = entry.fields.filter((name) => selection.get(name) === true);
  const representation: Draft['representation'] = fields.length === 0
    ? null
    : { kind: 'selected_fields', transform_id: SELECTED_FIELDS_TRANSFORM, parameters: { fields } };
  return {
    ...draft,
    selection,
    representation,
    preview: null,
    interpretation: 'uninterpreted',
    message: fields.length === 0
      ? '고른 필드가 없어 미리보기를 만들 수 없습니다. 공개할 필드를 하나 이상 고르세요.'
      : `고른 필드 ${fields.length}개로 서버 미리보기를 요청할 수 있습니다.`,
  };
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
      message: '이 조건을 적용할 수 있습니다. 미리보기를 확인한 뒤 결정을 저장하세요.',
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
      message: '조건이 모호해 미리보기를 만들 수 없습니다. 조건을 고쳐 다시 확인하세요.',
    };
  }
  return {
    ...draft,
    interpretation: 'unsupported',
    representation: null,
    preview: null,
    message: '지원하지 않는 조건이라 미리보기를 만들 수 없습니다. 조건을 고쳐 다시 확인하세요.',
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

function withFieldEntry(state: DisclosuresState, id: string, entry: FieldEntry): DisclosuresState {
  const fieldLists = new Map(state.fieldLists);
  fieldLists.set(id, entry);
  return { ...state, fieldLists };
}

// 응답을 폐기할 때 목록 상태도 지운다. 'loading'을 남기면 다시 요청할 수 없어 막힌다.
function withoutFieldEntry(state: DisclosuresState, id: string): DisclosuresState {
  const fieldLists = new Map(state.fieldLists);
  fieldLists.delete(id);
  return { ...state, fieldLists };
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
        ...withDraftMessage(state, id, '작업 판본이 바뀌었습니다. 최신 상태를 다시 불러옵니다.'),
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
    return withDraftMessage(state, id, '미리보기 응답이 요청한 후보·판본·표현과 달라 폐기했습니다.');
  }
  return withDraft(state, id, {
    ...draft,
    preview,
    message: '미리보기를 만들었습니다. 내용을 확인한 뒤 결정을 저장하세요.',
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
        ...withDraftMessage(state, id, '작업 판본이 바뀌었습니다. 최신 상태를 다시 불러옵니다.'),
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
  if (job.status === 'queued' || job.status === 'running' || job.status === 'cancel_requested') {
    return withDraft(state, id, {
      ...running,
      message: job.status === 'cancel_requested'
        ? '해석 작업이 취소 접수(cancel_requested) 상태입니다. 서버가 정리하면 다시 조회하세요.'
        : '해석이 아직 진행 중입니다. 잠시 뒤 다시 조회하세요.',
    });
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

const LOADING_MESSAGE = '작업을 불러오는 중입니다.';

function batchSavedMessage(drafts: ReadonlyMap<string, Draft>): string {
  const sent = [...drafts.values()].filter((draft) => draft.disposition !== null);
  const deferred = sent.filter((draft) => draft.disposition === 'defer').length;
  return `결정 ${sent.length}개를 저장했습니다.${deferred > 0 ? ` 보류 ${deferred}개는 최종 확정 전에 허용이나 제외로 바꿔야 합니다.` : ''}`;
}

export function disclosuresReducer(state: DisclosuresState, action: DisclosuresAction): DisclosuresState {
  switch (action.type) {
    case 'task/load-start':
      // 이미 보이는 작업을 다시 읽을 때는 방금 끝난 동작의 결과 문구를 지우지 않는다.
      return { ...state, busy: true, message: state.snapshot ? state.message : LOADING_MESSAGE };
    case 'task/clear':
      // 작업이 삭제되면 이전 snapshot·초안·필드 목록을 모두 버린다. 늦은 응답은 loadSeq로 걸러진다.
      return {
        ...state,
        snapshot: null,
        drafts: new Map<string, Draft>(),
        fieldLists: new Map<string, FieldEntry>(),
        acceptScopeReduction: false,
        stale: false,
        loadSeq: state.loadSeq + 1,
        reload: null,
        message: '작업을 비웠습니다. 1단계에서 다른 작업을 고르세요.',
      };
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
          fieldLists: new Map<string, FieldEntry>(),
          acceptScopeReduction: false,
          message: '',
        };
      }
      if (previous && previous.revision !== snapshot.revision) {
        const drafts = new Map<string, Draft>();
        let invalidated = false;
        for (const [id, draft] of state.drafts) {
          if (draft.preview || draft.jobId) invalidated = true;
          drafts.set(id, {
            ...draft,
            preview: null,
            interpretation: 'uninterpreted',
            // C의 표현은 서버 필드 목록에서 파생되므로 revision이 바뀌면 목록과 함께 버린다.
            representation: draft.mode === 'D' || draft.mode === 'C' ? null : draft.representation,
            selection: draft.mode === 'C' ? new Map<string, boolean>() : draft.selection,
            jobId: null,
            jobStatus: null,
          });
        }
        return {
          ...next,
          drafts,
          fieldLists: new Map<string, FieldEntry>(),
          // 비울 미리보기가 없으면 방금 끝난 동작의 결과 문구를 그대로 둔다. 재조회 자체는 알릴 일이 아니다.
          message: invalidated
            ? `작업 판본이 ${snapshot.revision}(으)로 바뀌어 미리보기와 조건 해석을 다시 해야 합니다. 입력한 조건은 남아 있습니다.`
            : state.message,
        };
      }
      return { ...next, message: state.message === LOADING_MESSAGE ? '' : state.message };
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
      return withDraft(checked.state, action.id, withMode(checked.candidate, draft, action.mode, checked.state.snapshot?.evidence ?? []));
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
    case 'fields/start': {
      const draft = state.drafts.get(action.id);
      const drafts = new Map(state.drafts);
      if (draft) {
        drafts.set(action.id, { ...draft, selection: new Map<string, boolean>(), representation: null, preview: null });
      }
      const fieldLists = new Map(state.fieldLists);
      fieldLists.set(action.id, {
        status: 'loading',
        candidateId: action.id,
        inputRevision: null,
        fields: [],
        requestId: action.requestId,
        message: '필드 목록을 불러오는 중입니다.',
      });
      return { ...state, drafts, fieldLists, message: '필드 목록을 불러오는 중입니다.' };
    }
    case 'fields/result': {
      const entry = state.fieldLists.get(action.id);
      const request = action.request;
      if (!entry || entry.candidateId !== request.candidateId) return state;
      // 같은 후보의 이전 요청 응답이면 최신 요청이 상태를 정하므로 버린다.
      if (entry.requestId !== request.requestId) return state;
      // 작업을 다시 조회했거나 다른 작업으로 옮겼으면 늦은 필드 응답을 버리고 목록 상태도 지운다.
      if (state.loadSeq !== request.loadSeq) return withoutFieldEntry(state, action.id);
      const draft = state.drafts.get(action.id);
      if (!draft || draft.mode !== 'C') return withoutFieldEntry(state, action.id);
      const failed = (message: string): DisclosuresState =>
        withFieldEntry({ ...state, message }, action.id, {
          status: 'failed',
          candidateId: request.candidateId,
          inputRevision: null,
          fields: [],
          requestId: request.requestId,
          message,
        });
      if (action.result.kind === 'network') return failed('필드 목록 전송에 실패했습니다. 입력은 그대로 두었습니다.');
      if (action.result.kind === 'http') {
        const { status, code } = action.result;
        // 서버는 후보 근거가 CSV 셀·JSON 포인터가 아니거나 여러 자료에 걸치면 422 UNSUPPORTED_FIELDS로 거절한다.
        const hint = status === 422
          ? ' 이 후보의 근거는 한 자료의 CSV 셀·JSON 포인터가 아니어서 선택 필드로 공개할 수 없습니다.'
          : status === 404
            ? ' 작업 또는 후보를 서버에서 찾지 못했습니다.'
            : '';
        return failed(`필드 목록을 불러오지 못했습니다(${status}${code}).${hint}`);
      }
      if (action.result.kind === 'unreadable') {
        return failed('필드 목록 응답을 해석할 수 없어 성공으로 처리하지 않았습니다.');
      }
      const list = action.result.list;
      if (list.candidateId !== action.id) return failed('필드 목록 응답이 다른 후보를 가리켜 폐기했습니다.');
      if (state.snapshot && list.inputRevision !== state.snapshot.revision) {
        // 목록 revision이 현재 snapshot과 다르면 이전 선택·미리보기를 버리고 작업 조회를 다시 요청한다.
        // 응답을 실패로 남겨 두어 같은 목록을 자동으로 다시 요청하는 순환을 만들지 않는다.
        const drafts = new Map(state.drafts);
        drafts.set(action.id, { ...draft, selection: new Map<string, boolean>(), representation: null, preview: null });
        return withFieldEntry({
          ...state,
          drafts,
          message:
            '필드 목록의 판본이 현재 작업 판본과 달라 선택과 미리보기를 폐기했습니다. ' +
            '작업을 다시 조회한 뒤 필드 목록을 새로 불러오세요.',
          reload: reloadOf(state, state.snapshot.id),
        }, action.id, {
          status: 'failed',
          candidateId: action.id,
          inputRevision: list.inputRevision,
          fields: [],
          requestId: request.requestId,
          message: '목록 판본이 현재 작업과 다릅니다. 작업을 다시 불러온 뒤 필드 목록을 다시 불러오세요.',
        });
      }
      const drafts = new Map(state.drafts);
      drafts.set(action.id, {
        ...draft,
        selection: new Map<string, boolean>(),
        representation: null,
        preview: null,
        message: `선택 가능한 필드 ${list.fields.length}개를 불러왔습니다. 공개할 필드를 고르세요.`,
      });
      return withFieldEntry(
        { ...state, drafts, message: '필드 목록을 불러왔습니다. 공개할 필드를 고르세요.' },
        action.id,
        {
          status: 'ready',
          candidateId: action.id,
          inputRevision: list.inputRevision,
          fields: list.fields,
          requestId: request.requestId,
          message: '',
        },
      );
    }
    case 'fields/toggle': {
      const checked = requireCandidate(state, action.id);
      if (!checked.candidate) return checked.state;
      const entry = checked.state.fieldLists.get(action.id);
      const draft = checked.state.drafts.get(action.id) ?? blankDraft();
      if (!entry || entry.status !== 'ready') {
        return withDraftMessage(checked.state, action.id, '필드 목록을 먼저 불러오세요.');
      }
      if (draft.mode !== 'C') return withDraftMessage(checked.state, action.id, 'C(선택 필드)를 먼저 고르세요.');
      if (!entry.fields.includes(action.field)) {
        return withDraftMessage(checked.state, action.id, '응답 목록에 없는 필드는 고를 수 없습니다.');
      }
      return withDraft(checked.state, action.id, withFieldSelection(draft, entry, action.field, action.checked));
    }
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
          `결정을 저장하지 못했습니다(${action.status}${action.code}). 기존 결정은 그대로 유지됩니다.`,
      };
    case 'batch/sent':
      // 저장한 선택은 서버의 결정으로 확정됐다. 같은 초안을 다시 보내면 필드·미리보기가
      // 판본 변경으로 비워진 채 남아 다음 배치가 거부되므로, 카드의 편집 상태를 초기화한다.
      return {
        ...state,
        drafts: new Map([...state.drafts].map(([id]) => [id, blankDraft()])),
        message: batchSavedMessage(state.drafts),
      };
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
