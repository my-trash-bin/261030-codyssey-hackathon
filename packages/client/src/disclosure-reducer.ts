import type { DisclosuresAction } from './disclosure-actions.ts';
import type { Draft } from './disclosure-contract.ts';
import { LOADING_MESSAGE, applyProposal, batchSavedMessage, blankDraft, initialDisclosuresState, invalidatePreviews, jobResult, previewResult, reloadOf, requireCandidate, withCondition, withDisposition, withDraft, withDraftMessage, withFieldEntry, withFieldSelection, withMode, withReusable, withoutFieldEntry } from './disclosure-transitions.ts';
import type { DisclosuresState, FieldEntry } from './disclosure-transitions.ts';

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
