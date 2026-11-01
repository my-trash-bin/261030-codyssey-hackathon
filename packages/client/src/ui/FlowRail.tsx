// 왼쪽 단계 목록. 여섯 단계의 완료 여부와 지금 열어 둔 단계를 보여 주고, 단계 이동과
// 보조 화면(규칙·이력·보관·실행 정보) 전환을 맡는다. 상태 판정은 flow-status 결과만 쓴다.

import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { currentStepId } from '../flow-status.ts';
import type { StepId, StepView } from '../flow-status.ts';

export type ViewId = StepId | 'history';

// 보조 화면은 단계가 아니라 참고 화면이다. 이름과 설명을 한 곳에 두고 셸이 그대로 읽는다.
export const VIEW_INFO: Record<Exclude<ViewId, StepId>, { label: string; hint: string }> = {
  history: { label: '검토 이력', hint: '이 작업에서 일어난 결정·검토·초안 기록입니다.' },
};

const SECONDARY = Object.keys(VIEW_INFO) as (keyof typeof VIEW_INFO)[];

// 단계 없는 보조 화면을 구분하는 내비게이션 아이콘. 글자와 함께만 쓴다. 외부 자산을 불러오지 않는다.
const VIEW_ICONS: Record<keyof typeof VIEW_INFO, string> = {
  history: 'M8 1.5A6.5 6.5 0 1 1 1.5 8 6.5 6.5 0 0 1 8 1.5zM7.2 4v4.4l3.4 2 .8-1.3-2.7-1.6V4H7.2z',
};

export function FlowRail(props: {
  steps: StepView[];
  active: ViewId;
  onSelect: (id: ViewId) => void;
}): JSX.Element {
  const { steps, active, onSelect } = props;
  const nextId = steps.every((step) => step.state === 'done') ? null : currentStepId(steps);
  // 좁은 화면의 가로 목록에서 지금 단계가 화면 밖에 남지 않게 한다.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return (
    <nav className="rail" aria-label="작업 흐름">
      <div className="rail__head">
        <p className="meta">작업 흐름</p>
      </div>
      <ol className="rail__steps">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              className={`rail__step rail__step--${step.state}${step.id === nextId ? ' rail__step--next' : ''}${active === step.id ? ' rail__step--active' : ''}`}
              id={`rail-${step.id}`}
              ref={active === step.id ? activeRef : undefined}
              type="button"
              aria-current={active === step.id ? 'step' : undefined}
              onClick={(): void => { onSelect(step.id); }}
            >
              <span className="rail__number" aria-hidden="true">{step.state === 'done' ? '✓' : step.index}</span>
              <span className="rail__text">
                <span className="rail__title">{step.title}</span>
                <span className="rail__detail">
                  {step.state === 'done' ? '완료 · ' : step.state === 'waiting' ? '대기 · ' : ''}
                  {step.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="rail__secondary">
        <p className="meta">다른 화면</p>
        <ul className="rail__views">
          {SECONDARY.map((id) => (
            <li key={id}>
              <button
                className={`rail__view${active === id ? ' rail__view--active' : ''}`}
                id={`rail-${id}`}
                type="button"
                aria-current={active === id ? 'page' : undefined}
                onClick={(): void => { onSelect(id); }}
              >
                <svg className="rail__icon" viewBox="0 0 16 16" aria-hidden="true"><path d={VIEW_ICONS[id]} /></svg>
                {VIEW_INFO[id].label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
