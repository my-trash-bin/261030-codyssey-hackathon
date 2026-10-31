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
              <li>인증된 세션의 작업 등록·원자료 저장·분석 job과 서버 후보 조회</li>
              <li>A·B·C·D 서버 미리보기·사람의 공개 결정 저장·철회</li>
              <li>승인 사실로 초안 작성·검토·편집·파일 확인·확정 후 다운로드</li>
              <li>재사용 규칙 목록·판본·철회·적용과 작업 목록·이력·인증된 실행 정보 조회</li>
            </ul>
          </div>

          <div className="env">
            <h3>이 화면에서 확인할 수 없는 것</h3>
            <ul className="plain-list">
              <li>모델 주소가 승인된 사내·로컬 환경인지 여부 — 세션에 제공자 주소를 표시해도 운영자의 승인은 별도로 필요합니다</li>
              <li>모델 품질과 외부 제출 허가 — 분석 결과나 검토 통과가 외부 반출 승인을 대신하지 않습니다</li>
            </ul>
          </div>

          <div className="env">
            <h3>현재 지원하지 않는 범위</h3>
            <ul className="plain-list">
              <li>승인 발췌·타임라인 공개 표현과 재현 job 연결</li>
              <li>스킬 팩 등록·다중 사용자 권한·LAN 운영 인증</li>
              <li>외부 게시·메시지 전송 — 내보낸 파일을 실제로 전달하는 작업은 이 화면의 범위가 아닙니다</li>
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
