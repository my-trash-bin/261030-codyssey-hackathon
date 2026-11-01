import { useEffect, useRef, useState } from 'react';
import { FileField } from '../ui/FileField.tsx';
import {
  CandidateSection,
  EmptySection,
  FoldSection,
  InspectorSection,
  PanelSection,
  ShellSection,
  StepSection,
} from './sections/ScreenSections.tsx';
import type { JSX, RefObject } from 'react';

/**
 * 디자인 시스템 화면. 토큰과 컴포넌트 상태를 실제 CSS에서 읽어 보여 준다.
 * 값은 tokens.css의 계산 결과이므로, 토큰을 고치면 이 화면도 같이 바뀐다.
 */

const SAND = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const ACCENT = [10, 30, 50, 70];
const SUCCESS = [10, 50];
const WARNING = [10, 50];

const SURFACE_TOKENS = [
  'surface-page', 'surface-raised', 'surface-sunken', 'surface-muted',
  'surface-inverse', 'surface-accent', 'surface-accent-subtle', 'surface-disabled',
];
const TEXT_TOKENS = [
  'text-primary', 'text-secondary', 'text-muted', 'text-disabled',
  'text-inverse', 'text-accent', 'text-success', 'text-warning', 'text-danger',
];
const BORDER_TOKENS = [
  'border-subtle', 'border-default', 'border-strong', 'border-accent', 'border-focus', 'border-danger',
];

const TYPE_ROWS = [
  { token: 'type-display', sample: '공개 전 확인', usage: '화면 제목 한 번' },
  { token: 'type-title', sample: '공유 초안', usage: '단계와 화면 제목' },
  { token: 'type-heading', sample: '공개 파일과 최종 확인', usage: '구역 제목' },
  { token: 'type-subheading', sample: '확인된 사실', usage: '하위 구역, 강조 문장' },
  { token: 'type-body', sample: '승인한 사실만 문장으로 만들고, 확인하지 못한 내용은 따로 표시합니다.', usage: '본문 문단' },
  { token: 'type-body-sm', sample: '파일 이름, 판본, 해시처럼 표 안에서 읽는 값', usage: '표, 목록, 입력' },
  { token: 'type-label', sample: '상태 · 판본 · 해시', usage: '라벨과 메타' },
];

const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** 컨트롤 높이가 토큰대로인지 화면에서 직접 재어 보여 준다. */
function useControlHeights(): {
  heights: { label: string; height: string }[];
  refs: {
    input: RefObject<HTMLInputElement | null>;
    select: RefObject<HTMLSelectElement | null>;
    area: RefObject<HTMLTextAreaElement | null>;
    button: RefObject<HTMLButtonElement | null>;
  };
} {
  const refs = {
    input: useRef<HTMLInputElement>(null),
    select: useRef<HTMLSelectElement>(null),
    area: useRef<HTMLTextAreaElement>(null),
    button: useRef<HTMLButtonElement>(null),
  };
  const [heights, setHeights] = useState<{ label: string; height: string }[]>([]);
  useEffect(() => {
    const rows: { label: string; el: HTMLElement | null }[] = [
      { label: '한 줄 입력', el: refs.input.current },
      { label: '셀렉트', el: refs.select.current },
      { label: '여러 줄 입력', el: refs.area.current },
      { label: '버튼', el: refs.button.current },
    ];
    setHeights(rows.map(row => ({
      label: row.label,
      height: row.el ? `${Math.round(row.el.getBoundingClientRect().height)}px` : '-',
    })));
  }, []);
  return { heights, refs };
}

function useTokenReader(): (name: string) => string {
  const [, setTick] = useState(0);
  useEffect(() => {
    // 글꼴이나 스타일시트가 늦게 붙는 경우를 대비해 한 번 더 읽는다.
    const id = requestAnimationFrame(() => { setTick(value => value + 1); });
    return () => { cancelAnimationFrame(id); };
  }, []);
  return (name: string): string => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value === '' ? '(없음)' : value;
  };
}

function Swatch(props: { token: string; label: string; read: (name: string) => string }): JSX.Element {
  const value = props.read(`--${props.token}`);
  return (
    <li className="ds-swatch">
      <span className="ds-swatch__chip" style={{ background: `var(--${props.token})` }} aria-hidden="true" />
      <span className="ds-swatch__name">{props.token}</span>
      <span className="ds-swatch__value">{value}</span>
      <span className="ds-swatch__label">{props.label}</span>
    </li>
  );
}

export function DesignSystemPage(): JSX.Element {
  const read = useTokenReader();
  const { heights, refs } = useControlHeights();
  return (
    <div className="ds">
      <header className="ds-hero">
        <p className="ds-eyebrow">SafeHandoff · 디자인 시스템</p>
        <h1>디자인 토큰과 컴포넌트 기준</h1>
        <p className="ds-lede">
          모든 값은 <code>tokens.css</code>에만 있다. 화면 CSS는 토큰을 참조하고 직접 값을 쓰지 않는다.
          이 페이지의 색과 크기는 브라우저가 계산한 실제 값이다.
        </p>
        <ul className="ds-rules">
          <li>직각이 기본이고 그림자와 그라디언트를 쓰지 않는다.</li>
          <li>강조색은 인주색 한 가지다. 결정과 선택에만 쓴다.</li>
          <li>상태를 색만으로 구분하지 않는다. 글자나 모양을 함께 쓴다.</li>
          <li>여백과 간격은 2, 4, 8, 12, 16, 20, 24, 32, 40, 48px 눈금에서 고른다.</li>
        </ul>
        <p className="ds-note">
          <a href="./">작업 화면으로 돌아가기</a>
        </p>
      </header>

      <section className="ds-section" aria-labelledby="ds-color">
        <header className="ds-section__head">
          <h2 id="ds-color">색</h2>
          <p className="ds-section__lede">프리미티브 팔레트를 시멘틱 역할로만 쓴다. 역할 이름이 곧 용도다.</p>
        </header>

        <h3 className="ds-subhead">프리미티브</h3>
        <ul className="ds-swatches">
          {SAND.map(step => <Swatch key={`neutral-${step}`} token={`p-neutral-${step}`} label={`종이 ${step}`} read={read} />)}
        </ul>
        <ul className="ds-swatches">
          {[...ACCENT.map(step => ({ token: `p-accent-${step}`, label: `인주 ${step}` })),
            ...SUCCESS.map(step => ({ token: `p-success-${step}`, label: `성공 ${step}` })),
            ...WARNING.map(step => ({ token: `p-warning-${step}`, label: `주의 ${step}` }))]
            .map(item => <Swatch key={item.token} token={item.token} label={item.label} read={read} />)}
        </ul>

        <h3 className="ds-subhead">시멘틱 · 표면</h3>
        <ul className="ds-swatches">
          {SURFACE_TOKENS.map(token => <Swatch key={token} token={`color-${token}`} label="바탕" read={read} />)}
        </ul>

        <h3 className="ds-subhead">시멘틱 · 글자</h3>
        <ul className="ds-swatches">
          {TEXT_TOKENS.map(token => <Swatch key={token} token={`color-${token}`} label="글자" read={read} />)}
        </ul>

        <h3 className="ds-subhead">시멘틱 · 경계</h3>
        <ul className="ds-swatches">
          {BORDER_TOKENS.map(token => <Swatch key={token} token={`color-${token}`} label="경계" read={read} />)}
        </ul>
      </section>

      <section className="ds-section" aria-labelledby="ds-type">
        <header className="ds-section__head">
          <h2 id="ds-type">글자</h2>
          <p className="ds-section__lede">크기는 여섯 값만 쓴다. 역할 이름으로 고르고 숫자를 직접 쓰지 않는다.</p>
        </header>
        <dl className="ds-type">
          {TYPE_ROWS.map(row => (
            <div className="ds-type__row" key={row.token}>
              <dt>
                <span className="ds-mono">{row.token}</span>
                <span className="ds-type__meta">{`${read(`--${row.token}-size`)} / ${read(`--${row.token}-line`)}`}</span>
              </dt>
              <dd>
                <p className={`ds-type__sample ds-type__sample--${row.token}`}>{row.sample}</p>
                <p className="ds-type__usage">{row.usage}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ds-section" aria-labelledby="ds-space">
        <header className="ds-section__head">
          <h2 id="ds-space">간격과 반경</h2>
          <p className="ds-section__lede">여백, 패딩, 간격은 이 눈금에서만 고른다.</p>
        </header>
        <ul className="ds-space">
          {SPACE_STEPS.map(step => (
            <li key={step}>
              <span className="ds-mono">{`--space-${step}`}</span>
              <span className="ds-space__bar" style={{ width: `var(--space-${step})` }} aria-hidden="true" />
              <span className="ds-space__value">{read(`--space-${step}`)}</span>
            </li>
          ))}
        </ul>
        <p className="ds-note">
          반경은 <span className="ds-mono">{read('--radius-none')}</span>이 기본이고, 원형 표시만
          <span className="ds-mono">{` --radius-full`}</span>을 쓴다. 테두리는
          <span className="ds-mono">{` ${read('--border-width')}`}</span>,
          <span className="ds-mono">{` ${read('--border-width-strong')}`}</span>,
          <span className="ds-mono">{` ${read('--border-width-focus')}`}</span> 세 가지다.
        </p>
      </section>

      <section className="ds-section" aria-labelledby="ds-button">
        <header className="ds-section__head">
          <h2 id="ds-button">버튼</h2>
          <p className="ds-section__lede">기본 40px, 목록 선택 36px, 행 안 동작 32px. 같은 위계면 같은 크기를 쓴다.</p>
        </header>
        <div className="ds-row">
          <button className="button" type="button">기본 버튼</button>
          <button className="button button--solid" type="button">주 동작</button>
          <button className="button button--list" type="button">목록에서 고르기</button>
          <button className="button button--small" type="button">행 안 동작</button>
          <button className="button button--quiet" type="button">조용한 동작</button>
        </div>
        <div className="ds-row">
          <button className="button" type="button" disabled>사용할 수 없음</button>
          <button className="button button--solid" type="button" disabled>주 동작 불가</button>
          <button className="button" type="button" aria-describedby="ds-focus-note">초점을 옮겨 보기</button>
          <span className="ds-hint" id="ds-focus-note">Tab 키로 초점 고리를 확인한다.</span>
        </div>
      </section>

      <section className="ds-section" aria-labelledby="ds-form">
        <header className="ds-section__head">
          <h2 id="ds-form">입력</h2>
          <p className="ds-section__lede">
            한 줄 입력, 셀렉트, 버튼은 높이와 테두리 두께가 같다. 오류는 색과 함께 문장으로 알린다.
          </p>
        </header>
        <div className="ds-grid-2">
          <div className="field">
            <label htmlFor="ds-text">작업 제목</label>
            <input id="ds-text" ref={refs.input} type="text" defaultValue="API 시간 초과 문의" />
            <p className="hint">같은 필드 안에서 무엇을 넣는지 짧게 적는다.</p>
          </div>
          <div className="field">
            <label htmlFor="ds-select">공개 범위</label>
            <select id="ds-select" ref={refs.select} defaultValue="named_external">
              <option value="public">공개</option>
              <option value="named_external">지정 외부 수신자</option>
              <option value="named_internal">지정 내부 수신자</option>
              <option value="private">비공개</option>
            </select>
            <p className="hint">닫힌 상태는 입력과 같은 상자이고, 열린 목록도 같은 종이색과 헤어라인을 쓴다.</p>
          </div>
          <div className="field">
            <label htmlFor="ds-invalid">받는 사람</label>
            <input id="ds-invalid" type="text" aria-invalid="true" defaultValue="" />
            <p className="hint">받는 사람을 입력하세요. 저장하지 않습니다.</p>
          </div>
          <div className="field">
            <label htmlFor="ds-disabled">잠긴 필드</label>
            <input id="ds-disabled" type="text" disabled defaultValue="세션을 열면 쓸 수 있습니다" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ds-area">요약</label>
          <textarea id="ds-area" ref={refs.area} rows={3} defaultValue="승인한 사실만 문장으로 만듭니다." />
        </div>
        <div className="field">
          <label htmlFor="ds-file">파일</label>
          <FileField id="ds-file" onFiles={() => undefined} />
          <p className="hint">입력과 같은 상자 안에 버튼과 고른 파일 이름이 들어간다.</p>
        </div>
        <div className="ds-row">
          <button className="button" type="button" ref={refs.button}>기본 버튼</button>
          <label className="ds-inline"><input type="checkbox" defaultChecked /> 동의</label>
          <label className="ds-inline"><input type="checkbox" /> 미동의</label>
          <label className="ds-inline"><input type="checkbox" disabled defaultChecked /> 잠김</label>
          <label className="ds-inline"><input type="radio" name="ds-option" defaultChecked /> 허용</label>
          <label className="ds-inline"><input type="radio" name="ds-option" /> 제외</label>
        </div>
        <p className="ds-note">
          라벨과 입력 사이 8px, 입력끼리 16px로 고정한다. 실제 높이 — {heights.map(row => `${row.label} ${row.height}`).join(' / ')}
        </p>
      </section>

      <section className="ds-section" aria-labelledby="ds-status">
        <header className="ds-section__head">
          <h2 id="ds-status">상태</h2>
          <p className="ds-section__lede">칩, 진행 막대, 알림은 색 외에 글자로 상태를 밝힌다.</p>
        </header>
        <div className="ds-row">
          <span className="chip">대기</span>
          <span className="chip chip--ready">진행 가능</span>
          <span className="chip chip--current">지금 단계</span>
          <span className="chip chip--done">완료</span>
        </div>
        <div className="ds-progress" role="img" aria-label="진행 3단계 중 2단계 완료">
          {['done', 'done', 'next', 'waiting', 'waiting', 'waiting'].map((state, index) => (
            <span key={index} className={`progress__segment progress__segment--${state}`}>
              <span className="progress__number">{String(index + 1).padStart(2, '0')}</span>
            </span>
          ))}
        </div>
        <div className="ds-stack">
          <p className="status">진행 중인 작업이 없습니다.</p>
          <p className="status status--ok">초안을 만들었습니다.</p>
          <p className="status status--warn">분석 동의가 필요합니다.</p>
          <p className="status status--error">분석이 실패했습니다. (MODEL_INVALID_RESPONSE)</p>
        </div>
      </section>

      <section className="ds-section" aria-labelledby="ds-surface">
        <header className="ds-section__head">
          <h2 id="ds-surface">카드, 표, 목록</h2>
          <p className="ds-section__lede">구역은 헤어라인으로만 나눈다. 카드 안 여백은 한 값에서 나온다.</p>
        </header>
        <div className="ds-grid-2">
          <article className="panel ds-card">
            <h3>확인된 사실</h3>
            <p className="ds-card__body">10월 1일부터 3일까지 요청량이 늘었습니다.</p>
            <p className="hint">근거 user_note · 판본 4</p>
          </article>
          <article className="panel ds-card">
            <h3>확인되지 않은 사항</h3>
            <p className="ds-card__body">원인은 아직 확인되지 않았습니다.</p>
            <p className="hint">요청에 확인을 부탁하는 한 문장을 덧붙일 수 있습니다.</p>
          </article>
        </div>
        <div className="preview__scroll">
          <table className="preview__table">
            <thead>
              <tr><th scope="col">경로</th><th scope="col">형식</th><th scope="col">크기</th><th scope="col">동작</th></tr>
            </thead>
            <tbody>
              <tr><td>manifest.json</td><td>application/json</td><td>129 bytes</td><td><button className="button button--small" type="button">내용 보기</button></td></tr>
              <tr><td>support-request.md</td><td>text/markdown</td><td>241 bytes</td><td><button className="button button--small" type="button">내용 보기</button></td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <ShellSection />
      <StepSection />
      <CandidateSection />
      <FoldSection />
      <EmptySection />
      <PanelSection />
      <InspectorSection />
    </div>
  );
}
