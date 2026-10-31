// 왼쪽 단계 목록. 여섯 단계의 완료 여부와 지금 열어 둔 단계를 보여 주고, 단계 이동과
// 보조 화면(규칙·이력·보관·실행 정보) 전환을 맡는다. 상태 판정은 flow-status 결과만 쓴다.

import type { JSX } from 'react';
import type { StepId, StepView } from '../flow-status.ts';

export type ViewId = StepId | 'rules' | 'history' | 'archive' | 'execution';

// 보조 화면은 단계가 아니라 참고 화면이다. 이름과 설명을 한 곳에 두고 셸이 그대로 읽는다.
export const VIEW_INFO: Record<Exclude<ViewId, StepId>, { label: string; hint: string }> = {
  rules: { label: '재사용 규칙', hint: '승인한 표현을 다음 작업에 다시 씁니다.' },
  history: { label: '검토 이력', hint: '이 작업에서 일어난 결정·검토·초안 기록입니다.' },
  archive: { label: '문서 보관소', hint: '저장된 문서를 찾아봅니다.' },
  execution: { label: '실행 정보', hint: '연결 상태와 런타임 정보를 확인합니다.' },
};

const SECONDARY = Object.keys(VIEW_INFO) as (keyof typeof VIEW_INFO)[];

export function FlowRail(props: {
  steps: StepView[];
  active: ViewId;
  onSelect: (id: ViewId) => void;
}): JSX.Element {
  const { steps, active, onSelect } = props;
  return (
    <nav className="rail" aria-label="작업 흐름">
      <div className="rail__head">
        <p className="meta">작업 흐름</p>
        <p className="rail__hint">자료를 올리고, 공개 범위를 정하고, 초안을 확인합니다.</p>
      </div>
      <ol className="rail__steps">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              className={`rail__step rail__step--${step.state}${active === step.id ? ' rail__step--active' : ''}`}
              id={`rail-${step.id}`}
              type="button"
              aria-current={active === step.id ? 'step' : undefined}
              onClick={(): void => { onSelect(step.id); }}
            >
              <span className="rail__number" aria-hidden="true">{String(step.index).padStart(2, '0')}</span>
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
                {VIEW_INFO[id].label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
