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

export function useDocuments(): DocumentsApi {
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState('저장된 문서를 불러오는 중입니다.');
  const [saveStatus, setSaveStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setTextState] = useState('');
  const [textInvalid, setTextInvalid] = useState(false);

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
      const response = await fetch('/api/documents');
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
  }, []);

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
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, [load]);

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
    void load();
  }, [load]);

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
