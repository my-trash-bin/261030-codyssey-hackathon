// 초안 작성/검토 job, DocAST 편집, 사람 의미 검토, 확정과 내보내기까지의 화면 상태.
// 서버가 판본/현재 여부/hash/확정 가능 여부를 판정하고, 이 훅은 그 판정을 그대로 보여 준다.
// 늦은 job 응답과 다른 작업으로 바뀐 응답은 적용하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../disclosure-contract.ts';
import {
  artifactFailureMessage,
  cancelArtifactJob,
  finalizeTask,
  readArtifactFile,
  readArtifactJob,
  readCurrentArtifact,
  readExportBytes,
  readTask,
  recordHumanReview,
  saveDownload,
  sha256Hex,
  startArtifactJob,
} from '../../artifacts-client.ts';
import type {
  ArtifactFileMeta,
  ArtifactJob,
  ArtifactView,
  ExportInfo,
  HumanReviewChecklist,
  TaskAggregate,
} from '../../artifacts-client.ts';
import { newIdempotencyKey } from '../../disclosure-contract.ts';

export interface ArtifactsOptions {
  csrfToken: string | null;
  snapshot: Snapshot | null;
  canGenerate: boolean;
  onTaskChanged: (id: string) => Promise<void>;
  fetch?: typeof fetch;
}

export interface ArtifactsApi {
  readonly taskId: string | null;
  readonly task: TaskAggregate | null;
  readonly artifact: ArtifactView | null;
  readonly job: ArtifactJob | null;
  readonly message: string;
  readonly broadcastMessage: string;
  readonly busy: boolean;
  readonly jobBusy: boolean;
  readonly outOfSync: boolean;
  readonly writeBlockReason: string;
  readonly composeBlockReason: string;
  readonly reviewBlockReason: string;
  readonly humanReviewBlockReason: string;
  readonly finalizeBlockReason: string;
  readonly downloadBlockReason: string;
  readonly goalNotice: string;
  readonly checklist: HumanReviewChecklist;
  readonly fallbackReason: string;

  readonly exportInfo: ExportInfo | null;
  readonly file: { path: string; text: string } | null;
  readonly fileBusy: boolean;
  readonly downloadBusy: string | null;
  setChecklist: (next: HumanReviewChecklist) => void;
  setFallbackReason: (text: string) => void;
  reload: () => void;
  compose: () => void;
  reReview: () => void;
  cancel: () => void;
  recordHumanReview: () => void;
  finalize: () => void;
  openFile: (path: string) => void;
  closeFile: () => void;
  downloadArchive: () => void;
  downloadFile: (path: string) => void;
}

interface State {
  taskId: string | null;
  task: TaskAggregate | null;
  artifact: ArtifactView | null;
  job: ArtifactJob | null;
  message: string;
  busy: boolean;
  jobBusy: boolean;
  checklist: HumanReviewChecklist;
  fallbackReason: string;
  exportInfo: ExportInfo | null;
  file: { path: string; text: string } | null;
  fileBusy: boolean;
  downloadBusy: string | null;
}

const EMPTY_CHECKLIST: HumanReviewChecklist = {
  reviewed_all_files: false,
  approved_facts_only: false,
  uncertainty_preserved: false,
};

const INITIAL_STATE: State = {
  taskId: null,
  task: null,
  artifact: null,
  job: null,
  message: '',
  busy: false,
  jobBusy: false,
  checklist: EMPTY_CHECKLIST,
  fallbackReason: '',
  exportInfo: null,
  file: null,
  fileBusy: false,
  downloadBusy: null,
};

const POLL_INTERVAL_MS = 800;
const POLL_LIMIT_MS = 180000;
const HUMAN_REVIEW_CODES: Record<string, true> = { MODEL_TIMEOUT: true, MODEL_UNAVAILABLE: true };
const JOB_WORD: Record<string, string> = { compose: '초안 작성', review: '검토' };
const LOADING_DRAFT_MESSAGE = '초안 정보를 불러오는 중입니다…';
const MODEL_ERROR_TEXT: Record<string, string> = {
  MODEL_UNAVAILABLE: '모델에 연결하지 못했습니다',
  MODEL_TIMEOUT: '모델 응답 시간이 초과됐습니다',
  MODEL_INVALID_RESPONSE: '모델 응답이 형식에 맞지 않습니다',
  MODEL_BUDGET_EXCEEDED: '모델 호출 한도를 넘었습니다',
  MODEL_CANCELLED: '모델 호출이 취소됐습니다',
};

/** 오류 코드를 사람이 읽는 문구로 바꾼다. 원인 파악을 위해 코드도 함께 남긴다. */
export function modelErrorText(code: string | null): string {
  if (code === null) return '';
  const text = MODEL_ERROR_TEXT[code];
  return text === undefined ? `(${code})` : `${text} (${code}).`;
}

function jobDoneMessage(kind: string, artifact: ArtifactView | null): string {
  const word = kind === 'review' ? '검토를 마쳤습니다.' : '초안을 만들었습니다.';
  const result = artifact?.review?.result;
  if (result === 'pass') return `${word} 자동 검토를 통과했습니다.`;
  if (result === 'needs_changes') return `${word} 자동 검토 결과 수정이 필요합니다. 검토 단계에서 지적 사항을 확인하세요.`;
  if (result === 'needs_decision') return `${word} 공개 결정이 더 필요합니다. 검토 단계에서 지적 사항을 확인하세요.`;
  return `${word} 검토 상태를 확인하세요.`;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

function writeReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
  if (csrfToken === null) return '세션이 닫혀 있습니다. 세션을 다시 여세요.';
  if (snapshot === null) return '작업을 먼저 고르세요.';
  if (state.task === null) return '작업 정보를 불러오는 중입니다.';
  if (snapshot.id !== state.task.id) return '다른 작업 정보가 표시 중입니다. 작업을 다시 불러오세요.';
  if (state.busy) return '다른 요청을 처리하는 중입니다.';
  if (state.jobBusy) return '초안 작성이나 검토가 진행 중입니다. 끝나거나 취소된 뒤 시도하세요.';
  if (snapshot.revision !== state.task.revision) {
    return `화면의 작업 판본 ${snapshot.revision}이(가) 서버 판본 ${state.task.revision}과 다릅니다. 작업을 다시 불러오세요.`;
  }
  return '';
}

function composeReason(
  state: State,
  csrfToken: string | null,
  snapshot: Snapshot | null,
  canGenerate: boolean,
): string {
  const written = writeReason(state, csrfToken, snapshot);
  if (written !== '') return written;
  if (!canGenerate) {
    return '허용 결정이 1개 이상 있고 필수 후보가 모두 허용으로 저장돼야 초안을 만들 수 있습니다. 공개 결정을 먼저 저장하세요.';
  }
  return '';
}

function reviewReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
  const written = writeReason(state, csrfToken, snapshot);
  if (written !== '') return written;
  const artifact = state.artifact;
  const task = state.task;
  if (artifact === null || task === null) return '검토할 초안이 없습니다. 먼저 공유 초안을 만드세요.';
  if (!artifact.isCurrent || artifact.revision !== task.revision) {
    return '이 초안은 공개 결정이 바뀌기 전 판본입니다. 초안을 다시 만드세요.';
  }
  // 자동 검토를 통과하지 못한 초안에는 공개 파일이 없어 서버가 재검토·편집을 거부한다.
  if (artifact.files.length === 0) return '이 초안에는 공개 파일이 없어 다시 검토하거나 편집할 수 없습니다. 초안을 새로 만드세요.';
  return '';
}

function humanReviewReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
  const written = writeReason(state, csrfToken, snapshot);
  if (written !== '') return written;
  const artifact = state.artifact;
  const task = state.task;
  if (artifact === null || task === null) return '사람 검토를 기록할 초안이 없습니다.';
  if (!artifact.isCurrent || artifact.revision !== task.revision) {
    return '이 초안은 공개 결정이 바뀌기 전 판본입니다. 초안을 다시 만드세요.';
  }
  if (artifact.humanReview !== null) return '이미 사람 의미 검토가 기록된 초안입니다.';
  if (artifact.reviewErrorCode === null || HUMAN_REVIEW_CODES[artifact.reviewErrorCode] !== true) {
    return '사람 의미 검토는 모델 연결 실패나 시간 초과로 자동 검토가 끝나지 못한 현재 파일에만 기록할 수 있습니다.';
  }
  if (artifact.hardErrors.length > 0) return '파일 검사 오류가 남아 있어 사람 의미 검토로 대체할 수 없습니다.';
  const allChecked = Object.values(state.checklist).every((value) => value === true);
  if (!allChecked) return '세 검토 항목을 모두 확인해야 합니다.';
  if (state.fallbackReason.trim() === '') return '사람 검토 사유를 입력하세요.';
  return '';
}

function finalizeReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
  const written = writeReason(state, csrfToken, snapshot);
  if (written !== '') return written;
  const artifact = state.artifact;
  const task = state.task;
  if (artifact === null || task === null) return '확정할 초안이 없습니다.';
  if (task.goalVariant === 'reproduction_evidence') {
    return '재현 근거가 목표인 작업은 재현 결과가 있어야 확정할 수 있는데 이 경로에는 그 결과가 없습니다.';
  }
  if (!artifact.isCurrent || artifact.revision !== task.revision) {
    return '이 초안은 공개 결정이 바뀌기 전 판본입니다. 초안을 다시 만드세요.';
  }
  const already = state.exportInfo;
  if (already !== null && already.artifactId === artifact.id && already.artifactSetHash === artifact.artifactSetHash &&
    already.revision === task.revision) {
    return '이미 이 파일들로 확정했습니다.';
  }
  if (!artifact.finalizable) {
    if (artifact.hardErrors.length > 0) {
      return '공개 파일이 아직 만들어지지 않아 확정할 수 없습니다. 자동 검토를 통과하면 파일이 만들어집니다.';
    }
    const reviewed = artifact.review?.result === 'pass' && artifact.reviewTargetHash === artifact.artifactSetHash;
    const human = artifact.humanReview !== null && artifact.humanReview.targetHash === artifact.artifactSetHash;
    if (!reviewed && !human) {
      return artifact.reviewErrorCode !== null
        ? '모델 검토가 실패했습니다. 검토 단계에서 사람 의미 검토를 먼저 기록해야 합니다.'
        : '현재 파일의 자동 검토 통과나 사람 검토 기록이 없습니다. 검토 단계에서 다시 검토하세요.';
    }
    return '정하지 않았거나 보류·만료·철회된 공개 결정이 남아 있어 서버가 확정을 거부합니다.';
  }
  return '';
}

function downloadReason(state: State): string {
  const exportInfo = state.exportInfo;
  if (exportInfo === null) return '확정한 파일이 없습니다. 먼저 현재 파일들로 확정하세요.';
  const artifact = state.artifact;
  const task = state.task;
  if (artifact === null || task === null) return '확정 파일의 초안 정보를 불러오지 못했습니다.';
  if (!artifact.isCurrent || artifact.revision !== task.revision) {
    return '작업 판본이 바뀌어 이 확정 파일은 더 이상 내려받을 수 없습니다.';
  }
  if (exportInfo.artifactId !== artifact.id || exportInfo.artifactSetHash !== artifact.artifactSetHash ||
    exportInfo.revision !== task.revision) {
    return '현재 초안과 확정 파일 집합이 다릅니다. 현재 파일들로 다시 확정하세요.';
  }
  if (state.busy) return '다른 요청을 처리하는 중입니다. 끝난 뒤 내려받으세요.';
  if (state.jobBusy) return '초안 작성이나 검토가 진행 중입니다. 끝나거나 취소된 뒤 내려받으세요.';
  if (state.downloadBusy !== null) return '다운로드를 준비하는 중입니다.';
  return '';
}

export function useArtifacts(options: ArtifactsOptions): ArtifactsApi {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const stateRef = useRef<State>(INITIAL_STATE);
  const aliveRef = useRef(true);
  const taskIdRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const lastSnapshotKeyRef = useRef('');
  const keyCacheRef = useRef(new Map<string, string>());
  // 화면의 새로 고침 응답이 진행 중인 쓰기의 busy 표시를 지우지 않게 한다.
  const mutationRef = useRef(false);
  // 같은 job을 두 개의 poll 루프가 동시에 읽지 않게 한다.
  const pollingRef = useRef<string | null>(null);
  // refresh와 pollJob은 서로를 불러야 하므로 pollJob은 ref로 늦게 연결한다.
  const pollJobRef = useRef<((job: ArtifactJob, label: string) => Promise<void>) | null>(null);
  const fetchFn = options.fetch ?? defaultFetch;
  const csrfTokenRef = useRef<string | null>(options.csrfToken);
  csrfTokenRef.current = options.csrfToken;
  const snapshotRef = useRef<Snapshot | null>(options.snapshot);
  snapshotRef.current = options.snapshot;
  const canGenerateRef = useRef(options.canGenerate);
  canGenerateRef.current = options.canGenerate;
  const onTaskChangedRef = useRef(options.onTaskChanged);
  onTaskChangedRef.current = options.onTaskChanged;

  const commit = useCallback((patch: Partial<State>): void => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      taskIdRef.current = null;
      loadSeqRef.current += 1;
      stateRef.current = INITIAL_STATE;
    };
  }, []);

  const keyFor = useCallback((scope: string, body: unknown): string => {
    const signature = `${scope}:${JSON.stringify(body)}`;
    const existing = keyCacheRef.current.get(signature);
    if (existing !== undefined) return existing;
    const key = newIdempotencyKey();
    if (keyCacheRef.current.size > 32) keyCacheRef.current.clear();
    keyCacheRef.current.set(signature, key);
    return key;
  }, []);

  const applyServerState = useCallback((task: TaskAggregate, artifact: ArtifactView | null): void => {
    const prev = stateRef.current;
    const changed = prev.artifact?.id !== artifact?.id;
    const exportInfo = prev.exportInfo !== null && artifact !== null && prev.exportInfo.artifactId === artifact.id &&
      prev.exportInfo.artifactSetHash === artifact.artifactSetHash && prev.exportInfo.revision === task.revision
      ? prev.exportInfo
      : null;
    // 불러오기 성공은 '불러오는 중' 문구를 지운다. 다만 방금 끝난 동작의 결과 문구는
    // 이 재조회가 덮지 않는다. 동작이 남긴 메시지가 없을 때만 로드 결과를 적는다.
    const loadingMessage = prev.message === '' || prev.message === LOADING_DRAFT_MESSAGE;
    commit({
      taskId: task.id,
      task,
      artifact,
      ...(loadingMessage
        ? {
          message: artifact === null
            ? '아직 공유 초안이 없습니다. 승인된 공개 결정을 저장한 뒤 공유 초안 생성을 누르세요.'
            : '초안을 불러왔습니다.',
        }
        : {}),
      ...(changed
        ? {
          checklist: EMPTY_CHECKLIST,
          fallbackReason: '',
          file: null,
        }
        : {}),
      exportInfo,
      busy: mutationRef.current ? prev.busy : false,
    });
    taskIdRef.current = task.id;
    lastSnapshotKeyRef.current = `${task.id}:${task.revision}`;
  }, [commit]);

  const refresh = useCallback(async (taskId: string): Promise<boolean> => {
    const seq = ++loadSeqRef.current;
    const [taskResult, artifactResult] = await Promise.all([
      readTask(fetchFn, taskId),
      readCurrentArtifact(fetchFn, taskId),
    ]);
    if (!aliveRef.current || seq !== loadSeqRef.current || taskIdRef.current !== taskId) return false;
    if (!taskResult.ok) {
      commit({
        busy: mutationRef.current ? stateRef.current.busy : false,
        message: `작업 정보를 불러오지 못했습니다. ${artifactFailureMessage(taskResult.failure)}`,
      });
      return false;
    }
    const artifact = artifactResult.ok ? artifactResult.value : null;
    applyServerState(taskResult.value, artifact);
    if (!artifactResult.ok) {
      commit({ message: `초안 정보를 읽지 못했습니다. ${artifactFailureMessage(artifactResult.failure)}` });
    }
    // 새로 고침·재접속 뒤에도 서버가 계속 실행 중인 job을 이어서 확인한다.
    const activeJobId = taskResult.value.currentJobId;
    if (activeJobId !== null && pollingRef.current !== activeJobId) {
      const resumed = await readArtifactJob(fetchFn, taskId, activeJobId);
      if (!aliveRef.current || seq !== loadSeqRef.current || taskIdRef.current !== taskId) return false;
      if (resumed.ok && (resumed.value.status === 'running' || resumed.value.status === 'cancel_requested')) {
        const label = JOB_WORD[resumed.value.kind] ?? resumed.value.kind;
        commit({ job: resumed.value, jobBusy: true, message: `${label}: 서버에서 계속 진행 중입니다…` });
        const resume = pollJobRef.current;
        if (resume !== null) void resume(resumed.value, label);
      } else if (resumed.ok) {
        commit({ job: resumed.value, jobBusy: false });
      }
    }
    return true;
  }, [applyServerState, commit, fetchFn]);

  const notify = useCallback(async (taskId: string): Promise<void> => {
    if (!aliveRef.current || taskIdRef.current !== taskId) return;
    try {
      await onTaskChangedRef.current(taskId);
    } catch {
      // 부모의 작업 재조회 실패는 이 영역의 저장 성공과 별개다. 화면 메시지는 각 동작이 남긴다.
    }
  }, []);

  useEffect(() => {
    const snapshot = options.snapshot;
    if (snapshot === null) {
      taskIdRef.current = null;
      loadSeqRef.current += 1;
      stateRef.current = INITIAL_STATE;
      setState(INITIAL_STATE);
      return;
    }
    if (taskIdRef.current !== snapshot.id || stateRef.current.taskId !== snapshot.id) {
      taskIdRef.current = snapshot.id;
      loadSeqRef.current += 1;
      keyCacheRef.current.clear();
      lastSnapshotKeyRef.current = '';
      const reset: State = {
        ...INITIAL_STATE,
        taskId: snapshot.id,
        message: LOADING_DRAFT_MESSAGE,
      };
      stateRef.current = reset;
      setState(reset);
    }
    const key = `${snapshot.id}:${snapshot.revision}`;
    if (lastSnapshotKeyRef.current === key) return;
    lastSnapshotKeyRef.current = key;
    void refresh(snapshot.id);
  }, [options.snapshot?.id, options.snapshot?.revision, options.csrfToken, refresh]);

  // 제출 전 공통 확인: 화면이 오래되지 않았고, 요청 판본이 서버에서 마지막으로 확인한 판본인지 본다.
  const writeReady = useCallback((reason: string): boolean => {
    if (reason !== '') {
      commit({ message: reason });
      return false;
    }
    return true;
  }, [commit]);

  const pollJob = useCallback(async (job: ArtifactJob, label: string): Promise<void> => {
    if (pollingRef.current === job.id) return;
    pollingRef.current = job.id;
    try {
      const taskId = job.taskId;
      const startedAt = Date.now();
      let current = job;
      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        if (!aliveRef.current || taskIdRef.current !== taskId || stateRef.current.job?.id !== job.id) return;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          commit({
            jobBusy: true,
            message: `${label}: 3분 안에 끝나지 않았습니다. 계속 진행 중일 수 있어 다른 동작을 막아 둡니다. 취소하거나 작업을 다시 불러와 확인하세요.`,
          });
          return;
        }
        const polled = await readArtifactJob(fetchFn, taskId, job.id);
        if (!aliveRef.current || taskIdRef.current !== taskId || stateRef.current.job?.id !== job.id) return;
        if (!polled.ok) {
          commit({ jobBusy: false, message: `${label} 상태를 읽지 못했습니다. ${artifactFailureMessage(polled.failure)}` });
          return;
        }
        current = polled.value;
        commit({
          job: current,
          message: `${label} ${current.status === 'cancel_requested' ? '취소를 요청했습니다' : '진행 중입니다'}… ${elapsed}초`,
        });
        if (current.status === 'running' || current.status === 'cancel_requested') continue;
        commit({ jobBusy: false });
        await refresh(taskId);
        if (!aliveRef.current || taskIdRef.current !== taskId) return;
        if (current.status === 'succeeded') {
          // 초안을 읽지 못했으면 refresh가 남긴 오류 문구를 성공 문구로 덮지 않는다.
          if (stateRef.current.artifact !== null) commit({ message: jobDoneMessage(current.kind, stateRef.current.artifact) });
          await notify(taskId);
        } else if (current.status === 'failed') {
          const artifact = stateRef.current.artifact;
          const humanPossible = artifact !== null && artifact.reviewErrorCode !== null &&
            HUMAN_REVIEW_CODES[artifact.reviewErrorCode] === true;
          commit({
            message: `${label}에 실패했습니다. ${modelErrorText(current.errorCode)}${humanPossible
              ? ' 검토 단계에서 사람 의미 검토를 기록할 수 있습니다.'
              : artifact === null ? ' 초안은 저장되지 않았습니다. 다시 시도하세요.' : ' 이전 초안은 그대로 있습니다. 다시 시도하세요.'}`,
          });
          await notify(taskId);
        } else if (current.status === 'cancelled') {
          commit({ message: `${label}: 취소했습니다. 필요하면 다시 시작할 수 있습니다.` });
          await notify(taskId);
        } else {
          commit({ message: '작업 판본이 바뀌어 결과를 쓰지 않았습니다. 최신 작업을 확인하세요.' });
          await notify(taskId);
        }
        return;
      }
    } finally {
      if (pollingRef.current === job.id) pollingRef.current = null;
    }
  }, [commit, fetchFn, notify, refresh]);

  // 위 pollJob 정의를 refresh(재접속·재조회)가 쓸 수 있게 연결한다. 정리 때는 끊는다.
  useEffect(() => {
    pollJobRef.current = pollJob;
    return () => {
      pollJobRef.current = null;
    };
  }, [pollJob]);

  const runJob = useCallback(async (kind: 'compose' | 'review', artifact: ArtifactView | null, task: TaskAggregate, label: string): Promise<void> => {
    const token = csrfTokenRef.current;
    if (token === null) return;
    const args = kind === 'review'
      ? (artifact === null ? null : { artifact_id: artifact.id, expected_artifact_set_hash: artifact.artifactSetHash })
      : null;
    if (kind === 'review' && args === null) return;
    const body = {
      expected_revision: task.revision,
      kind,
      ...(args === null ? {} : { arguments: args }),
    };
    const key = keyFor(`job:${kind}:${artifact?.id ?? ''}:${task.revision}:${artifact?.artifactSetHash ?? ''}`, body);
    mutationRef.current = true;
    commit({ busy: true, message: `${label}: 시작하는 중입니다…` });
    const started = await startArtifactJob(fetchFn, token, task.id, task.revision, kind, args, key);
    mutationRef.current = false;
    if (!aliveRef.current || taskIdRef.current !== task.id) return;
    if (!started.ok) {
      commit({ busy: false, message: `${label}: 시작하지 못했습니다. ${artifactFailureMessage(started.failure)}` });
      if (started.failure.kind === 'conflict') await refresh(task.id);
      return;
    }
    // start는 작업 판본을 먼저 올린다. 취소 요청이 그 판본을 쓰도록 응답의 input_revision으로 맞춘다.
    const advanced: TaskAggregate = task.revision === started.value.inputRevision
      ? task
      : { ...task, revision: started.value.inputRevision, phase: 'processing', currentJobId: started.value.id };
    commit({ busy: false, jobBusy: true, job: started.value, task: advanced, message: `${label} 진행 중입니다…` });
    await pollJob(started.value, label);
  }, [commit, fetchFn, keyFor, pollJob, refresh]);

  const compose = useCallback((): void => {
    const current = stateRef.current;
    const task = current.task;
    if (!writeReady(composeReason(current, csrfTokenRef.current, snapshotRef.current, canGenerateRef.current))) return;
    if (task === null) return;
    void runJob('compose', null, task, '초안 작성');
  }, [runJob, writeReady]);

  const reReview = useCallback((): void => {
    const current = stateRef.current;
    const task = current.task;
    const artifact = current.artifact;
    if (!writeReady(reviewReason(current, csrfTokenRef.current, snapshotRef.current))) return;
    if (task === null || artifact === null) return;
    void runJob('review', artifact, task, '검토');
  }, [runJob, writeReady]);

  const cancel = useCallback((): void => {
    const current = stateRef.current;
    const job = current.job;
    const task = current.task;
    const token = csrfTokenRef.current;
    if (job === null || task === null || token === null) return;
    if (job.status !== 'running' && job.status !== 'cancel_requested') {
      commit({ message: '이미 끝난 작업이라 취소할 수 없습니다. 작업을 다시 불러오세요.' });
      return;
    }
    void (async (): Promise<void> => {
      const body = { expected_revision: task.revision };
      commit({ message: '취소를 요청하는 중입니다…' });
      const result = await cancelArtifactJob(fetchFn, token, task.id, job.id, task.revision, keyFor(`cancel:${job.id}`, body));
      if (!aliveRef.current || taskIdRef.current !== task.id) return;
      if (!result.ok) {
        commit({ message: `취소하지 못했습니다. ${artifactFailureMessage(result.failure)}` });
        if (result.failure.kind === 'conflict') await refresh(task.id);
        return;
      }
      commit({
        job: { ...job, status: result.value.cancelRequested ? 'cancel_requested' : job.status },
        message: result.value.cancelRequested
          ? '취소 요청을 접수했습니다. 실행이 멈추면 상태가 취소로 바뀝니다.'
          : '이미 끝난 작업이라 취소되지 않았습니다. 작업을 다시 불러오세요.',
      });
    })();
  }, [commit, fetchFn, keyFor, refresh]);

  const recordHumanReviewAction = useCallback((): void => {
    const current = stateRef.current;
    const artifact = current.artifact;
    const task = current.task;
    const token = csrfTokenRef.current;
    if (!writeReady(humanReviewReason(current, token, snapshotRef.current))) return;
    if (artifact === null || task === null || token === null) return;
    const body = {
      expected_revision: task.revision,
      target_hash: artifact.artifactSetHash,
      checklist: current.checklist,
      fallback_reason: current.fallbackReason,
    };
    void (async (): Promise<void> => {
      mutationRef.current = true;
      commit({ busy: true, message: '사람 의미 검토를 기록하는 중입니다…' });
      const recorded = await recordHumanReview(
        fetchFn,
        token,
        artifact.id,
        task.revision,
        artifact.artifactSetHash,
        current.checklist,
        current.fallbackReason,
        keyFor(`human-review:${artifact.id}`, body),
      );
      if (!aliveRef.current || taskIdRef.current !== task.id) {
        mutationRef.current = false;
        return;
      }
      if (!recorded.ok) {
        mutationRef.current = false;
        commit({ busy: false, message: `사람 의미 검토를 기록하지 못했습니다. ${artifactFailureMessage(recorded.failure)}` });
        if (recorded.failure.kind === 'conflict') await refresh(task.id);
        return;
      }
      commit({
        artifact: recorded.value,
        exportInfo: null,
        checklist: EMPTY_CHECKLIST,
        fallbackReason: '',
        message: '사람 의미 검토를 기록했습니다. 서버 확정 조건이 남아 있으면 최종 확인에서 계속 막힙니다.',
      });
      await refresh(task.id);
      mutationRef.current = false;
      commit({ busy: false });
      await notify(task.id);
    })();
  }, [commit, fetchFn, keyFor, notify, refresh, writeReady]);

  const finalize = useCallback((): void => {
    const current = stateRef.current;
    const artifact = current.artifact;
    const task = current.task;
    const token = csrfTokenRef.current;
    if (!writeReady(finalizeReason(current, token, snapshotRef.current))) return;
    if (artifact === null || task === null || token === null) return;
    const body = {
      expected_revision: task.revision,
      artifact_id: artifact.id,
      expected_artifact_set_hash: artifact.artifactSetHash,
    };
    void (async (): Promise<void> => {
      mutationRef.current = true;
      commit({ busy: true, message: '현재 파일 집합을 확정하는 중입니다…' });
      const finalized = await finalizeTask(
        fetchFn,
        token,
        task.id,
        task.revision,
        artifact.id,
        artifact.artifactSetHash,
        keyFor(`finalize:${artifact.id}:${task.revision}`, body),
      );
      if (!aliveRef.current || taskIdRef.current !== task.id) {
        mutationRef.current = false;
        return;
      }
      if (!finalized.ok) {
        mutationRef.current = false;
        commit({ busy: false, message: `확정하지 못했습니다. ${artifactFailureMessage(finalized.failure)}` });
        if (finalized.failure.kind === 'conflict') await refresh(task.id);
        return;
      }
      commit({
        exportInfo: finalized.value,
        message: '확정했습니다. 아래에서 ZIP이나 개별 파일을 내려받으세요.',
      });
      await refresh(task.id);
      mutationRef.current = false;
      commit({ busy: false });
      await notify(task.id);
    })();
  }, [commit, fetchFn, keyFor, notify, refresh, writeReady]);

  const openFile = useCallback((path: string): void => {
    const current = stateRef.current;
    const artifact = current.artifact;
    if (artifact === null) return;
    const meta: ArtifactFileMeta | undefined = artifact.files.find((file) => file.path === path);
    if (meta === undefined) {
      commit({ message: `파일 목록에 ${path}가 없습니다.` });
      return;
    }
    void (async (): Promise<void> => {
      commit({ fileBusy: true, message: `${path} 내용을 읽는 중입니다…` });
      const result = await readArtifactFile(fetchFn, artifact.id, path);
      if (!aliveRef.current || taskIdRef.current !== artifact.taskId) return;
      if (!result.ok) {
        commit({ fileBusy: false, message: `${path}를 읽지 못했습니다. ${artifactFailureMessage(result.failure)}` });
        return;
      }
      const digest = await sha256Hex(result.value.bytes);
      if (!aliveRef.current || taskIdRef.current !== artifact.taskId) return;
      if (digest !== null && digest !== meta.sha256) {
        commit({ fileBusy: false, message: `${path} 내용이 파일 목록의 해시와 달라 표시하지 않았습니다.` });
        return;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(result.value.bytes);
      } catch {
        commit({ fileBusy: false, message: `${path}는 UTF-8 텍스트가 아니어서 화면에 표시하지 않습니다.` });
        return;
      }
      commit({ fileBusy: false, file: { path, text }, message: `${path} 내용을 표시합니다.` });
    })();
  }, [commit, fetchFn]);

  const closeFile = useCallback((): void => {
    commit({ file: null });
  }, [commit]);

  const download = useCallback((path: string | null): void => {
    const current = stateRef.current;
    const exportInfo = current.exportInfo;
    const reason = downloadReason(current);
    if (reason !== '') {
      commit({ message: reason });
      return;
    }
    if (exportInfo === null) return;
    const label = path === null ? 'archive' : path;
    void (async (): Promise<void> => {
      commit({ downloadBusy: label, message: `${path === null ? '확정 ZIP' : path}을 내려받는 중입니다…` });
      const result = await readExportBytes(fetchFn, exportInfo.id, path);
      if (!aliveRef.current) return;
      if (!result.ok) {
        commit({ downloadBusy: null, message: `내보내기를 내려받지 못했습니다. ${artifactFailureMessage(result.failure)}` });
        const invalidated = result.failure.kind === 'conflict' || result.failure.code === 'EXPORT_INVALIDATED';
        if (invalidated) {
          commit({ exportInfo: null });
          const taskId = stateRef.current.taskId;
          if (taskId !== null) {
            await refresh(taskId);
            await notify(taskId);
          }
        }
        return;
      }
      const saved = saveDownload(result.value);
      commit({
        downloadBusy: null,
        message: saved
          ? `${result.value.filename}을(를) 내려받기 시작했습니다.`
          : '브라우저가 파일 저장을 시작하지 못했습니다. 다운로드가 성공한 것으로 표시하지 않습니다.',
      });
    })();
  }, [commit, fetchFn, notify, refresh]);

  const downloadArchive = useCallback((): void => {
    download(null);
  }, [download]);

  const downloadFile = useCallback((path: string): void => {
    download(path);
  }, [download]);

  const reload = useCallback((): void => {
    const taskId = stateRef.current.taskId;
    if (taskId === null) return;
    void (async (): Promise<void> => {
      commit({ busy: true, message: '작업 정보를 다시 불러오는 중입니다…' });
      const loaded = await refresh(taskId);
      if (!aliveRef.current) return;
      if (loaded) commit({ message: '작업 정보를 서버 판본으로 다시 불러왔습니다.' });
      await notify(taskId);
    })();
  }, [commit, notify, refresh]);

  const setChecklist = useCallback((next: HumanReviewChecklist): void => {
    commit({ checklist: next });
  }, [commit]);

  const setFallbackReason = useCallback((text: string): void => {
    commit({ fallbackReason: text });
  }, [commit]);

  const outOfSync = options.snapshot !== null && state.task !== null &&
    (options.snapshot.id !== state.task.id || options.snapshot.revision !== state.task.revision);
  const writeBlockReason = writeReason(state, options.csrfToken, options.snapshot);
  const composeBlockReason = composeReason(state, options.csrfToken, options.snapshot, options.canGenerate);
  const reviewBlockReason = reviewReason(state, options.csrfToken, options.snapshot);
  const humanReviewBlockReason = humanReviewReason(state, options.csrfToken, options.snapshot);
  const finalizeBlockReason = finalizeReason(state, options.csrfToken, options.snapshot);
  const downloadBlockReason = downloadReason(state);
  const goalNotice = state.task?.goalVariant === 'reproduction_evidence'
    ? '재현 근거가 목표인 작업입니다. 이 경로는 재현 결과를 만들지 않으므로 최종 확정은 서버가 막습니다.'
    : '';
  const broadcastMessage = outOfSync && options.snapshot !== null && state.task !== null
    ? `화면의 작업 판본 ${options.snapshot.revision}이(가) 서버 판본 ${state.task.revision}과 다릅니다. 작업을 다시 불러오세요.`
    : '';

  return {
    taskId: state.taskId,
    task: state.task,
    artifact: state.artifact,
    job: state.job,
    message: state.message,
    broadcastMessage,
    busy: state.busy,
    jobBusy: state.jobBusy,
    outOfSync,
    writeBlockReason,
    composeBlockReason,
    reviewBlockReason,
    humanReviewBlockReason,
    finalizeBlockReason,
    downloadBlockReason,
    goalNotice,
    checklist: state.checklist,
    fallbackReason: state.fallbackReason,
    exportInfo: state.exportInfo,
    file: state.file,
    fileBusy: state.fileBusy,
    downloadBusy: state.downloadBusy,
    setChecklist,
    setFallbackReason,
    reload,
    compose,
    reReview,
    cancel,
    recordHumanReview: recordHumanReviewAction,
    finalize,
    openFile,
    closeFile,
    downloadArchive,
    downloadFile,
  };
}
