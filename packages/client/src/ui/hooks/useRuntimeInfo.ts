// 실행 환경 정보(GET /api/core). 모드·연결·준비 상태 문구와 실패 문구를 이전 화면 그대로 옮겼다.
// 확인에 실패하면 실제/개발용 여부를 추정해 표시하지 않는다.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RuntimeInfoApi {
  modeLabel: string;
  connectionLabel: string;
  status: string;
  busy: boolean;
  check: () => void;
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

export function useRuntimeInfo(): RuntimeInfoApi {
  const [modeLabel, setModeLabel] = useState('확인 전');
  const [connectionLabel, setConnectionLabel] = useState('확인 전');
  const [status, setStatus] = useState('실행 환경을 확인하는 중입니다.');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const showUnknown = useCallback((reason: string): void => {
    setModeLabel('확인 불가 — 실제/개발용 여부 표시 안 함');
    setConnectionLabel('연결 확인 불가');
    setStatus(`실행 환경을 확인하지 못했습니다. ${reason} 실제 모델인지 개발용 예시인지 추정해 표시하지 않습니다.`);
  }, []);

  const check = useCallback((): void => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setStatus('실행 환경을 확인하는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const response = await fetch('/api/core');
        if (!response.ok) {
          showUnknown(errorMessage(response.status, await readErrorCode(response)));
          return;
        }
        const info = await response.json() as Record<string, unknown>;
        if (info.implementation === 'real') {
          setModeLabel('실제 모델');
        } else if (info.implementation === 'fake') {
          setModeLabel('개발용 예시 응답 — 실제 모델 실행 아님');
        } else {
          showUnknown('응답의 실행 구현 값이 real 또는 fake가 아닙니다.');
          return;
        }
        if (info.connection === 'direct') setConnectionLabel('직접 연결');
        else if (info.connection === 'simulated') setConnectionLabel('시뮬레이션 연결');
        else setConnectionLabel('연결 표기 확인 불가');

        const readyText = info.ready === true ? '준비됨' : info.ready === false ? '준비되지 않음' : '준비 상태 미표시';
        const readyNote = info.implementation === 'fake'
          ? '실제 모델은 호출하지 않습니다.'
          : '설정 상태이며 모델 호출 성공을 뜻하지 않습니다.';
        setStatus(`모델 설정: ${readyText}. ${readyNote}`);
      } catch {
        showUnknown('서버에 연결할 수 없습니다.');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [showUnknown]);

  useEffect(() => {
    check();
  }, [check]);

  return { modeLabel, connectionLabel, status, busy, check };
}
