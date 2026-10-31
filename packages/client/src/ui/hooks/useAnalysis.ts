// 파일 분석 상태의 React 훅. 상태는 analysisReducer가 유일한 원천이고, 이 훅은
// 파일 읽기·분석 요청·요청 소유권 같은 비동기 수명만 useRef로 다룬다.
//
// 요청 소유권: 가장 최근에 시작한 요청만 busy·message·result를 바꾼다. 취소·입력 변경·
// 언마운트는 진행 중 요청의 소유권을 지우고 AbortController로 중단하며, 늦게 도착한
// 응답은 상태를 건드리지 않는다.

import { useEffect, useReducer, useRef } from 'react';
import type { AnalysisProblem, AnalysisResult, AnalysisSource } from '../../analysis-state.ts';
import {
  INVALID_RESPONSE_MESSAGE,
  MAX_BODY_BYTES,
  NETWORK_MESSAGE,
  NO_SUBTLE_MESSAGE,
  analysisHttpFailure,
  parseResult,
  readSources,
  serverErrorCode,
  toWireSource,
  validateAnalysisInput,
} from '../../analysis-state.ts';
import { analysisReducer, initialAnalysisState, resultIsCurrentOf } from '../../analysis-reducer.ts';

export interface AnalysisApi {
  readonly files: readonly File[];
  readonly purpose: string;
  readonly recipient: string;
  readonly consent: boolean;
  readonly busy: boolean;
  readonly message: string;
  readonly problem: AnalysisProblem | null;
  readonly result: AnalysisResult | null;
  readonly resultIsCurrent: boolean;
  setFiles(files: readonly File[]): void;
  setContext(purpose: string, recipient: string): void;
  setConsent(consent: boolean): void;
  cancel(): void;
  run(): Promise<void>;
}

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useAnalysis(options?: { csrfToken?: string | null; fetch?: typeof fetch }): AnalysisApi {
  const [state, dispatch] = useReducer(analysisReducer, initialAnalysisState);
  // 운영자가 세션 경계를 켠 서버에서만 /api/analysis가 쓰기 경계 안에 든다(packages/server/src/app.ts의
  // GUARDED_PATHS, sessions 옵션). 세션이 있으면 그 응답의 CSRF 토큰을 그대로 쓰고, 없으면 보내지 않는다.
  const csrfToken = options?.csrfToken ?? '';
  // 요청 수명에만 쓰는 참조. 상태 자체를 복제하지 않는다.
  const ownerRef = useRef(0);
  const activeRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
  const fetchFn = options?.fetch ?? defaultFetch;

  useEffect(() => () => {
    activeRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // 진행 중인 요청을 중단한다. 요청이 없으면 이미 표시 중인 메시지를 지우지 않는다.
  function abortActive(): void {
    if (activeRef.current === null) return;
    activeRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }

  function owns(owner: number): boolean {
    return activeRef.current === owner;
  }

  function releaseController(controller: AbortController): void {
    if (controllerRef.current === controller) controllerRef.current = null;
  }

  function setFiles(files: readonly File[]): void {
    if (files.length === state.files.length && files.every((file, index) => file === state.files[index])) return;
    abortActive();
    dispatch({ type: 'files', files: [...files] });
  }

  function setContext(purpose: string, recipient: string): void {
    if (purpose === state.purpose && recipient === state.recipient) return;
    abortActive();
    dispatch({ type: 'context', purpose, recipient });
  }

  function setConsent(consent: boolean): void {
    if (consent === state.consent) return;
    if (!consent) abortActive();
    dispatch({ type: 'consent', consent });
  }

  function cancel(): void {
    abortActive();
    dispatch({ type: 'cancel' });
  }

  async function run(): Promise<void> {
    if (activeRef.current !== null) {
      dispatch({ type: 'reentry' });
      return;
    }
    const invalid = validateAnalysisInput({
      files: state.files,
      purpose: state.purpose,
      recipient: state.recipient,
      consent: state.consent,
    });
    if (invalid) {
      dispatch({ type: 'invalid', problem: invalid });
      return;
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      dispatch({ type: 'invalid', problem: { field: 'request', message: NO_SUBTLE_MESSAGE } });
      return;
    }
    const files = state.files;
    const purpose = state.purpose;
    const recipient = state.recipient;
    const inputSeq = state.inputSeq;
    const owner = ++ownerRef.current;
    activeRef.current = owner;
    dispatch({ type: 'begin' });

    let sources: AnalysisSource[];
    try {
      sources = await readSources(files, subtle);
    } catch (error) {
      if (!owns(owner)) return;
      activeRef.current = null;
      const candidate = error instanceof Error ? error.message : '파일을 읽지 못했습니다.';
      const hasFileDetail = candidate.startsWith('지원하지 않는') || candidate.startsWith('파일을 읽지') ||
        candidate.startsWith('UTF-8');
      const message = hasFileDetail ? candidate : `파일을 읽지 못했습니다: ${candidate}`;
      dispatch({ type: 'invalid', problem: { field: 'files', message } });
      return;
    }
    if (!owns(owner)) return;

    const wire = sources.map(toWireSource);
    const serialized = JSON.stringify({ task: { purpose, recipient }, sources: wire });
    if (new TextEncoder().encode(serialized).length > MAX_BODY_BYTES) {
      activeRef.current = null;
      dispatch({
        type: 'invalid',
        problem: { field: 'files', message: '선택한 파일의 전송 본문이 1.5MiB를 넘습니다. 파일 수나 크기를 줄이세요.' },
      });
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    // 세션이 열린 화면에서만 CSRF 토큰을 싣는다. 워크플로 경계를 켜지 않은 서버는 legacy
    // 라우트를 그대로 열어 두므로(packages/server/src/app.ts의 sessions 옵션) 요청을 막지 않는다.
    if (csrfToken !== '') headers['X-CSRF-Token'] = csrfToken;
    let response: Response;
    try {
      response = await fetchFn('/api/analysis', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: serialized,
        signal: controller.signal,
      });
    } catch {
      if (!owns(owner)) return;
      activeRef.current = null;
      releaseController(controller);
      dispatch({ type: 'fail', message: NETWORK_MESSAGE });
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    if (!owns(owner)) return;
    activeRef.current = null;
    releaseController(controller);
    if (!response.ok) {
      dispatch({ type: 'fail', message: analysisHttpFailure(response.status, serverErrorCode(body)) });
      return;
    }
    let result: AnalysisResult;
    try {
      result = parseResult(body, { purpose, recipient }, sources);
    } catch {
      dispatch({ type: 'fail', message: INVALID_RESPONSE_MESSAGE });
      return;
    }
    dispatch({ type: 'settle', result, inputSeq });
  }

  return {
    files: state.files,
    purpose: state.purpose,
    recipient: state.recipient,
    consent: state.consent,
    busy: state.busy,
    message: state.message,
    problem: state.problem,
    result: state.result,
    resultIsCurrent: resultIsCurrentOf(state),
    setFiles,
    setContext,
    setConsent,
    cancel,
    run,
  };
}
