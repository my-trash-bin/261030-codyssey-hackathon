import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

// Only fake-app serves this page. These choices are presentation state, not grants.
type FactKind = 'observation' | 'unknown' | 'identifier' | 'series' | 'timeline' | 'config_example';

const FACTS: ReadonlyArray<readonly [FactKind, string]> = [
  ['observation', '첫 요청에서 클라이언트 응답 대기 시간이 초과됐습니다.'],
  ['observation', '재시도에는 성공 응답을 받았습니다.'],
  ['unknown', '최초 요청의 서버 완료·중복 처리 여부와 요청량 변화의 인과관계는 확인하지 못했습니다.'],
  ['identifier', 'operation_id: op_demo_007'],
  ['identifier', 'attempt_id: try_demo_001, try_demo_002'],
  ['series', '요청량 추이: 첫 관찰 → 증가 → 증가. 실제 건수와 비율은 공개하지 않습니다.'],
  ['timeline', '사건 순서: 요청 전송 → 대기 시간 초과 → 재시도 → 응답 수신.'],
  ['config_example', '새 설정 예시를 첨부할 수 있습니다. 실제 접속 로그의 주소 공개를 허용하는 것은 아닙니다.'],
];

const presentationKinds = FACTS.map(([kind]) => kind);
Object.assign(window, { presentationKinds });

const kindNames: Record<FactKind, string> = {
  observation: '관찰', unknown: '미확인', identifier: '추적 ID',
  series: '요청량', timeline: '사건 순서', config_example: '새 설정 예시',
};

type SharingResponse = {
  document: { title: string; body: string };
  provenance: { implementation: string; connection: string; ready: boolean };
};
type SavedResponse = { document: { id: string } };
type RecordsResponse = { documents: Array<{ id: string; text: string }> };

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw Error(typeof value['error'] === 'string' ? value['error'] : '요청 실패');
  return value as unknown as T;
}

type Stage = 'intake' | 'workspace' | 'final';

function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('intake');
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<ReadonlySet<number>>(new Set<number>());
  const [choices, setChoices] = useState<ReadonlyMap<number, string>>(new Map<number, string>());
  const [selection, setSelection] = useState<Record<number, string>>({});
  const [output, setOutput] = useState('');
  const [hash, setHash] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);

  async function guard(work: () => Promise<void>): Promise<void> {
    setError('');
    try { await work(); } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function create(): Promise<void> {
    const files = Array.from(filesRef.current?.files ?? []);
    if (files.length !== 3) throw Error('지정 가상 자료 3개를 선택하세요.');
    await Promise.all(files.map((file) => file.text()));
    setChoices(new Map<number, string>()); setPreviews(new Set<number>()); setOutput(''); setHash(''); setSavedId(null);
    setStage('workspace');
  }

  function preview(index: number): void {
    setPreviews((previous) => new Set(previous).add(index));
  }

  function apply(index: number, text: string): Promise<void> {
    return guard(async () => {
      if (!previews.has(index)) throw Error('미리보기를 먼저 확인하세요.');
      setChoices((previous) => new Map(previous).set(index, text));
      setOutput('');
    });
  }

  function compose(): Promise<void> {
    return guard(async () => {
      if (choices.size !== FACTS.length) throw Error('모든 시연 선택을 적용하세요.');
      const result = await request<SharingResponse>('/api/sharing', {
        purpose: '공급사 기술지원 문의', recipient: '지정 가상 공급사',
        facts: [...choices].map(([index, text]) => ({ id: 'demo-' + index, text })),
      });
      if (result.provenance.implementation !== 'fake') throw Error('가짜 앱에서만 시연할 수 있습니다.');
      const text = result.document.title + '\n\n' + result.document.body;
      const saved = await request<SavedResponse>('/api/documents', { text });
      const records = await request<RecordsResponse>('/api/documents');
      if (!records.documents.some((doc) => doc.id === saved.document.id && doc.text === text)) throw Error('저장 결과 확인 실패');
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const digest = [...new Uint8Array(bytes)].map((number) => number.toString(16).padStart(2, '0')).join('');
      setSavedId(saved.document.id);
      setOutput(text);
      setHash(digest);
    });
  }

  const statusText = `${output ? '가짜 초안 작성 완료' : '연출용 공개 선택'} · 실제 서버 승인 아님`;

  return (
    <>
      <header><strong>SafeHandoff</strong><span>공유 자료 준비</span><a href="/__demo">연출 설정</a></header>
      <p className="mode">FAKE APP · 분석·공개 선택은 브라우저 연출이며 실제 승인 기능이 아닙니다. 실제 모델 호출 없음.</p>
      <main id="app">
        {stage === 'intake' ? (
          <div className="narrow"><span className="badge">01 · 목적과 자료</span><h1>무엇을 공유하시나요?</h1>
            <p>가상 자료로 준비 흐름을 설명합니다. 분석·선택·미리보기는 연출 전용입니다.</p><section className="panel">
              <label htmlFor="title">작업 이름</label><input id="title" defaultValue="공급사 문의 준비" />
              <label htmlFor="purpose">공유 목적</label><input id="purpose" defaultValue="공급사 기술지원 문의" />
              <label htmlFor="recipient">수신자</label><input id="recipient" defaultValue="지정 가상 공급사" />
              <label htmlFor="files">가상 자료 파일</label><input id="files" type="file" multiple ref={filesRef} />
              <p>선택한 파일은 브라우저 안에서만 읽습니다. 이 연출 화면은 실제 분석 API를 호출하지 않습니다.</p>
              <button className="primary" id="create" onClick={() => { void guard(create); }}>가상 분석 장면으로</button></section></div>
        ) : stage === 'workspace' ? (
          <>
            <h1>공급사 문의 준비</h1>
            <p className="status">{statusText}</p>
            <div className="grid"><section className="panel"><h2>공개 선택 · 연출</h2>
              <p>고정된 가상 후보입니다. 실제 분석 결과가 아닙니다.</p>
              {FACTS.map(([kind, text], index) => (
                <article className="card" key={kind + ':' + index}><span className="badge">{kindNames[kind]}</span><h3>{text}</h3>
                  <label htmlFor={'choice-' + index}>공개 방법</label>
                  <select
                    id={'choice-' + index}
                    value={selection[index] ?? (kind === 'series' ? 'direction' : 'summary')}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelection((previous) => ({ ...previous, [index]: value }));
                    }}
                  >
                    {kind === 'series'
                      ? <option value="direction">추이만 공개</option>
                      : <option value="summary">이 표현으로 시연</option>}
                  </select>
                  <button id={'preview-' + index} onClick={() => { preview(index); }}>공개 미리보기</button>
                  <button id={'apply-' + index} disabled={!previews.has(index)} onClick={() => { void apply(index, text); }}>이 선택 적용 · 연출</button>
                  {choices.has(index) ? <span id={'revoke-' + index}>시연 선택 적용됨</span> : null}
                  <pre id={'projection-' + index} hidden={!previews.has(index)}>{text}</pre></article>
              ))}
            </section><section className="panel"><h2>현재 초안</h2>
              <p>선택한 가상 표현으로 시연 문서를 작성합니다. 실제 모델은 호출하지 않습니다.</p>
              {output
                ? <>
                  <pre className="draft">{output}</pre>
                  <a
                    className="button" id="demo-final-link" href="#__final"
                    onClick={(event) => { event.preventDefault(); setError(''); setStage('final'); }}
                  >최종 파일 확인 →</a>
                </>
                : <p>모든 가상 후보의 미리보기를 확인하고 시연 선택을 적용하세요.</p>}
              <button className="primary" id="compose" onClick={() => { void compose(); }}>현재 선택으로 작성</button></section></div>
          </>
        ) : (
          <div className="narrow"><h1>실제 생성·저장된 가짜 초안</h1>
            <p>생성한 문서의 저장 결과입니다. 실제 공개 승인·확정·내보내기 구현을 뜻하지 않습니다.</p>
            <section className="panel"><article className="file"><strong>support-request.md</strong>
              <details open><summary>생성 내용과 SHA-256</summary><pre>{hash + '\n\n' + output}</pre></details></article>
              <label><input type="checkbox" id="confirmed" />내용 확인 · 연출 전용</label>
              <p>문서 ID: {savedId}. 실제 공개·외부 제출은 수행하지 않습니다.</p></section></div>
        )}
      </main>
      <p id="error" role="alert">{error}</p>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('UI 계약 위반: #root를 찾을 수 없습니다.');
createRoot(root).render(<App />);
