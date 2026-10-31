import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

type DemoSettings = {
  script: { title: string; opening: string; closing: string };
  connection: { delayMs: number; failuresRemaining: number };
};

type SharingResult = {
  document: { title: string; body: string };
  provenance: { implementation: string; connection: string; ready: boolean };
};

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, body === undefined ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof value['error'] === 'string' ? value['error'] : 'REQUEST_FAILED');
  return value as unknown as T;
}

function App(): JSX.Element {
  const [title, setTitle] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [delay, setDelay] = useState('0');
  const [failures, setFailures] = useState('0');
  const [purpose, setPurpose] = useState('공급사 기술지원 문의');
  const [recipient, setRecipient] = useState('지정 가상 공급사');
  const [facts, setFacts] = useState(`첫 요청은 응답 대기 timeout, 재시도는 HTTP 200을 관찰했습니다.
첫 서버 처리 완료와 중복 여부는 모릅니다.
처리 결과와 안전한 재시도 조건을 문의합니다.`);
  const [status, setStatus] = useState('');
  const [output, setOutput] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const value = await api<DemoSettings>('/api/demo/settings');
    setTitle(value.script.title);
    setOpening(value.script.opening);
    setClosing(value.script.closing);
    setDelay(String(value.connection.delayMs));
    setFailures(String(value.connection.failuresRemaining));
  }, []);

  useEffect(() => {
    load().catch((error: unknown) => setStatus(String(error)));
  }, [load]);

  async function applySettings(): Promise<void> {
    try {
      await api('/api/demo/settings', {
        script: { title, opening, closing },
        connection: { delayMs: Number(delay), failuresRemaining: Number(failures) },
      }, 'PUT');
      setStatus('다음 시연 요청에 적용했습니다.');
    } catch (error) { setStatus(String(error)); }
  }

  async function generate(): Promise<void> {
    setStatus('가짜 연결부를 통해 생성 중입니다…');
    setOutput('');
    try {
      const result = await api<SharingResult>('/api/sharing', {
        purpose, recipient,
        facts: facts.split('\n').filter(line => line.trim()).map((text, i) => ({ id: `fact-${i}`, text })),
      });
      setOutput(`${result.document.title}\n\n${result.document.body}`);
      setStatus(`${result.provenance.implementation} 코어 · ${result.provenance.connection} 연결 · 완료`);
    } catch (error) { setStatus(String(error)); }
    finally {
      try { await load(); } catch (error) { setStatus(String(error)); }
    }
  }

  return (
    <>
      <h1>가짜 코어·연결부 연출 조절</h1>
      <p>실제 모델을 호출하지 않습니다. 여기서 바꾼 연출은 다음 시연 요청부터 적용하며 진짜 코어에는 영향을 주지 않습니다.</p>
      <form id="settings" onSubmit={(event) => { event.preventDefault(); void applySettings(); }}>
        <fieldset><legend>가짜 코어</legend>
          <label>공유본 제목 <input id="title" required value={title} onChange={(event) => setTitle(event.target.value)} /></label><br />
          <label>도입 문장 <textarea id="opening" value={opening} onChange={(event) => setOpening(event.target.value)} /></label><br />
          <label>마무리 문장 <textarea id="closing" value={closing} onChange={(event) => setClosing(event.target.value)} /></label>
        </fieldset>
        <fieldset><legend>가짜 연결부</legend>
          <label>응답 지연(ms) <input id="delay" type="number" min="0" max="30000" value={delay} onChange={(event) => setDelay(event.target.value)} /></label>
          <label>앞으로 실패할 요청 수 <input id="failures" type="number" min="0" max="10" value={failures} onChange={(event) => setFailures(event.target.value)} /></label>
        </fieldset>
        <button>연출 적용</button>
      </form>
      <h2>같은 인터페이스로 재생성 시험</h2>
      <form id="generate" onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <label>목적 <input id="purpose" required value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
        <label>수신자 <input id="recipient" required value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label><br />
        <label>공개 승인한 표현 · 한 줄에 하나씩<br /><textarea id="facts" rows={5} cols={80} required value={facts} onChange={(event) => setFacts(event.target.value)} /></label><br />
        <button>시연 공유본 생성</button>
      </form>
      <p id="status" role="status">{status}</p>
      <pre id="output">{output}</pre>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('UI 계약 위반: #root를 찾을 수 없습니다.');
createRoot(root).render(<App />);
