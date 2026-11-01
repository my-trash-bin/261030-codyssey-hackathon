import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { cancelAnalysis, readAnalysisJob, readTask, startAnalysis } from '../../task-client.ts';
import type { AnalysisJobState, TaskFailure, TaskSourceInfo } from '../../task-client.ts';
import { defaultFetch, sleep } from '../../task-flow-model.ts';
import type { SelectedTask } from '../../task-flow-model.ts';
type Ref<T> = { current: T };
interface Options { analysisBusy: boolean; analysisBusyRef: Ref<boolean>; busyRef: Ref<boolean>; cancelBusyRef: Ref<boolean>;
 csrfToken: string | null; epochRef: Ref<number>; fail: (failure: TaskFailure) => void; isCurrent: (epoch: number) => boolean;
 job: AnalysisJobState | null; jobRef: Ref<AnalysisJobState | null>; loadTask: (id: string) => Promise<void>;
 refreshSources: (id: string, epoch: number) => Promise<void>; report: (message: string) => void;
 selected: SelectedTask | null; selectedRef: Ref<SelectedTask | null>; setAnalysisBusy: Dispatch<SetStateAction<boolean>>;
 setBusy: Dispatch<SetStateAction<boolean>>; setCancelBusy: Dispatch<SetStateAction<boolean>>;
 setJob: Dispatch<SetStateAction<AnalysisJobState | null>>; setTaskPhase: Dispatch<SetStateAction<string | null>>;
 sources: TaskSourceInfo[]; sourcesRef: Ref<TaskSourceInfo[]>; tokenRef: Ref<string | null>; }
export function useTaskAnalysisActions(options: Options) {
 const { analysisBusy, analysisBusyRef, busyRef, cancelBusyRef, csrfToken, epochRef, fail, isCurrent, job, jobRef,
  loadTask, refreshSources, report, selected, selectedRef, setAnalysisBusy, setBusy, setCancelBusy, setJob,
  setTaskPhase, sources, sourcesRef, tokenRef } = options;
  const pollJob = useCallback((taskId: string, jobId: string, epoch: number): void => {
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    const startedAt = Date.now();
    void (async (): Promise<void> => {
      try {
        for (;;) {
          await sleep(800);
          if (!isCurrent(epoch)) return;
          const token = tokenRef.current;
          if (!token) return;
          const polled = await readAnalysisJob(defaultFetch, token, taskId, jobId);
          if (!isCurrent(epoch)) return;
          if (!polled.ok) {
            fail(polled.failure);
            return;
          }
          const value = polled.value;
          jobRef.current = value;
          setJob(value);
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          if (value.status === 'running' || value.status === 'cancel_requested') {
            if (seconds > 180) {
              report('3분이 지나 상태 확인을 멈췄습니다. 상태 재확인으로 이어 보거나 분석 취소를 누르세요.');
              return;
            }
            report(value.status === 'cancel_requested'
              ? `분석 취소를 요청했습니다. 서버가 멈추기를 기다리는 중입니다… ${seconds}초`
              : `분석 job이 실행 중입니다… ${seconds}초`);
            continue;
          }
          jobRef.current = null;
          setJob(null);
          if (value.status === 'succeeded') {
            report('분석이 끝났습니다. 공개 결정 단계에서 후보를 확인하세요.');
            await loadTask(taskId);
            return;
          }
          report(value.status === 'failed'
            ? `분석이 실패했습니다.${value.errorCode === null ? '' : ` (${value.errorCode})`} 원자료와 분석 환경 설정을 확인하세요.`
            : value.status === 'cancelled'
              ? '분석이 취소되었습니다. 원자료를 그대로 두고 다시 시작할 수 있습니다.'
              : '원자료나 판본이 바뀌어 분석 결과가 무효가 되었습니다. 최신 상태를 다시 확인하세요.');
          return;
        }
      } finally {
        if (isCurrent(epoch)) {
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, fail]);

  const startJob = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (analysisBusyRef.current || !task || !token) return;
    const activeJob = jobRef.current;
    if (activeJob !== null && (activeJob.status === 'running' || activeJob.status === 'cancel_requested')) {
      report('이미 실행 중인 분석이 있습니다. 상태 재확인이나 분석 취소를 먼저 이용하세요.');
      return;
    }
    if (!sourcesRef.current.some((source) => source.included)) {
      report('등록된 원자료가 없습니다. 원자료를 먼저 등록하세요.');
      return;
    }
    const epoch = epochRef.current;
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    let handedOff = false;
    void (async (): Promise<void> => {
      try {
        report('분석을 시작하는 중입니다…');
        const started = await startAnalysis(defaultFetch, token, task.id, task.revision);
        if (!isCurrent(epoch)) return;
        if (!started.ok) {
          fail(started.failure);
          return;
        }
        jobRef.current = started.value;
        setJob(started.value);
        // job 시작은 작업 판본을 올린다. snapshot 판본을 먼저 맞춘 뒤 poll을 잇는다.
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        handedOff = true;
        pollJob(task.id, started.value.id, epoch);
      } finally {
        if (isCurrent(epoch) && !handedOff) {
          analysisBusyRef.current = false;
          setAnalysisBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, pollJob, fail]);

  const cancelJob = useCallback((): void => {
    const task = selectedRef.current;
    const jobState = jobRef.current;
    const token = tokenRef.current;
    if (!task || !jobState || !token || cancelBusyRef.current) return;
    cancelBusyRef.current = true;
    setCancelBusy(true);
    const epoch = epochRef.current;
    void (async (): Promise<void> => {
      try {
        const result = await cancelAnalysis(defaultFetch, token, task.id, jobState.id, task.revision);
        if (!isCurrent(epoch)) return;
        if (!result.ok) {
          fail(result.failure);
          return;
        }
        if (result.value.requested) {
          const requested = { ...jobState, status: 'cancel_requested' as const };
          jobRef.current = requested;
          setJob(requested);
          report('분석 취소를 요청했습니다. 서버가 멈추면 상태가 취소로 바뀝니다.');
          if (!analysisBusyRef.current) pollJob(task.id, jobState.id, epoch);
          return;
        }
        jobRef.current = null;
        setJob(null);
        report('이미 끝난 분석이라 취소 요청이 접수되지 않았습니다. 상태 재확인으로 최신 결과를 확인하세요.');
      } finally {
        if (isCurrent(epoch)) {
          cancelBusyRef.current = false;
          setCancelBusy(false);
        }
      }
    })();
  }, [isCurrent, pollJob, fail]);

  const recheck = useCallback((): void => {
    const task = selectedRef.current;
    const token = tokenRef.current;
    if (!task || !token || busyRef.current) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    setBusy(true);
    void (async (): Promise<void> => {
      try {
        const meta = await readTask(defaultFetch, token, task.id);
        if (!isCurrent(epoch)) return;
        if (!meta.ok) {
          fail(meta.failure);
          return;
        }
        setTaskPhase(meta.value.phase);
        await loadTask(task.id);
        if (!isCurrent(epoch)) return;
        await refreshSources(task.id, epoch);
        if (!isCurrent(epoch)) return;
        if (meta.value.currentJobId !== null && meta.value.phase === 'processing' && !analysisBusyRef.current) {
          const running: AnalysisJobState = {
            id: meta.value.currentJobId,
            revision: meta.value.revision,
            status: meta.value.cancellationRequested ? 'cancel_requested' : 'running',
            errorCode: null,
          };
          jobRef.current = running;
          setJob(running);
          report('서버에서 실행 중인 분석을 찾았습니다. 상태를 이어서 확인합니다.');
          pollJob(task.id, meta.value.currentJobId, epoch);
          return;
        }
        report(meta.value.phase === null
          ? `작업 ${task.id} 판본 ${meta.value.revision}을 서버에서 확인했습니다.`
          : `작업 ${task.id} 판본 ${meta.value.revision} · 단계 ${meta.value.phase}`);
      } finally {
        if (isCurrent(epoch)) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    })();
  }, [isCurrent, loadTask, pollJob, refreshSources, fail]);

  const canStart = selected !== null
    && sources.some((source) => source.included)
    && !analysisBusy
    && (job === null || (job.status !== 'running' && job.status !== 'cancel_requested'))
    && csrfToken !== null;

  return { canStart, startJob, recheck, cancelJob };
}
