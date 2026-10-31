// 화면 머리말. 모드 표시는 실행 정보 훅의 결과를 그대로 보여 준다.

import type { JSX } from 'react';

export function Masthead(props: { modeLabel: string }): JSX.Element {
  return (
    <header className="masthead">
      <div className="masthead__inner">
        <div className="masthead__brand">
          <h1>SafeHandoff</h1>
          <p className="masthead__tagline">공개 전 확인 작업 공간</p>
        </div>
        <p className="masthead__mode">
          <span className="meta">모드</span>
          <span id="mode-label" role="status" aria-live="polite">{props.modeLabel}</span>
        </p>
      </div>

      <nav className="masthead__nav" aria-label="화면 구역">
        <a href="#workspace">작업 공간</a>
        <a href="#session">로컬 접속</a>
        <a href="#disclosure-decisions">공개 결정</a>
        <a href="#analysis-results">분석 결과</a>
        <a href="#saved-documents">저장 문서</a>
        <a href="#execution-environment">실행 정보</a>
      </nav>
    </header>
  );
}
