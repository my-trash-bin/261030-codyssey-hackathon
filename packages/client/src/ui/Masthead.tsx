// 앱 셸의 고정 영역. 사이드바 머리(이름과 진행 막대)와 본문 위 상단바(현재 작업, 모드, 세션)를 그린다.
// 진행 막대는 흐름 계산 결과를 그대로 그리며 스스로 상태를 판정하지 않는다.
// 빨간 칸 대신 강조색 칸 하나가 지금 할 일이다. 단계 이름은 바로 아래 단계 목록이 보여 준다.

import type { JSX } from 'react';
import { currentStepId } from '../flow-status.ts';
import type { StepView } from '../flow-status.ts';

function progressLabel(steps: StepView[], completed: number): string {
  const open = steps.find((step) => step.state !== 'done');
  if (!open) return `${steps.length}단계를 모두 마쳤습니다.`;
  return `${steps.length}단계 중 ${completed}단계 완료. 지금은 ${open.index}단계 ${open.title}입니다.`;
}

export function SidebarHead(props: { steps: StepView[]; completed: number }): JSX.Element {
  const { steps, completed } = props;
  const nextId = completed === steps.length ? null : currentStepId(steps);
  return (
    <div className="sidebar-head">
      <div className="brand">
        <svg className="brand__mark" viewBox="0 0 124 120" fill="none" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M45 10H20C12 10 8 14 8 22V98C8 106 12 110 20 110H45" stroke="currentColor" />
          <path className="brand__accent" d="M79 10H104C112 10 116 14 116 22V98C116 106 112 110 104 110H79" />
          <path className="brand__accent" d="M34 60H89M74 45L89 60L74 75" />
        </svg>
        <div>
          <h1>SafeHandoff</h1>
          <p className="brand__tagline">공개할 내용만, 안전하게 전달</p>
        </div>
      </div>
      <div className="sidebar-progress">
        <p className="progress__count" id="flow-progress" role="status" aria-live="polite">
          <span className="meta">진행</span> {completed} / {steps.length}
          <span className="visually-hidden">{progressLabel(steps, completed)}</span>
        </p>
        <ol className="progress" aria-label="진행">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`progress__segment progress__segment--${step.id === nextId ? 'next' : step.state}`}
            >
              <span className="visually-hidden">{`${step.index}단계 ${step.title}`}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function TopBar(props: {
  modeLabel: string;
  taskLabel: string | null;
}): JSX.Element {
  const { modeLabel, taskLabel } = props;
  return (
    <header className="topbar">
      <p className="topbar__title" id="task-label">{taskLabel ?? '선택한 작업 없음'}</p>
      <dl className="masthead__facts">
        <div>
          <dt className="meta">모드</dt>
          <dd id="mode-label" role="status" aria-live="polite">{modeLabel}</dd>
        </div>
      </dl>
    </header>
  );
}
