// 실행 정보 구역. 위쪽 모드 표시와 같은 실행 정보 훅 결과를 그대로 보여 준다.
// 확인에 실패하면 모드나 연결 방식을 추정해 표시하지 않는다.
// embedded는 화면 머리말이 이미 제목을 보여 줄 때 쓴다.

import type { JSX } from 'react';
import type { RuntimeInfoApi } from './hooks/useRuntimeInfo.ts';

export function ExecutionSection(props: { runtime: RuntimeInfoApi; embedded?: boolean }): JSX.Element {
  const { runtime, embedded = false } = props;

  const scope = (
    <>
      <div className="env">
        <h3>이 화면에서 확인할 수 없는 것</h3>
        <ul className="plain-list">
          <li>모델 주소가 승인된 사내·로컬 환경인지 여부. 운영자의 승인은 별도로 필요합니다.</li>
          <li>모델 품질과 외부 제출 허가. 분석 결과나 검토 통과가 외부 반출 승인을 대신하지 않습니다.</li>
        </ul>
      </div>
      <div className="env">
        <h3>지원하지 않는 범위</h3>
        <ul className="plain-list">
          <li>승인 발췌·타임라인 공개 표현과 재현 실행 연결</li>
          <li>스킬 팩 등록, 다중 사용자 권한, LAN 운영 인증</li>
          <li>외부 게시·메시지 전송. 내보낸 파일은 직접 전달합니다.</li>
        </ul>
      </div>
    </>
  );

  return (
    <section className={`execution${embedded ? ' execution--embedded' : ''}`} id="execution-environment" aria-labelledby={embedded ? undefined : 'env-heading'} aria-label={embedded ? '연결 상태' : undefined} tabIndex={-1}>
      {embedded ? null : (
        <div className="execution__head">
          <h2 id="env-heading">실행 정보</h2>
          <p className="hint">위쪽 모드 표시는 서버 설정이며 모델 호출 성공을 뜻하지 않습니다.</p>
        </div>
      )}

      <div className="runtime" role="group" aria-label="연결 상태">
        <p className="runtime__connection">
          <span className="meta">연결</span>
          <span id="connection-label">{runtime.connectionLabel}</span>
        </p>
        <p className="status" id="runtime-status" role="status" aria-live="polite">{runtime.status}</p>
        <button
          className="button button--small"
          id="runtime-refresh"
          type="button"
          disabled={runtime.busy}
          aria-busy={runtime.busy ? 'true' : undefined}
          onClick={() => { runtime.check(); }}
        >상태 다시 확인</button>
      </div>

      {embedded
        ? scope
        : (
          <details className="fold">
            <summary>이 화면의 범위</summary>
            <div className="fold__body">{scope}</div>
          </details>
        )}
    </section>
  );
}
