// 실행 정보 구역. 위쪽 모드 표시와 같은 실행 정보 훅 결과를 그대로 보여 준다.
// 확인에 실패하면 모드나 연결 방식을 추정해 표시하지 않는다.

import type { JSX } from 'react';
import type { RuntimeInfoApi } from './hooks/useRuntimeInfo.ts';

export function ExecutionSection(props: { runtime: RuntimeInfoApi }): JSX.Element {
  const { runtime } = props;

  return (
    <section className="execution" id="execution-environment" aria-labelledby="env-heading" tabIndex={-1}>
      <div className="execution__head">
        <h2 id="env-heading">실행 정보</h2>
        <p className="hint">위쪽 모드 표시는 GET /api/core의 설정 상태이며 모델 호출 성공을 뜻하지 않습니다. 확인에 실패하면 모드나 연결 방식을 추정해 표시하지 않습니다.</p>
      </div>

      <details className="fold">
        <summary>연결 방식·준비 상태·기능 범위</summary>
        <div className="fold__body">
          <div className="runtime" role="group" aria-labelledby="runtime-heading">
            <h3 id="runtime-heading">실행 환경 상태</h3>
            <p className="runtime__connection">
              <span className="meta">연결</span>
              <span id="connection-label">{runtime.connectionLabel}</span>
            </p>
            <p className="status" id="runtime-status" role="status" aria-live="polite">{runtime.status}</p>
            <button
              className="button"
              id="runtime-refresh"
              type="button"
              disabled={runtime.busy}
              aria-busy={runtime.busy ? 'true' : undefined}
              onClick={() => { runtime.check(); }}
            >상태 다시 조회</button>
          </div>

          <div className="env">
            <h3>이 화면에서 실제로 연결된 기능</h3>
            <ul className="plain-list">
              <li>GET /api/core — 실행 모드·연결 방식·준비 상태 설정 조회</li>
              <li>POST /api/analysis — 선택한 파일의 내부 근거·후보 제안 요청(분석 응답이며 공개 허가가 아닙니다)</li>
              <li>GET /api/documents — 저장된 내부 텍스트 조회</li>
              <li>POST /api/documents — 내부 텍스트 저장</li>
              <li>GET /api/v1/tasks/{'{id}'} — 공개 결정 task 집계 조회(인증된 세션 필요, API 비활성·미인증·작업 부재를 오류 코드로 구분)</li>
            </ul>
          </div>

          <div className="env">
            <h3>이 화면에서 확인할 수 없는 것</h3>
            <ul className="plain-list">
              <li>분석에 쓰이는 실제 모델의 주소와 그 모델이 승인된 사내·로컬 환경인지 여부 — GET /api/core는 구현·연결·준비 상태만 알려줍니다</li>
              <li>분석 결과의 저장 여부·공개 허가 여부 — 분석 응답은 이 화면 안에서만 쓰이고 저장되지 않습니다</li>
            </ul>
          </div>

          <div className="env">
            <h3>연결되지 않은 기능</h3>
            <ul className="plain-list">
              <li>공개 미리보기·결정 배치 저장·결정 철회·직접 입력 조건 해석 — 서버 API는 제공되며 화면 로그인·CSRF 토큰 전달 연결은 후속입니다</li>
              <li>공유 초안 생성·확정·다운로드</li>
              <li>내부 검토·이력 조회, 스킬 등록</li>
              <li>원자료 파일의 서버 저장 — 파일은 분석 요청 본문으로만 쓰이고 보관되지 않습니다</li>
              <li>POST /api/sharing 호출</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
