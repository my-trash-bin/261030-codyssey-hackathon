// 단계 본문 틀. 단계 번호·제목·목적과 앞뒤 이동만 담당하고, 실제 입력과 실행 버튼은
// 각 단계 구역 컴포넌트가 그린다.

import type { JSX, ReactNode } from 'react';
import { currentStepId, nextStepId, previousStepId } from '../flow-status.ts';
import type { StepId, StepView } from '../flow-status.ts';

export function StepFrame(props: {
  step: StepView;
  steps: StepView[];
  onSelect: (id: StepId) => void;
  children: ReactNode;
}): JSX.Element {
  const { step, steps, onSelect, children } = props;
  const previousId = previousStepId(steps, step.id);
  const nextId = nextStepId(steps, step.id);
  const previous = steps.find((item) => item.id === previousId);
  const next = steps.find((item) => item.id === nextId);
  const isCurrent = currentStepId(steps) === step.id;
  const stateLabel = step.state === 'done' ? '완료' : step.state === 'waiting' ? '대기' : isCurrent ? '할 일' : '진행 가능';
  return (
    <section
      className="step"
      id={`step-${step.id}`}
      aria-labelledby={`step-${step.id}-heading`}
      tabIndex={-1}
    >
      <header className="step__head">
        <p className="step__eyebrow">
          <span className="meta">단계 {String(step.index).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <span className={`chip chip--${step.state}`}>{stateLabel}</span>
          <span className="meta" id={`step-${step.id}-detail`}>{step.detail}</span>
        </p>
        <h2 id={`step-${step.id}-heading`}>{step.title}</h2>
        <p className="step__purpose">{step.purpose}</p>
      </header>

      <div className="step__body">{children}</div>

      {/* 끝 단계에서는 갈 곳이 없으므로 비활성 버튼을 남기지 않는다. 빈 칸은 다음 버튼을 오른쪽에 붙여 둔다. */}
      <footer className="step__nav">
        {previous && previous.id !== step.id
          ? (
            <button
              className="button button--quiet"
              id={`step-${step.id}-previous`}
              type="button"
              onClick={(): void => { onSelect(previousId); }}
            >
              이전 · {previous.title}
            </button>
          )
          : <span />}
        {next && next.id !== step.id
          ? (
            <button
              className={`button${step.state === 'done' ? ' button--solid' : ''}`}
              id={`step-${step.id}-next`}
              type="button"
              onClick={(): void => { onSelect(nextId); }}
            >
              다음 · {next.title}
            </button>
          )
          : null}
      </footer>
    </section>
  );
}
