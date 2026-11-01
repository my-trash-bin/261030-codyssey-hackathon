import type { Snapshot } from '../../disclosure-contract.ts';
import type { ArtifactJob, ArtifactView, ExportInfo, HumanReviewChecklist, TaskAggregate } from '../../artifacts-client.ts';
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

export interface State {
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

export const EMPTY_CHECKLIST: HumanReviewChecklist = {
  reviewed_all_files: false,
  approved_facts_only: false,
  uncertainty_preserved: false,
};

export const INITIAL_STATE: State = {
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

export const POLL_INTERVAL_MS = 800;
export const POLL_LIMIT_MS = 180000;
export const HUMAN_REVIEW_CODES: Record<string, true> = { MODEL_TIMEOUT: true, MODEL_UNAVAILABLE: true };
export const JOB_WORD: Record<string, string> = { compose: '초안 작성', review: '검토' };
export const LOADING_DRAFT_MESSAGE = '초안 정보를 불러오는 중입니다…';
export const MODEL_ERROR_TEXT: Record<string, string> = {
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

export function jobDoneMessage(kind: string, artifact: ArtifactView | null): string {
  const word = kind === 'review' ? '검토를 마쳤습니다.' : '초안을 만들었습니다.';
  const result = artifact?.review?.result;
  if (result === 'pass') return `${word} 자동 검토를 통과했습니다.`;
  if (result === 'needs_changes') return `${word} 자동 검토 결과 수정이 필요합니다. 검토 단계에서 지적 사항을 확인하세요.`;
  if (result === 'needs_decision') return `${word} 공개 결정이 더 필요합니다. 검토 단계에서 지적 사항을 확인하세요.`;
  return `${word} 검토 상태를 확인하세요.`;
}

export const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export const sleep = (ms: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

export function writeReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
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

export function composeReason(
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

export function reviewReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
  const written = writeReason(state, csrfToken, snapshot);
  if (written !== '') return written;
  const artifact = state.artifact;
  const task = state.task;
  if (artifact === null || task === null) return '검토할 초안이 없습니다. 먼저 공유 초안을 만드세요.';
  if (!artifact.isCurrent || artifact.revision !== task.revision) {
    return '이 초안은 공개 결정이 바뀌기 전 판본입니다. 초안을 다시 만드세요.';
  }
  return '';
}

export function humanReviewReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
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

export function finalizeReason(state: State, csrfToken: string | null, snapshot: Snapshot | null): string {
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

export function downloadReason(state: State): string {
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
