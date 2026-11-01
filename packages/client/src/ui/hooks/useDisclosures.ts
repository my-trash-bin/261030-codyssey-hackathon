// 공개 결정 화면의 상태와 명령. React reducer가 상태의 단일 원천이고, 이 훅은 요청 수명만 다룬다.
// 요청 소유권(세대 번호)·멱등 재시도 키는 요청 수명 메타데이터라 ref에 두고, 화면 상태는 reducer에만 있다.
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { newIdempotencyKey, parseFieldList, parseJob, parsePreview, parseSnapshot, serverErrorCode, toWireRepresentation } from '../../disclosure-contract.ts';
import type { Mode, Disposition, Draft, Snapshot } from '../../disclosure-contract.ts';
import { blankDraft, disclosuresReducer, initialDisclosuresState, withFieldSelection, withMode } from '../../disclosure-state.ts';
import type { BatchRetry, FieldsOutcome, JobOutcome, PreviewOutcome } from '../../disclosure-state.ts';
import { batchBlockReason, canGenerate, planApply, planFieldList, planInterpret, planLoadTask, planPreview, planRefreshInterpretation, planRevoke, writeBlockReason } from '../../disclosure-selectors.ts';
import type { DisclosuresApi } from './disclosures-api.ts';
export type { DisclosuresApi } from './disclosures-api.ts';

function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useDisclosures(options: {
  csrfToken: string | null;
  fetch?: typeof fetch;
  /** 401 응답을 받았을 때 세션 재확인을 요청한다. 토큰 무효화 시점은 세션 소유자가 정한다. */
  onAuthRequired?: () => void;
}): DisclosuresApi {
  const [state, dispatch] = useReducer(disclosuresReducer, initialDisclosuresState);
  const csrfToken = options.csrfToken ?? '';
  const fetchFn = options.fetch ?? defaultFetch;
  const seqRef = useRef(0);
  // 진행 중인 요청의 소유자. 같은 tick에 두 번 눌러도 두 번째 요청을 보내지 않도록 전송 전에 잡는다.
  const activeRef = useRef<number | null>(null);
  const lastBatchRef = useRef<BatchRetry | null>(null);
  const handledReloadRef = useRef(0);
  const aliveRef = useRef(true);
  // 필드 목록 요청 번호. 같은 후보의 이전 응답을 reducer가 구분해 버린다.
  const fieldRequestRef = useRef(0);
  // 401 통지는 세션 소유자 콜백으로 넘긴다. 콜백이 바뀌어도 진행 중인 요청은 최신 것을 쓴다.
  const authRef = useRef(options.onAuthRequired);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    authRef.current = options.onAuthRequired;
  }, [options.onAuthRequired]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // 언마운트 뒤 도착한 응답이 상태를 건드리지 않도록 요청 세대를 올리고 점유를 비운다.
      aliveRef.current = false;
      seqRef.current += 1;
      activeRef.current = null;
    };
  }, []);

  // 인증이 만료되면 서버는 401을 준다. 화면은 실패 문구를 남기고 세션 소유자에게 재확인을 요청한다.
  function notifyAuth(status: number): void {
    if (status !== 401) return;
    authRef.current?.();
  }

  function begin(): number {
    const owner = ++seqRef.current;
    activeRef.current = owner;
    return owner;
  }

  function release(owner: number): void {
    if (activeRef.current === owner) activeRef.current = null;
  }

  const loadTask = useCallback(async (id: string): Promise<void> => {
    const plan = planLoadTask(id);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    const owner = begin();
    dispatch({ type: 'task/load-start' });
    let response: Response;
    try {
      response = await fetchFn(`/api/v1/tasks/${encodeURIComponent(plan.taskId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'task/network-error' });
      return;
    }
    const body = await readJson(response);
    if (seqRef.current !== owner) return;
    release(owner);
    dispatch({ type: 'request/end' });
    if (!response.ok) {
      notifyAuth(response.status);
      dispatch({ type: 'task/http-error', status: response.status, code: serverErrorCode(body) });
      return;
    }
    let snapshot: Snapshot;
    try {
      snapshot = parseSnapshot(body);
    } catch {
      dispatch({ type: 'task/unreadable' });
      return;
    }
    if (snapshot.id !== plan.taskId) {
      dispatch({ type: 'task/mismatch' });
      return;
    }
    dispatch({ type: 'task/loaded', taskId: plan.taskId, snapshot });
  }, [fetchFn]);

  useEffect(() => {
    // reducer가 409·충돌 뒤 재조회를 요구했을 때만 한 번 실행한다.
    const reload = state.reload;
    if (reload === null || reload.id <= handledReloadRef.current) return;
    handledReloadRef.current = reload.id;
    dispatch({ type: 'reload/consumed' });
    void loadTask(reload.taskId);
  }, [state.reload, loadTask]);

  // 필드 목록 조회는 읽기라 activeRef/busy 점유를 쓰지 않는다. 대신 requestId로 이전 응답을 버린다.
  const loadFields = useCallback(async (id: string): Promise<void> => {
    const plan = planFieldList(stateRef.current, id);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    const requestId = fieldRequestRef.current + 1;
    fieldRequestRef.current = requestId;
    const request = { loadSeq: plan.loadSeq, candidateId: plan.candidateId, requestId };
    dispatch({ type: 'fields/start', id, requestId });
    let response: Response;
    try {
      response = await fetchFn(
        `/api/v1/tasks/${encodeURIComponent(plan.taskId)}/candidates/${encodeURIComponent(plan.candidateId)}/fields`,
        { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' },
      );
    } catch {
      if (!aliveRef.current) return;
      dispatch({ type: 'fields/result', id, request, result: { kind: 'network' } });
      return;
    }
    const body = await readJson(response);
    if (!aliveRef.current) return;
    notifyAuth(response.status);
    let result: FieldsOutcome;
    if (response.ok) {
      try {
        result = { kind: 'ok', list: parseFieldList(body) };
      } catch {
        result = { kind: 'unreadable' };
      }
    } else {
      result = { kind: 'http', status: response.status, code: serverErrorCode(body) };
    }
    dispatch({ type: 'fields/result', id, request, result });
  }, [fetchFn]);

  const loadFieldsRef = useRef(loadFields);
  loadFieldsRef.current = loadFields;

  useEffect(() => {
    // 작업을 (다시) 조회하면 C 후보의 필드 목록을 한 번만 새로 받는다. 실패는 사용자가 다시 요청한다.
    if (state.loadSeq === 0) return;
    const current = stateRef.current;
    if (!current.snapshot) return;
    for (const [id, draft] of current.drafts) {
      if (draft.mode !== 'C') continue;
      if (current.fieldLists.has(id)) continue;
      void loadFieldsRef.current(id);
    }
  }, [state.loadSeq]);

  async function preview(id: string, draftAtRequest?: Draft): Promise<void> {
    const plan = planPreview(state, csrfToken, id, draftAtRequest, activeRef.current !== null);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    if (plan.kind === 'draft-notice') {
      dispatch({ type: 'draft/notice', id, message: plan.message });
      return;
    }
    const owner = begin();
    dispatch({ type: 'request/start' });
    let response: Response;
    try {
      response = await fetchFn(`/api/v1/tasks/${encodeURIComponent(plan.taskId)}/disclosure-previews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
          'Idempotency-Key': newIdempotencyKey(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expected_revision: plan.request.revision,
          candidate_id: plan.request.candidateId,
          representation: toWireRepresentation(plan.representation),
        }),
      });
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'draft/preview-result', id, request: plan.request, result: { kind: 'network' } });
      return;
    }
    const body = await readJson(response);
    if (seqRef.current !== owner) return;
    let result: PreviewOutcome;
    if (response.ok) {
      try {
        result = { kind: 'ok', preview: parsePreview(body) };
      } catch {
        result = { kind: 'unreadable' };
      }
    } else {
      notifyAuth(response.status);
      result = { kind: 'http', status: response.status, code: serverErrorCode(body) };
    }
    release(owner);
    dispatch({ type: 'request/end' });
    dispatch({ type: 'draft/preview-result', id, request: plan.request, result });
  }

  async function interpret(id: string): Promise<void> {
    const plan = planInterpret(state, csrfToken, id, activeRef.current !== null);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    if (plan.kind === 'draft-notice') {
      dispatch({ type: 'draft/notice', id, message: plan.message });
      return;
    }
    const owner = begin();
    dispatch({ type: 'request/start' });
    let response: Response;
    try {
      response = await fetchFn(`/api/v1/tasks/${encodeURIComponent(plan.taskId)}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
          'Idempotency-Key': newIdempotencyKey(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expected_revision: plan.request.revision,
          kind: 'interpret_disclosure',
          arguments: { candidate_id: id, text: plan.text },
        }),
      });
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'draft/job-result', id, usage: 'interpret', request: plan.request, result: { kind: 'network' } });
      return;
    }
    const body = await readJson(response);
    if (seqRef.current !== owner) return;
    let result: JobOutcome;
    if (response.ok) {
      try {
        result = { kind: 'ok', job: parseJob(body) };
      } catch {
        result = { kind: 'unreadable' };
      }
    } else {
      notifyAuth(response.status);
      result = { kind: 'http', status: response.status, code: serverErrorCode(body) };
    }
    release(owner);
    dispatch({ type: 'request/end' });
    dispatch({ type: 'draft/job-result', id, usage: 'interpret', request: plan.request, result });
  }

  async function refreshInterpretation(id: string): Promise<void> {
    const plan = planRefreshInterpretation(state, id, activeRef.current !== null);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    if (plan.kind === 'draft-notice') {
      dispatch({ type: 'draft/notice', id, message: plan.message });
      return;
    }
    const owner = begin();
    dispatch({ type: 'request/start' });
    let response: Response;
    try {
      response = await fetchFn(`/api/v1/jobs/${encodeURIComponent(plan.jobId)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'draft/job-result', id, usage: 'refresh', request: plan.request, result: { kind: 'network' } });
      return;
    }
    const body = await readJson(response);
    if (seqRef.current !== owner) return;
    let result: JobOutcome;
    if (response.ok) {
      try {
        result = { kind: 'ok', job: parseJob(body) };
      } catch {
        result = { kind: 'unreadable' };
      }
    } else {
      notifyAuth(response.status);
      result = { kind: 'http', status: response.status, code: serverErrorCode(body) };
    }
    release(owner);
    dispatch({ type: 'request/end' });
    dispatch({ type: 'draft/job-result', id, usage: 'refresh', request: plan.request, result });
  }

  async function apply(): Promise<void> {
    const plan = planApply(state, csrfToken, activeRef.current !== null);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    const previous = lastBatchRef.current;
    let key: string;
    if (previous && previous.taskId === plan.taskId && previous.body === plan.body) {
      key = previous.key;
    } else {
      key = newIdempotencyKey();
      lastBatchRef.current = { taskId: plan.taskId, body: plan.body, key };
    }
    const owner = begin();
    dispatch({ type: 'request/start' });
    let response: Response;
    try {
      response = await fetchFn(`/api/v1/tasks/${encodeURIComponent(plan.taskId)}/decision-batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken,
          'Idempotency-Key': key,
        },
        credentials: 'same-origin',
        body: plan.body,
      });
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'batch/network-error' });
      return;
    }
    const body = await readJson(response);
    // 요청 중에 새 작업 조회가 시작·완료됐으면 늦은 결과로 현재 화면을 덮지 않는다.
    if (seqRef.current !== owner) return;
    release(owner);
    dispatch({ type: 'request/end' });
    if (!response.ok) {
      lastBatchRef.current = null;
      notifyAuth(response.status);
      if (response.status === 409) {
        dispatch({ type: 'batch/conflict' });
      } else {
        dispatch({ type: 'batch/failed', status: response.status, code: serverErrorCode(body) });
      }
      return;
    }
    lastBatchRef.current = null;
    // 배치 결과 이후에도 현재 작업 조회를 권위로 삼아 화면을 갱신한다.
    dispatch({ type: 'batch/sent' });
    await loadTask(plan.taskId);
  }

  async function revoke(decisionId: string): Promise<void> {
    const plan = planRevoke(state, csrfToken, decisionId, activeRef.current !== null);
    if (plan.kind === 'notice') {
      dispatch({ type: 'notice', message: plan.message });
      return;
    }
    const owner = begin();
    dispatch({ type: 'request/start' });
    let response: Response;
    try {
      response = await fetchFn(
        `/api/v1/tasks/${encodeURIComponent(plan.taskId)}/decisions/${encodeURIComponent(plan.decisionId)}/revoke`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-Token': csrfToken,
            'Idempotency-Key': newIdempotencyKey(),
          },
          credentials: 'same-origin',
          body: JSON.stringify({ expected_revision: plan.revision }),
        },
      );
    } catch {
      if (seqRef.current !== owner) return;
      release(owner);
      dispatch({ type: 'request/end' });
      dispatch({ type: 'revoke/network-error' });
      return;
    }
    const body = await readJson(response);
    if (seqRef.current !== owner) return;
    release(owner);
    dispatch({ type: 'request/end' });
    if (!response.ok) {
      notifyAuth(response.status);
      if (response.status === 409) {
        dispatch({ type: 'revoke/conflict' });
      } else {
        dispatch({ type: 'revoke/failed', status: response.status, code: serverErrorCode(body) });
      }
      return;
    }
    // 철회 뒤에는 과거 허용을 자동으로 되살리지 않고 작업 조회를 권위로 삼는다.
    dispatch({ type: 'revoke/sent' });
    await loadTask(plan.taskId);
  }

  return {
    snapshot: state.snapshot,
    drafts: state.drafts,
    busy: state.busy,
    message: state.message,
    writeBlockReason: writeBlockReason(state, csrfToken),
    batchBlockReason: batchBlockReason(state, csrfToken),
    canGenerate: canGenerate(state),
    fields: state.fieldLists,
    loadTask,
    clearTask: (): void => {
      dispatch({ type: 'task/clear' });
    },
    loadFields,
    chooseDisposition: (id: string, disposition: Disposition | null): void => {
      dispatch({ type: 'draft/select', id, disposition });
    },
    chooseMode: (id: string, mode: Mode): Draft | null => {
      const candidate = state.snapshot?.candidates.find((item) => item.id === id) ?? null;
      dispatch({ type: 'draft/mode', id, mode });
      // C는 서버 필드 목록이 있어야 필드를 고를 수 있다. 선택 자체가 조회 계기다.
      if (mode === 'C') void loadFieldsRef.current(id);
      return candidate ? withMode(candidate, state.drafts.get(id) ?? blankDraft(), mode, state.snapshot?.evidence ?? []) : null;
    },
    toggleField: (id: string, field: string, checked: boolean): Draft | null => {
      dispatch({ type: 'fields/toggle', id, field, checked });
      const entry = state.fieldLists.get(id);
      const draft = state.drafts.get(id) ?? blankDraft();
      if (!entry || entry.status !== 'ready' || draft.mode !== 'C' || !entry.fields.includes(field)) return null;
      return withFieldSelection(draft, entry, field, checked);
    },
    setCondition: (id: string, text: string): void => {
      dispatch({ type: 'draft/condition', id, text });
    },
    setReusable: (id: string, value: boolean): void => {
      dispatch({ type: 'draft/reusable', id, value });
    },
    preview,
    interpret,
    refreshInterpretation,
    apply,
    revoke,
  };
}
