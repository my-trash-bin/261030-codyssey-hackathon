// 공유 초안 자리와 내부 근거·검토 접이식 구역. 서버 API가 없는 동작은 어떤 경우에도 활성화하지 않는다.
// 클릭 핸들러를 두지 않으므로 성공 토스트나 가짜 결과가 생기지 않는다.

import type { JSX } from 'react';

export function DraftSection(): JSX.Element {
  return (
    <section className="draft" aria-labelledby="draft-heading">
      <div className="draft__head">
        <h2 id="draft-heading">공유 초안</h2>
      </div>

      <div className="draft__sheet">
        <p className="draft__empty" id="draft-state">아직 공유 초안이 없습니다.</p>
        <p className="hint">승인된 정보로 작성한 본문·표·첨부가 표시되는 자리입니다. 현재는 작성 기능이 연결되지 않았습니다.</p>
      </div>

      <div className="draft__actions">
        <div className="action">
          <button className="button" id="generate-document" type="button" disabled aria-describedby="generate-document-reason">공유 초안 생성</button>
          <p className="hint" id="generate-document-reason">공개 결정 저장과 초안 작성 기능이 아직 연결되지 않았습니다.</p>
        </div>
        <div className="action">
          <button className="button" id="finalize-document" type="button" disabled aria-describedby="finalize-document-reason">최종 파일 확인</button>
          <p className="hint" id="finalize-document-reason">파일 확인·확정 기능이 아직 연결되지 않았습니다.</p>
        </div>
      </div>
    </section>
  );
}

export function EvidencePanel(): JSX.Element {
  return (
    <details className="block--fold" id="evidence-panel">
      <summary><h2>내부 근거와 검토</h2></summary>
      <div className="fold__body">
        <p className="hint">내부 참고용입니다. 공유 파일에는 포함되지 않습니다.</p>

        <h3>근거</h3>
        <p className="hint">파일 분석으로 받은 내부 근거와 후보 제안은 위의 분석 결과 영역에 표시됩니다. 여기는 공개 결정 영역의 task 후보 인용 근거 자리이며, 후보를 조회하지 못했거나 task 응답에 근거가 없으면 아무것도 표시하지 않습니다.</p>

        <h3>검토</h3>
        <p className="hint">검토 기록 API가 연결되지 않아 검토 기록이 없습니다.</p>

        <h3>이력</h3>
        <p className="hint">판본·이력 API가 연결되지 않아 이력이 없습니다.</p>

        <div className="action">
          <button className="button" id="register-skill" type="button" disabled aria-describedby="register-skill-reason">스킬로 등록</button>
          <p className="hint" id="register-skill-reason">스킬 등록 기능이 아직 연결되지 않았습니다.</p>
        </div>
      </div>
    </details>
  );
}
