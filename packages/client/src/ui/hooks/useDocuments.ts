// 내부 텍스트 보관(GET·POST /api/documents).
// 저장 전에 시작한 조회를 기다린 뒤 다시 조회하는 순서와, 저장 중에 사용자가 더 쓴 내용을
// 지우지 않는 규칙을 이전 화면 그대로 유지한다.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DocumentRecord { id: string; text: string; createdAt: string }
type LoadResult = 'ok' | 'failed';

export interface DocumentsApi {
  records: DocumentRecord[];
  status: string;
  saveStatus: string;
  busy: boolean;
  saveBusy: boolean;
  loaded: boolean;
  text: string;
  textInvalid: boolean;
  setText: (value: string) => void;
  load: () => void;
  save: () => void;
}

function errorMessage(status: number, code: string): string {
  if (status === 400) return '내용이 비어 있거나 형식이 올바르지 않습니다. 입력을 확인하세요.';
  if (status === 401) return '세션이 없거나 만료되었습니다. 운영자 토큰으로 세션을 먼저 여세요.';
  if (status === 403) return '세션 경계 검사에서 거부되었습니다. 브라우저 주소가 서버의 loopback origin과 같은지 확인하세요.';
  if (status === 413) return '내용이 너무 큽니다. 길이를 줄여 다시 저장하세요.';
  if (status === 415) return '요청 형식이 거부되었습니다. 화면을 새로 고친 뒤 다시 시도하세요.';
  if (status === 502) return '서버에 연결하지 못했습니다. 실행 상태를 확인하세요.';
  if (status >= 500) return '서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
  return code ? `요청에 실패했습니다(${code}).` : '요청에 실패했습니다.';
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch { return ''; }
}

function parseRecords(value: unknown): DocumentRecord[] | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.text !== 'string' || typeof record.createdAt !== 'string') return null;
  }
  return value as DocumentRecord[];
}

// 전역 fetch는 receiver를 요구하므로 호출 시점에 메서드로 부른다. 렌더마다 새 함수를 만들지 않는다.
const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function useDocuments(options?: { csrfToken?: string | null; fetch?: typeof fetch }): DocumentsApi {
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState('저장된 문서를 불러오는 중입니다.');
  const [saveStatus, setSaveStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setTextState] = useState('');
  const [textInvalid, setTextInvalid] = useState(false);

  // /api/documents는 운영자가 세션 경계를 켠 서버에서만 /api/v1/*과 같은 경계 안에 든다
  // (packages/server/src/app.ts의 GUARDED_PATHS, sessions 옵션). 세션이 있으면 쓰기에 CSRF
  // 토큰을 싣고, 없으면 경계가 꺼진 서버의 legacy 경로 그대로 보낸다.
  const csrfToken = options?.csrfToken ?? '';
  const fetchFn = options?.fetch ?? defaultFetch;
  const textRef = useRef('');
  const savingRef = useRef(false);
  const loadedRef = useRef(false);
  const documentsRequest = useRef<Promise<LoadResult> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const fetchDocuments = useCallback(async (): Promise<LoadResult> => {
    setBusy(true);
    setStatus('저장된 문서를 조회하는 중입니다…');
    const staleNote = loadedRef.current ? ' 아래 목록은 이전 조회 결과입니다.' : '';
    try {
      const response = await fetchFn('/api/documents', { credentials: 'same-origin' });
      if (!aliveRef.current) return 'failed';
      if (!response.ok) {
        const code = await readErrorCode(response);
        if (!aliveRef.current) return 'failed';
        setStatus(loadedRef.current
          ? `목록 갱신에 실패했습니다(${errorMessage(response.status, code)})${staleNote}`
          : `문서 목록을 조회하지 못했습니다. ${errorMessage(response.status, code)}`);
        return 'failed';
      }
      const result = await response.json() as { documents?: unknown };
      if (!aliveRef.current) return 'failed';
      const parsed = parseRecords(result.documents);
      if (!parsed) {
        setStatus(`목록 응답 형식이 올바르지 않아 표시하지 않았습니다.${staleNote}`);
        return 'failed';
      }
      setRecords(parsed);
      loadedRef.current = true;
      setLoaded(true);
      setStatus(parsed.length
        ? `저장된 문서 ${parsed.length}건을 표시했습니다.`
        : '저장된 내부 텍스트가 없습니다.');
      return 'ok';
    } catch {
      if (!aliveRef.current) return 'failed';
      setStatus(loadedRef.current
        ? `목록 갱신에 실패했습니다.${staleNote}`
        : '문서 목록을 조회하지 못했습니다. 서버에 연결할 수 없습니다.');
      return 'failed';
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [fetchFn]);

  const load = useCallback((): Promise<LoadResult> => {
    if (!documentsRequest.current) {
      documentsRequest.current = fetchDocuments().finally(() => { documentsRequest.current = null; });
    }
    return documentsRequest.current;
  }, [fetchDocuments]);

  const runSave = useCallback(async (submitted: string): Promise<void> => {
    savingRef.current = true;
    setSaveBusy(true);
    setSaveStatus('내부 텍스트를 저장하는 중입니다…');
    try {
      const response = await fetchFn('/api/documents', {
        method: 'POST',
        // 세션이 열린 화면(운영자가 워크플로 경계를 켠 서버)에서만 CSRF 토큰을 싣는다.
        // 경계가 꺼진 서버의 legacy 저장은 기존과 똑같이 헤더 없이 나간다(app.ts의 sessions 옵션).
        headers: csrfToken === ''
          ? { 'Content-Type': 'application/json' }
          : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        credentials: 'same-origin',
        body: JSON.stringify({ text: submitted }),
      });
      if (!aliveRef.current) return;
      if (!response.ok) {
        const code = await readErrorCode(response);
        if (!aliveRef.current) return;
        setSaveStatus(`저장하지 못했습니다. ${errorMessage(response.status, code)} 입력한 내용은 그대로 남아 있습니다.`);
        return;
      }
      // 요청 중에 사용자가 새로 쓴 내용은 지우지 않는다.
      if (textRef.current === submitted) {
        textRef.current = '';
        setTextState('');
        setTextInvalid(false);
      }
      setSaveStatus('내부 텍스트를 저장했습니다. 목록을 다시 조회합니다…');
      // 저장 전에 시작한 조회를 마친 뒤, 저장 이후 목록을 새로 요청한다.
      if (documentsRequest.current) await documentsRequest.current;
      const result = await load();
      if (!aliveRef.current) return;
      setSaveStatus(result === 'ok'
        ? '내부 텍스트를 저장했습니다. 저장 목록을 갱신했습니다.'
        : '내부 텍스트 저장은 완료되었습니다. 다만 저장 목록 갱신에 실패했습니다(저장 실패 아님).');
    } catch {
      if (!aliveRef.current) return;
      setSaveStatus('저장하지 못했습니다. 서버에 연결할 수 없습니다. 입력한 내용은 그대로 남아 있습니다.');
    } finally {
      if (!aliveRef.current) return;
      savingRef.current = false;
      setSaveBusy(false);
    }
  }, [csrfToken, fetchFn, load]);

  const setText = useCallback((value: string): void => {
    textRef.current = value;
    setTextState(value);
    if (!textInvalid) return;
    setTextInvalid(false);
    setSaveStatus('');
  }, [textInvalid]);

  const save = useCallback((): void => {
    if (savingRef.current) return;
    const submitted = textRef.current;
    if (!submitted.trim()) {
      setSaveStatus('저장할 텍스트가 비어 있습니다. 내부 메모로 남길 내용을 입력하세요.');
      setTextInvalid(true);
      return;
    }
    void runSave(submitted);
  }, [runSave]);

  useEffect(() => {
    // 첫 조회는 세션 유무와 상관없이 한다(워크플로 경계가 꺼진 서버는 legacy 경로 그대로 응답).
    // 세션 CSRF 토큰이 도착하면 진행 중 조회(세션 열기 전 401)를 마친 뒤 새 세션으로 다시 조회한다.
    // load()는 진행 중 조회를 dedup하므로, 기다리지 않고 부르면 401이 끝난 뒤에도 요청이 없다.
    // 취소 표시는 effect 수명에만 쓰고, 언마운트 판단(aliveRef)과 분리한다.
    let cancelled = false;
    void (async (): Promise<void> => {
      if (documentsRequest.current) await documentsRequest.current;
      if (cancelled || !aliveRef.current) return;
      await load();
    })();
    return () => { cancelled = true; };
  }, [csrfToken, load]);

  return {
    records,
    status,
    saveStatus,
    busy,
    saveBusy,
    loaded,
    text,
    textInvalid,
    setText,
    load: () => { void load(); },
    save,
  };
}
