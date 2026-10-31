// 화면 머리말. 왼쪽은 이름, 오른쪽은 모드·세션·현재 작업, 아래는 6단계 진행 막대다.
// 진행 막대는 흐름 계산 결과를 그대로 그리며 스스로 상태를 판정하지 않는다.

import type { JSX } from 'react';
import type { StepView } from '../flow-status.ts';

function progressLabel(steps: StepView[], completed: number): string {
  const open = steps.find((step) => step.state !== 'done');
  if (!open) return `${steps.length}단계를 모두 마쳤습니다.`;
  return `${steps.length}단계 중 ${completed}단계 완료. 지금은 ${open.index}단계 ${open.title}입니다.`;
}

export function Masthead(props: {
  modeLabel: string;
  sessionLabel: string | null;
  taskLabel: string | null;
  steps: StepView[];
  completed: number;
}): JSX.Element {
  const { modeLabel, sessionLabel, taskLabel, steps, completed } = props;
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <div className="masthead__brand">
          <h1>덜어쓰기</h1>
          <p className="masthead__tagline">공개 전 확인 작업 공간</p>
        </div>
        <dl className="masthead__facts">
          <div>
            <dt className="meta">모드</dt>
            <dd id="mode-label" role="status" aria-live="polite">{modeLabel}</dd>
          </div>
          <div>
            <dt className="meta">세션</dt>
            <dd id="session-label" role="status" aria-live="polite">{sessionLabel ?? '닫힘'}</dd>
          </div>
          <div>
            <dt className="meta">작업</dt>
            <dd id="task-label">{taskLabel ?? '선택 없음'}</dd>
          </div>
        </dl>
      </div>

      <div className="masthead__progress">
        <ol className="progress" aria-label="진행">
          {steps.map((step) => (
            <li key={step.id} className={`progress__segment progress__segment--${step.state}`}>
              <span className="progress__number">{String(step.index).padStart(2, '0')}</span>
              <span className="progress__title">{step.title}</span>
            </li>
          ))}
        </ol>
        <p className="progress__count" id="flow-progress" role="status" aria-live="polite">
          <span className="meta">진행</span> {completed} / {steps.length}
          <span className="visually-hidden">{progressLabel(steps, completed)}</span>
        </p>
      </div>
    </header>
  );
}
