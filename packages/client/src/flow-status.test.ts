// 여섯 단계 흐름 계산 검사. 화면이 단계 상태·다음 단계를 잘못 안내하면
// 사용자가 이미 끝난 단계로 돌아가거나 근거 없이 다음으로 넘어가므로 여기서 고정한다.

import assert from 'node:assert/strict';
import test from 'node:test';
import { completionCount, currentStepId, describeSteps, EMPTY_FACTS, nextStepId, previousStepId, stepView } from './flow-status.ts';
import type { FlowFacts } from './flow-status.ts';

function facts(overrides: Partial<FlowFacts> = {}): FlowFacts {
  return { ...EMPTY_FACTS, ...overrides };
}

test('작업이 없으면 첫 단계만 바로 열 수 있다', () => {
  const steps = describeSteps(facts());
  assert.deepEqual(steps.map((step) => step.state), ['ready', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
  assert.equal(currentStepId(steps), 'purpose');
  assert.equal(completionCount(steps), 0);
});

test('작업과 원자료가 있으면 목적 단계가 끝난다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 2 }));
  assert.equal(stepView(steps, 'purpose').state, 'done');
  assert.equal(stepView(steps, 'purpose').detail, '원자료 2개');
  assert.equal(stepView(steps, 'analysis').state, 'ready');
  assert.equal(currentStepId(steps), 'analysis');
});

test('후보가 생기면 분석이 끝나고 결정이 열린다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 4, decidedCount: 0 }));
  assert.equal(stepView(steps, 'analysis').state, 'done');
  assert.equal(stepView(steps, 'decision').state, 'ready');
  assert.equal(stepView(steps, 'decision').detail, '결정 0 / 4');
  assert.equal(stepView(steps, 'draft').state, 'waiting');
});

test('분석이 도는 동안에는 후보 수 대신 진행 중임을 알린다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 1, analysisRunning: true }));
  assert.equal(stepView(steps, 'analysis').detail, '분석 중');
  assert.equal(stepView(steps, 'analysis').state, 'ready');
});

test('결정이 하나라도 남으면 결정 단계는 끝나지 않는다', () => {
  const partial = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 3, decidedCount: 3 }));
  assert.equal(stepView(partial, 'decision').state, 'done');
  assert.equal(stepView(partial, 'draft').state, 'ready');

  const remaining = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 3, decidedCount: 2 }));
  assert.equal(stepView(remaining, 'decision').state, 'ready');
  // 결정이 일부만 끝나도 초안은 만들 수 있다. 다만 남은 결정이 있으므로 지금 할 일은 결정 단계다.
  assert.equal(stepView(remaining, 'draft').state, 'ready');
  assert.equal(currentStepId(remaining), 'decision');
});

test('초안이 생기면 작성 단계가 끝나고 검토가 열린다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 2, decidedCount: 2, artifactFileCount: 3, reviewResult: 'pass' }));
  assert.equal(stepView(steps, 'draft').state, 'done');
  assert.equal(stepView(steps, 'draft').detail, '파일 3개');
  assert.equal(stepView(steps, 'review').state, 'ready');
  assert.equal(stepView(steps, 'review').detail, '자동 검토 통과');
  assert.equal(currentStepId(steps), 'review');
});

test('사람 의미 검토까지 남아 있으면 검토 단계는 끝나지 않는다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 2, decidedCount: 2, artifactFileCount: 3, reviewResult: 'pass', hasHumanReview: false }));
  assert.equal(stepView(steps, 'review').state, 'ready');
  assert.equal(stepView(steps, 'files').state, 'ready');

  const recorded = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 2, decidedCount: 2, artifactFileCount: 3, reviewResult: 'pass', hasHumanReview: true, exported: true }));
  assert.equal(stepView(recorded, 'review').state, 'done');
  assert.equal(stepView(recorded, 'files').state, 'done');
  assert.equal(stepView(recorded, 'files').detail, '내려받기 가능');
  assert.equal(currentStepId(recorded), 'files');
});

test('자동 검토가 통과하지 않았으면 검토 단계는 남는다', () => {
  const steps = describeSteps(facts({ hasTask: true, sourceCount: 1, candidateCount: 2, decidedCount: 2, artifactFileCount: 3, reviewResult: 'needs_changes', hasHumanReview: true }));
  assert.equal(stepView(steps, 'review').state, 'ready');
  assert.equal(stepView(steps, 'review').detail, '자동 검토 needs_changes · 사람 검토 기록됨');
});

test('다음·이전 단계는 목록 양끝을 넘지 않는다', () => {
  const steps = describeSteps(facts());
  assert.equal(nextStepId(steps, 'purpose'), 'analysis');
  assert.equal(nextStepId(steps, 'files'), 'files');
  assert.equal(previousStepId(steps, 'purpose'), 'purpose');
  assert.equal(previousStepId(steps, 'files'), 'review');
  assert.equal(stepView(steps, 'files').index, 6);
});
