// 공개 결정 화면의 상태와 명령. React reducer가 상태의 단일 원천이고, 이 훅은 요청 수명만 다룬다.
// 요청 소유권(세대 번호)·멱등 재시도 키는 요청 수명 메타데이터라 ref에 두고, 화면 상태는 reducer에만 있다.
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { newIdempotencyKey, parseJob, parsePreview, parseSnapshot, serverErrorCode, toWireRepresentation } from '../../disclosure-contract.ts';
import type { Mode, Disposition, Draft, Snapshot } from '../../disclosure-contract.ts';
import { blankDraft, disclosuresReducer, initialDisclosuresState, withMode } from '../../disclosure-state.ts';
import type { BatchRetry, JobOutcome, PreviewOutcome } from '../../disclosure-state.ts';
import { batchBlockReason, canGenerate, planApply, planInterpret, planLoadTask, planPreview, planRefreshInterpretation, planRevoke, writeBlockReason } from '../../disclosure-selectors.ts';

export interface DisclosuresApi {
  readonly snapshot: Snapshot | null;
  readonly drafts: ReadonlyMap<string, Draft>;
  readonly busy: boolean;
  readonly message: string;
  readonly acceptScopeReduction: boolean;
  readonly writeBlockReason: string;
  readonly batchBlockReason: string;
  readonly canGenerate: boolean;
  loadTask(id: string): Promise<void>;
  chooseDisposition(id: string, disposition: Disposition | null): void;
  /** 다음 초안을 함께 돌려준다. 같은 tick에서 미리보기를 이어 부를 때 렌더 지연 없이 쓴다. */
  chooseMode(id: string, mode: Mode): Draft | null;
  setCondition(id: string, text: string): void;
  setReusable(id: string, value: boolean): void;
  setScopeReduction(value: boolean): void;
  preview(id: string, draftAtRequest?: Draft): Promise<void>;
  interpret(id: string): Promise<void>;
  refreshInterpretation(id: string): Promise<void>;
  apply(): Promise<void>;
  revoke(decisionId: string): Promise<void>;
}

function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useDisclosures(options: { csrfToken: string | null; fetch?: typeof fetch }): DisclosuresApi {
  const [state, dispatch] = useReducer(disclosuresReducer, initialDisclosuresState);
  const csrfToken = options.csrfToken ?? '';
  const fetchFn = options.fetch ?? defaultFetch;
  const seqRef = useRef(0);
  // 진행 중인 요청의 소유자. 같은 tick에 두 번 눌러도 두 번째 요청을 보내지 않도록 전송 전에 잡는다.
  const activeRef = useRef<number | null>(null);
  const lastBatchRef = useRef<BatchRetry | null>(null);
  const handledReloadRef = useRef(0);

  useEffect(() => () => {
    // 언마운트 뒤 도착한 응답이 상태를 건드리지 않도록 요청 세대를 올리고 점유를 비운다.
    seqRef.current += 1;
    activeRef.current = null;
  }, []);

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
    acceptScopeReduction: state.acceptScopeReduction,
    writeBlockReason: writeBlockReason(state, csrfToken),
    batchBlockReason: batchBlockReason(state, csrfToken),
    canGenerate: canGenerate(state),
    loadTask,
    chooseDisposition: (id: string, disposition: Disposition | null): void => {
      dispatch({ type: 'draft/select', id, disposition });
    },
    chooseMode: (id: string, mode: Mode): Draft | null => {
      const candidate = state.snapshot?.candidates.find((item) => item.id === id) ?? null;
      dispatch({ type: 'draft/mode', id, mode });
      return candidate ? withMode(candidate, state.drafts.get(id) ?? blankDraft(), mode) : null;
    },
    setCondition: (id: string, text: string): void => {
      dispatch({ type: 'draft/condition', id, text });
    },
    setReusable: (id: string, value: boolean): void => {
      dispatch({ type: 'draft/reusable', id, value });
    },
    setScopeReduction: (value: boolean): void => {
      dispatch({ type: 'scope/reduction', value });
    },
    preview,
    interpret,
    refreshInterpretation,
    apply,
    revoke,
  };
}
