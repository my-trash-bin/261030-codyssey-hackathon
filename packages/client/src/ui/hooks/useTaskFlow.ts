// 작업 만들기와 분석 job. 세션의 CSRF 토큰이 있어야 하며, 만든 작업은 공개 결정 영역이 바로 조회한다.
// 작업을 만들고 원자료를 첫 판본으로 등록한 뒤, 분석 job을 시작해 800ms 간격으로 상태를 폴링한다.
// 폴링은 3분 상한을 두고, 화면이 사라지면 늦은 상태 갱신을 막는다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { toWireSources } from '../../analysis-state.ts';
import type { WireSource } from '../../analysis-state.ts';
import { cancelAnalysis, createTask, readAnalysisJob, replaceSources, startAnalysis, taskFailureMessage } from '../../task-client.ts';

export interface TaskFlowOptions {
  csrfToken: string | null;
  onTaskLoaded: (id: string) => void;
}

export interface TaskFlowApi {
  purpose: string;
  recipient: string;
  setPurpose: (value: string) => void;
  setRecipient: (value: string) => void;
  invalidField: 'purpose' | 'recipient' | null;
  files: File[];
  setFiles: (files: File[]) => void;
  clearFilesSignal: number;
  busy: boolean;
  status: string;
  currentTask: { id: string; revision: number } | null;
  analysisBusy: boolean;
  noteSessionOpened: () => void;
  create: () => void;
  startJob: () => void;
  cancelJob: () => void;
}

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export function useTaskFlow(options: TaskFlowOptions): TaskFlowApi {
  const [purpose, setPurposeState] = useState('');
  const [recipient, setRecipientState] = useState('');
  const [invalidField, setInvalidField] = useState<'purpose' | 'recipient' | null>(null);
  const [files, setFilesState] = useState<File[]>([]);
  const [clearFilesSignal, setClearFilesSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('세션을 열면 작업을 만들 수 있습니다.');
  const [currentTask, setCurrentTask] = useState<{ id: string; revision: number } | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);

  const purposeRef = useRef('');
  const recipientRef = useRef('');
  const filesRef = useRef<File[]>([]);
  const busyRef = useRef(false);
  const analysisBusyRef = useRef(false);
  const currentTaskRef = useRef<{ id: string; revision: number } | null>(null);
  const analysisJobRef = useRef<{ id: string; revision: number } | null>(null);
  const aliveRef = useRef(true);
  const csrfTokenRef = useRef<string | null>(options.csrfToken);
  csrfTokenRef.current = options.csrfToken;
  const onTaskLoadedRef = useRef(options.onTaskLoaded);
  onTaskLoadedRef.current = options.onTaskLoaded;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const setPurpose = useCallback((value: string): void => {
    purposeRef.current = value;
    setPurposeState(value);
    if (invalidField === null) return;
    setInvalidField(null);
    setStatus('');
  }, [invalidField]);

  const setRecipient = useCallback((value: string): void => {
    recipientRef.current = value;
    setRecipientState(value);
    if (invalidField === null) return;
    setInvalidField(null);
    setStatus('');
  }, [invalidField]);

  const setFiles = useCallback((next: File[]): void => {
    filesRef.current = next;
    setFilesState(next);
  }, []);

  const noteSessionOpened = useCallback((): void => {
    setStatus('목적·수신처와 원자료를 넣고 작업을 만드세요.');
  }, []);

  const create = useCallback((): void => {
    if (busyRef.current) return;
    const token = csrfTokenRef.current;
    if (!token) {
      setStatus('세션을 먼저 여세요. 작업 생성과 원자료 등록은 인증된 세션에서만 됩니다.');
      return;
    }
    const submittedPurpose = purposeRef.current.trim();
    const submittedRecipient = recipientRef.current.trim();
    if (submittedPurpose === '') {
      setStatus('전달 목적을 입력하세요.');
      setInvalidField('purpose');
      return;
    }
    if (submittedRecipient === '') {
      setStatus('수신처를 입력하세요.');
      setInvalidField('recipient');
      return;
    }
    const selected = filesRef.current;
    busyRef.current = true;
    setBusy(true);
    setStatus('원자료를 읽는 중입니다…');
    void (async (): Promise<void> => {
      try {
        let sources: WireSource[];
        try {
          sources = await toWireSources(selected, crypto.subtle);
        } catch (error) {
          if (!aliveRef.current) return;
          setStatus(error instanceof Error ? error.message : '원자료를 읽지 못했습니다.');
          return;
        }
        if (!aliveRef.current) return;
        setStatus('작업을 만드는 중입니다…');
        const created = await createTask(fetch, token, { purpose: submittedPurpose, recipient: submittedRecipient });
        if (!aliveRef.current) return;
        if (!created.ok) {
          setStatus(taskFailureMessage(created.failure));
          return;
        }
        setStatus('원자료를 등록하는 중입니다…');
        const registered = await replaceSources(fetch, token, created.value.id, created.value.revision, sources);
        if (!aliveRef.current) return;
        if (!registered.ok) {
          setStatus(`작업 ${created.value.id}은(는) 만들어졌지만 원자료 등록에 실패했습니다. ${taskFailureMessage(registered.failure)}`);
          return;
        }
        filesRef.current = [];
        setFilesState([]);
        setClearFilesSignal((count) => count + 1);
        const task = { id: registered.value.id, revision: registered.value.revision };
        currentTaskRef.current = task;
        setCurrentTask(task);
        setStatus(`작업 ${created.value.id}을(를) 만들고 원자료 ${sources.length}개를 판본 ${registered.value.revision}에 등록했습니다. 분석 시작을 누르면 후보를 만듭니다.`);
        await onTaskLoadedRef.current(registered.value.id);
      } finally {
        if (!aliveRef.current) return;
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, []);

  const startJob = useCallback((): void => {
    const task = currentTaskRef.current;
    const token = csrfTokenRef.current;
    if (analysisBusyRef.current || !task || !token) return;
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    void (async (): Promise<void> => {
      try {
        setStatus('분석 job을 시작하는 중입니다…');
        const started = await startAnalysis(fetch, token, task.id, task.revision);
        if (!aliveRef.current) return;
        if (!started.ok) {
          setStatus(taskFailureMessage(started.failure));
          return;
        }
        analysisJobRef.current = { id: started.value.id, revision: started.value.revision };
        const running = { id: task.id, revision: started.value.revision };
        currentTaskRef.current = running;
        setCurrentTask(running);
        setStatus('분석 job이 실행 중입니다…');
        const waitStart = Date.now();
        for (;;) {
          await sleep(800);
          if (!aliveRef.current) return;
          const polled = await readAnalysisJob(fetch, token, task.id, started.value.id);
          if (!aliveRef.current) return;
          if (!polled.ok) {
            setStatus(taskFailureMessage(polled.failure));
            return;
          }
          const job = polled.value;
          const seconds = Math.round((Date.now() - waitStart) / 1000);
          if (job.status === 'running') {
            if (seconds > 180) {
              setStatus('3분이 지났지만 분석이 끝나지 않았습니다. 분석 취소를 누르거나 상태를 다시 확인하세요.');
              return;
            }
            setStatus(`분석 job이 실행 중입니다… ${seconds}초`);
            continue;
          }
          analysisJobRef.current = null;
          if (job.status === 'succeeded') {
            setStatus('분석이 끝났습니다. 공개 결정 영역에서 후보를 확인하세요.');
            const done = { id: task.id, revision: job.revision };
            currentTaskRef.current = done;
            setCurrentTask(done);
            await onTaskLoadedRef.current(task.id);
            return;
          }
          setStatus(job.status === 'failed'
            ? `분석이 실패했습니다.${job.errorCode === null ? '' : ` (${job.errorCode})`} 원자료와 분석 모델 설정을 확인하세요.`
            : job.status === 'cancelled'
              ? '분석이 취소되었습니다. 다시 시작할 수 있습니다.'
              : '원자료가 바뀌어 분석 결과가 무효가 되었습니다. 원자료를 다시 등록한 뒤 시작하세요.');
          return;
        }
      } finally {
        if (!aliveRef.current) return;
        analysisBusyRef.current = false;
        setAnalysisBusy(false);
      }
    })();
  }, []);

  const cancelJob = useCallback((): void => {
    const task = currentTaskRef.current;
    const job = analysisJobRef.current;
    const token = csrfTokenRef.current;
    if (!task || !job || !token) return;
    void (async (): Promise<void> => {
      const result = await cancelAnalysis(fetch, token, task.id, job.id, job.revision);
      if (!aliveRef.current) return;
      setStatus(result.ok
        ? result.value.cancelled ? '분석 취소를 요청했습니다. 실행이 멈추면 상태가 취소로 바뀝니다.' : '이미 끝난 분석이라 취소되지 않았습니다.'
        : taskFailureMessage(result.failure));
    })();
  }, []);

  return {
    purpose,
    recipient,
    setPurpose,
    setRecipient,
    invalidField,
    files,
    setFiles,
    clearFilesSignal,
    busy,
    status,
    currentTask,
    analysisBusy,
    noteSessionOpened,
    create,
    startJob,
    cancelJob,
  };
}
