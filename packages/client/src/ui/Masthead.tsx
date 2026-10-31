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
        <a href="#task-browser">작업 목록</a>
        <a href="#task-create">목적·자료</a>
        <a href="#disclosure-decisions">공개 결정</a>
        <a href="#draft-workspace">작성·파일 확인</a>
        <a href="#reusable-rules">재사용 규칙</a>
        <a href="#task-history">검토·이력</a>
        <a href="#internal-note-panel">내부 메모</a>
        <a href="#execution-environment">실행 정보</a>
      </nav>
    </header>
  );
}
