// 여섯 단계 작업 흐름의 진행 상태를 계산한다.
// 화면은 이 결과만 읽어 단계 목록·진행 표시·다음 단계 안내를 그린다. 서버 호출이나 상태 변경은 하지 않는다.

export type StepId = 'purpose' | 'analysis' | 'decision' | 'draft' | 'review' | 'files';

export type StepState = 'done' | 'ready' | 'waiting';

// 서버 응답에서 그대로 뽑은 집계. 화면은 이 값만 보고 단계 상태를 정한다.
export interface FlowFacts {
  hasTask: boolean;
  sourceCount: number;
  candidateCount: number;
  // 허용·제외로 끝난 후보 수. 보류는 서버 확정 조건을 채우지 않으므로 따로 센다.
  decidedCount: number;
  deferredCount: number;
  analysisRunning: boolean;
  hasDraft: boolean;
  artifactFileCount: number;
  reviewResult: 'pass' | 'needs_changes' | 'needs_decision' | 'error' | null;
  hasHumanReview: boolean;
  exported: boolean;
}

export interface StepView {
  id: StepId;
  index: number;
  title: string;
  purpose: string;
  state: StepState;
  detail: string;
}

interface StepMeta {
  id: StepId;
  title: string;
  purpose: string;
}

// 문구는 프레젠테이션 6장면(공유 목적 / 자료 분석 / 공개 방법 / 새 문서 작성 / 결과 검토 / 실제 파일 확인)과
// 같은 순서를 쓴다.
export const STEP_META: readonly StepMeta[] = [
  { id: 'purpose', title: '목적과 자료', purpose: '누구에게 무엇을 물을지 정하고 원자료를 올립니다.' },
  { id: 'analysis', title: '자료 분석', purpose: '원자료에서 관찰 사실과 확인하지 못한 부분을 뽑습니다.' },
  { id: 'decision', title: '공개 결정', purpose: '후보마다 공개 방법을 고르고 적용해 확정합니다.' },
  { id: 'draft', title: '초안 작성', purpose: '확정된 공개 범위로 공유 문서를 만듭니다.' },
  { id: 'review', title: '검토', purpose: '자동 검토 결과와 초안 문장을 확인합니다.' },
  { id: 'files', title: '파일 확인', purpose: '내보낼 파일을 확인하고 확정한 뒤 내려받습니다.' },
];

export const EMPTY_FACTS: FlowFacts = {
  hasTask: false,
  sourceCount: 0,
  candidateCount: 0,
  decidedCount: 0,
  deferredCount: 0,
  analysisRunning: false,
  hasDraft: false,
  artifactFileCount: 0,
  reviewResult: null,
  hasHumanReview: false,
  exported: false,
};

function purposeState(facts: FlowFacts): StepState {
  if (facts.hasTask && facts.sourceCount > 0) return 'done';
  return 'ready';
}

function analysisState(facts: FlowFacts): StepState {
  if (facts.candidateCount > 0) return 'done';
  if (!facts.hasTask || facts.sourceCount === 0) return 'waiting';
  return 'ready';
}

function decisionState(facts: FlowFacts): StepState {
  if (facts.candidateCount > 0 && facts.decidedCount >= facts.candidateCount) return 'done';
  if (facts.candidateCount === 0) return 'waiting';
  return 'ready';
}

function hasDraft(facts: FlowFacts): boolean {
  return facts.hasDraft || facts.artifactFileCount > 0;
}

// 사람 의미 검토는 모델 실패로 자동 검토 결과가 없을 때만 기록된다. 수정 필요 판정을 덮지 않는다.
function reviewCleared(facts: FlowFacts): boolean {
  return facts.reviewResult === 'pass' || (facts.reviewResult === null && facts.hasHumanReview);
}

function draftState(facts: FlowFacts): StepState {
  if (hasDraft(facts)) return 'done';
  if (facts.decidedCount === 0) return 'waiting';
  return 'ready';
}

function reviewState(facts: FlowFacts): StepState {
  if (!hasDraft(facts)) return 'waiting';
  return reviewCleared(facts) ? 'done' : 'ready';
}

function filesState(facts: FlowFacts): StepState {
  if (facts.exported) return 'done';
  // 검토가 끝나지 않았거나 정하지 않은 후보가 있으면 서버가 확정을 거부한다.
  if (!hasDraft(facts) || !reviewCleared(facts) || facts.decidedCount < facts.candidateCount) return 'waiting';
  return 'ready';
}

const STATE_FUNCTIONS: Record<StepId, (facts: FlowFacts) => StepState> = {
  purpose: purposeState,
  analysis: analysisState,
  decision: decisionState,
  draft: draftState,
  review: reviewState,
  files: filesState,
};

const REVIEW_DETAIL: Record<NonNullable<FlowFacts['reviewResult']>, string> = {
  pass: '통과',
  needs_changes: '수정 필요',
  needs_decision: '공개 결정 필요',
  error: '오류',
};

function detailFor(id: StepId, facts: FlowFacts): string {
  switch (id) {
    case 'purpose':
      if (!facts.hasTask) return '작업 없음';
      return facts.sourceCount > 0 ? `원자료 ${facts.sourceCount}개` : '원자료 등록 전';
    case 'analysis':
      if (facts.analysisRunning) return '분석 중';
      return facts.candidateCount > 0 ? `후보 ${facts.candidateCount}개` : '후보 없음';
    case 'decision':
      if (facts.candidateCount === 0) return '후보 없음';
      return `결정 ${facts.decidedCount} / ${facts.candidateCount}${facts.deferredCount > 0 ? ` · 보류 ${facts.deferredCount}` : ''}`;
    case 'draft':
      if (!hasDraft(facts)) return '초안 없음';
      return facts.artifactFileCount > 0 ? `파일 ${facts.artifactFileCount}개` : '파일 생성 전';
    case 'review': {
      if (!hasDraft(facts)) return '초안 없음';
      const auto = facts.reviewResult === null ? '자동 검토 전'
        : facts.reviewResult === 'pass' ? '자동 검토 통과'
        : `자동 검토 ${REVIEW_DETAIL[facts.reviewResult]}`;
      return facts.hasHumanReview ? `${auto} · 사람 검토 기록됨` : auto;
    }
    case 'files':
      return facts.exported ? '확정됨' : '확정 전';
  }
}

// 흐름은 언제나 앞 단계의 완료 여부로 다음에 할 일이 정해진다. 순서를 건너뛰어도 목록 순서는 유지한다.
export function describeSteps(facts: FlowFacts): StepView[] {
  return STEP_META.map((meta, index) => ({
    id: meta.id,
    index: index + 1,
    title: meta.title,
    purpose: meta.purpose,
    state: STATE_FUNCTIONS[meta.id](facts),
    detail: detailFor(meta.id, facts),
  }));
}

// 지금 열어야 하는 단계. 모두 끝났으면 마지막 확인 단계를 연다.
// 여섯 단계 목록은 고정이므로 빈 배열은 호출 규약 위반이다. 조용히 첫 단계를 고르지 않고 바로 알린다.
export function currentStepId(steps: StepView[]): StepId {
  const next = steps.find((step) => step.state !== 'done') ?? steps[steps.length - 1];
  if (next === undefined) throw new Error('단계 목록이 비었습니다');
  return next.id;
}

export function nextStepId(steps: StepView[], from: StepId): StepId {
  const index = steps.findIndex((step) => step.id === from);
  const after = steps[index + 1] ?? steps[steps.length - 1];
  if (after === undefined) throw new Error('단계 목록이 비었습니다');
  return after.id;
}

export function previousStepId(steps: StepView[], from: StepId): StepId {
  const index = steps.findIndex((step) => step.id === from);
  const before = steps[index - 1] ?? steps[0];
  if (before === undefined) throw new Error('단계 목록이 비었습니다');
  return before.id;
}

export function completionCount(steps: StepView[]): number {
  return steps.filter((step) => step.state === 'done').length;
}

export function stepView(steps: StepView[], id: StepId): StepView {
  const found = steps.find((step) => step.id === id) ?? steps[0];
  if (found === undefined) throw new Error('단계 목록이 비었습니다');
  return found;
}
