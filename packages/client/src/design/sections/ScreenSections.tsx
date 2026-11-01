import type { JSX, ReactNode } from 'react';

/**
 * 화면을 이루는 나머지 컴포넌트. 작업 화면과 같은 클래스를 그대로 쓰므로,
 * 여기서 보이는 모양이 실제 화면과 같다.
 */

const RAIL_SAMPLE = [
  { number: '01', title: '목적과 자료', detail: '완료 · 원자료 2개', state: 'done' },
  { number: '02', title: '자료 분석', detail: '완료 · 후보 1개', state: 'done' },
  { number: '03', title: '공개 결정', detail: '결정 1 / 1', state: 'ready' },
  { number: '04', title: '초안 작성', detail: '대기 · 파일 없음', state: 'waiting' },
];

const PROGRESS_STATES = ['done', 'done', 'next', 'waiting', 'waiting', 'waiting'];

function Section(props: { id: string; title: string; lede: string; children: ReactNode }): JSX.Element {
  return (
    <section className="ds-section" aria-labelledby={props.id}>
      <header className="ds-section__head">
        <h2 id={props.id}>{props.title}</h2>
        <p className="ds-section__lede">{props.lede}</p>
      </header>
      {props.children}
    </section>
  );
}

export function ShellSection(): JSX.Element {
  return (
    <Section
      id="ds-shell"
      title="머리말과 단계 목록"
      lede="위쪽 머리말은 지금 모드·세션·작업과 진행 막대를, 왼쪽 목록은 여섯 단계와 다른 화면 이동을 보여 준다."
    >
      <div className="ds-demo">
        <header className="masthead">
          <div className="masthead__inner">
            <div className="masthead__brand">
              <h1>SafeHandoff</h1>
              <p className="masthead__tagline">공개할 내용만, 안전하게 전달</p>
            </div>
            <dl className="masthead__facts">
              <div><dt className="meta">모드</dt><dd>개발 예시</dd></div>
              <div><dt className="meta">세션</dt><dd>열림</dd></div>
              <div><dt className="meta">작업</dt><dd>API 시간 초과 문의</dd></div>
            </dl>
          </div>
          <div className="masthead__progress">
            <ol className="progress" aria-label="진행 예시">
              {PROGRESS_STATES.map((state, index) => (
                <li key={index} className={`progress__segment progress__segment--${state}`}>
                  <span className="progress__number">{String(index + 1).padStart(2, '0')}</span>
                </li>
              ))}
            </ol>
          </div>
        </header>

        <nav className="rail" aria-label="작업 흐름 예시">
          <div className="rail__head">
            <p className="meta">작업 흐름</p>
          </div>
          <ol className="rail__steps">
            {RAIL_SAMPLE.map(step => (
              <li key={step.number}>
                <button
                  className={`rail__step rail__step--${step.state}${step.state === 'ready' ? ' rail__step--active' : ''}`}
                  type="button"
                >
                  <span className="rail__number" aria-hidden="true">{step.number}</span>
                  <span className="rail__text">
                    <span className="rail__title">{step.title}</span>
                    <span className="rail__detail">{step.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="rail__secondary">
            <p className="meta">다른 화면</p>
            <ul className="rail__views">
              {['재사용 규칙', '검토 이력', '문서 보관소', '실행 정보'].map(label => (
                <li key={label}><button className="rail__view" type="button">{label}</button></li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </Section>
  );
}

export function StepSection(): JSX.Element {
  return (
    <Section
      id="ds-step"
      title="단계 화면"
      lede="단계 하나는 머리줄, 본문, 이동 줄로 나뉜다. 머리줄에는 단계 번호·상태 칩·제목·설명이 들어간다."
    >
      <div className="ds-demo">
        <article className="step">
          <header className="step__head">
            <p className="step__eyebrow">
              <span className="meta">단계 03 / 06</span>
              <span className="chip chip--current">진행 중</span>
              <span className="meta">결정 1 / 1</span>
            </p>
            <h2>공개 결정</h2>
            <p className="step__purpose">후보마다 공개 여부와 표현 방식을 정합니다. 결정은 저장해 두고 초안에 반영합니다.</p>
          </header>
          <div className="step__body">
            <p className="hint">본문 안의 블록은 20px 간격으로 쌓는다.</p>
          </div>
          <footer className="step__nav">
            <button className="button button--quiet" type="button">이전 · 자료 분석</button>
            <button className="button" type="button">다음 · 초안 작성</button>
          </footer>
        </article>
      </div>
    </Section>
  );
}

export function CandidateSection(): JSX.Element {
  return (
    <Section
      id="ds-candidate"
      title="후보 카드"
      lede="공개 결정 대상은 용지색 카드와 왼쪽 괘선으로 구분한다. 처리 선택은 라디오 행으로 두고, 고른 뒤에만 하위 선택이 열린다."
    >
      <div className="ds-demo">
        <div className="candidate">
          <fieldset className="candidate__group">
            <legend className="candidate__legend">후보 1 · observation · 필수</legend>
            <p className="candidate__statement">10월 1일부터 3일까지 요청량이 늘었습니다.</p>
            <p className="hint">후보 ID 6c4213ea-61c8-4e21-93d2-0ccdb837aad8</p>
            <p className="hint">불확실성: observed</p>
            <div className="option">
              <input id="ds-candidate-allow" type="radio" name="ds-candidate" defaultChecked />
              <label htmlFor="ds-candidate-allow">공개에 포함한다</label>
            </div>
            <div className="option">
              <input id="ds-candidate-exclude" type="radio" name="ds-candidate" />
              <label htmlFor="ds-candidate-exclude">공개에서 뺀다</label>
            </div>
          </fieldset>
        </div>
      </div>
    </Section>
  );
}

export function FoldSection(): JSX.Element {
  return (
    <Section
      id="ds-fold"
      title="접이식 영역"
      lede="보조 정보는 접어 둔다. 화살표와 제목은 같은 줄에 두고, 제목 크기는 본문과 같게 유지한다. 내부 참고 영역만 머리줄 왼쪽에 인주색 괘선을 둔다."
    >
      <div className="ds-demo ds-stack">
        <details className="fold">
          <summary>규칙 저장 기록 <span className="meta">3건</span></summary>
          <div className="fold__body">
            <p className="hint">접힌 상태에서는 머리줄만 보인다.</p>
          </div>
        </details>

        <details className="block--fold">
          <summary className="hint">기술 정보 전체 보기</summary>
          <div className="fold__body">
            <ul className="plain-list">
              <li>초안 ID: draft_01</li>
              <li>작업 판본: 4</li>
            </ul>
          </div>
        </details>

        <details className="block--fold" open>
          <summary><h3>DocAST 직접 편집</h3></summary>
          <div className="fold__body">
            <p className="hint">제목이 화살표와 같은 줄에 놓인다.</p>
          </div>
        </details>

        <details className="block--fold block--fold--internal">
          <summary>
            <h2>내부 근거와 검토</h2>
            <span className="chip chip--internal">내부용</span>
          </summary>
          <div className="fold__body">
            <p className="hint">내부 참고용입니다. 공유 파일에는 포함되지 않습니다.</p>
          </div>
        </details>
      </div>
    </Section>
  );
}

export function EmptySection(): JSX.Element {
  return (
    <Section
      id="ds-empty"
      title="빈 상태"
      lede="자료가 없을 때는 무엇이 없는지와 다음에 할 일을 문장으로 적는다. 아이콘이나 그림을 넣지 않는다."
    >
      <div className="ds-demo">
        <div className="disclosures__empty">
          <p className="status">아직 조회한 작업이 없습니다. 위에 작업 ID를 입력해 조회하세요.</p>
          <p className="hint">조회에는 인증된 세션이 필요합니다. API 비활성·미인증·작업 부재는 서버 오류 코드로 구분합니다.</p>
        </div>
      </div>
    </Section>
  );
}

export function InspectorSection(): JSX.Element {
  return (
    <Section
      id="ds-inspector"
      title="정보 열"
      lede="오른쪽 정보 열은 다음 할 일, 작업 집계, 최근 실행을 헤어라인으로 나눠 쌓는다."
    >
      <div className="ds-grid-2">
        <section className="inspector__block">
          <h2 className="meta">다음에 할 일</h2>
          <p className="inspector__lead">3단계 · 공개 결정</p>
          <p className="hint">후보마다 공개 여부를 정하면 초안을 만들 수 있습니다.</p>
        </section>
        <section className="inspector__block">
          <h2 className="meta">작업 집계</h2>
          <dl className="factgrid">
            <div><dt>원자료</dt><dd>2개</dd></div>
            <div><dt>후보</dt><dd>1개</dd></div>
            <div><dt>결정</dt><dd>1 / 1</dd></div>
            <div><dt>초안</dt><dd>없음</dd></div>
          </dl>
        </section>
      </div>
    </Section>
  );
}

export function PanelSection(): JSX.Element {
  return (
    <Section
      id="ds-panel"
      title="상자와 행동 줄"
      lede="정보 상자는 제목과 본문을 헤어라인으로 나누고, 행동 줄은 버튼을 왼쪽부터 늘어놓는다. 문서 미리보기는 용지색 바탕과 굵은 테두리를 쓴다."
    >
      <div className="ds-grid-2">
        <section className="panel">
          <h3>세션 연결</h3>
          <p className="hint">작업 ID를 넣고 조회하면 세션이 열린다. 세션은 화면을 닫아도 서버에 남는다.</p>
          <div className="actions">
            <button className="button button--solid" type="button">세션 열기</button>
            <button className="button button--quiet" type="button">취소</button>
          </div>
        </section>

        <section className="panel">
          <h3>다음 행동</h3>
          <div className="action">
            <button className="button button--small" type="button">후보 다시 불러오기</button>
            <p className="hint">서버가 후보를 새로 계산합니다. 기존 결정은 유지됩니다.</p>
          </div>
        </section>
      </div>

      <article className="draft__sheet">
        <h3>공유 초안 미리보기</h3>
        <p>10월 1일부터 3일까지 요청량이 늘었습니다.</p>
        <p className="hint">공유 파일에는 이 문장만 들어갑니다. 근거 위치는 내부 화면에서만 봅니다.</p>
      </article>
    </Section>
  );
}
