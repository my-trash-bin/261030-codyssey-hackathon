// 단계 본문 틀. 단계 번호·제목·목적과 앞뒤 이동만 담당하고, 실제 입력과 실행 버튼은
// 각 단계 구역 컴포넌트가 그린다.

import type { JSX, ReactNode } from 'react';
import { nextStepId, previousStepId } from '../flow-status.ts';
import type { StepId, StepView } from '../flow-status.ts';

const STATE_LABEL: Record<StepView['state'], string> = {
  done: '완료',
  current: '진행',
  ready: '할 일',
  waiting: '대기',
};

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
          <span className={`chip chip--${step.state}`}>{STATE_LABEL[step.state]}</span>
          <span className="meta" id={`step-${step.id}-detail`}>{step.detail}</span>
        </p>
        <h2 id={`step-${step.id}-heading`}>{step.title}</h2>
        <p className="step__purpose">{step.purpose}</p>
      </header>

      <div className="step__body">{children}</div>

      <footer className="step__nav">
        <button
          className="button button--quiet"
          id={`step-${step.id}-previous`}
          type="button"
          disabled={previousId === step.id}
          onClick={(): void => { onSelect(previousId); }}
        >
          이전{previous && previous.id !== step.id ? ` · ${previous.title}` : ''}
        </button>
        <button
          className="button"
          id={`step-${step.id}-next`}
          type="button"
          disabled={nextId === step.id}
          onClick={(): void => { onSelect(nextId); }}
        >
          다음{next && next.id !== step.id ? ` · ${next.title}` : ''}
        </button>
      </footer>
    </section>
  );
}
