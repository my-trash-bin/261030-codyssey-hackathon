// 주요 동작 구역. 준비 조건과 버튼 활성 상태는 App이 분석 훅의 상태로 한 번 계산해 넘긴다.

import type { JSX } from 'react';

export interface AnalysisPrerequisites {
  analyzeDisabled: boolean;
  cancelDisabled: boolean;
  analyzeBusy: boolean;
  reason: string;
}

export function PrimaryActions(props: {
  prereq: AnalysisPrerequisites;
  onAnalyze: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { prereq } = props;

  return (
    <section className="primary" aria-labelledby="action-heading">
      <div className="primary__text">
        <h2 id="action-heading">주요 동작</h2>
        <p className="hint" id="analyze-reason">{prereq.reason}</p>
      </div>
      <div className="primary__actions">
        <button
          className="button"
          id="analyze"
          type="button"
          disabled={prereq.analyzeDisabled}
          aria-busy={prereq.analyzeBusy ? 'true' : undefined}
          aria-describedby="analyze-reason"
          onClick={() => { props.onAnalyze(); }}
        >자료 분석 시작</button>
        <button
          className="button"
          id="analysis-cancel"
          type="button"
          disabled={prereq.cancelDisabled}
          aria-describedby="analyze-reason"
          onClick={() => { props.onCancel(); }}
        >분석 취소</button>
      </div>
    </section>
  );
}
