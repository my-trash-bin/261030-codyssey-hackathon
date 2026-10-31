// 전달 조건 구역. 목적·수신처는 서버에 저장되지 않으며, 분석을 실행하면 요청 본문에 담겨 나간다.
// 이 입력은 useAnalysis 훅의 문맥(purpose·recipient)을 직접 갱신한다.

import type { JSX } from 'react';
import type { AnalysisApi } from './hooks/useAnalysis.ts';
import { AnalysisPanel } from './AnalysisPanel.tsx';

export function IntentSection(props: { analysis: AnalysisApi }): JSX.Element {
  const { analysis } = props;

  return (
    <div className="work__side">
      <section className="block" aria-labelledby="intent-heading">
        <h2 id="intent-heading">전달 조건</h2>
        <p className="hint" id="intent-hint">목적·수신처는 서버에 저장되지 않습니다. 다만 분석을 실행하면 선택한 파일과 함께 분석 요청 본문에 담겨 설정된 분석 모델로 전송됩니다.</p>

        <div className="field">
          <label htmlFor="purpose">전달 목적</label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            autoComplete="off"
            value={analysis.purpose}
            aria-invalid={analysis.problem?.field === 'purpose' ? 'true' : undefined}
            aria-describedby="intent-hint analysis-problem"
            onChange={(event): void => {
              analysis.setContext(event.currentTarget.value, analysis.recipient);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="recipient">수신처</label>
          <input
            id="recipient"
            name="recipient"
            type="text"
            autoComplete="off"
            value={analysis.recipient}
            aria-invalid={analysis.problem?.field === 'recipient' ? 'true' : undefined}
            aria-describedby="intent-hint analysis-problem"
            onChange={(event): void => {
              analysis.setContext(analysis.purpose, event.currentTarget.value);
            }}
          />
        </div>

        <AnalysisPanel analysis={analysis} />
      </section>
    </div>
  );
}
