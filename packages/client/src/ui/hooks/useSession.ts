// 로컬 접속(세션). 세션이 열려야 공개 결정 영역의 쓰기가 열린다.
// 토큰은 메모리에만 두고 저장하지 않는다. 세션 CSRF 토큰은 공개 결정 작업 공간에 넘긴다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { openSession, restoreSession, sessionFailureMessage } from '../../session-client.ts';
import type { SessionInfo } from '../../session-client.ts';

export interface SessionApi {
  token: string;
  setToken: (value: string) => void;
  busy: boolean;
  invalid: boolean;
  status: string;
  isSessionNotice: boolean;
  connect: () => void;
}

function sessionNote(session: SessionInfo): string {
  const at = new Date(session.expiresAt);
  const expiry = Number.isNaN(at.getTime())
    ? '만료 시각 확인 불가'
    : at.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const environment = session.environment;
  const providerNote = environment?.providerOrigin
    ? `분석 provider ${environment.providerOrigin}`
    : '분석 provider 주소 미표시';
  const approvalNote = environment?.approvalStatus === 'operator_confirmation_required'
    ? ' 모델 연결 승인은 운영자가 확인해야 합니다.'
    : '';
  return `만료 ${expiry}. ${providerNote}.${approvalNote}`;
}

export function useSession(onCsrfToken: (token: string) => void): SessionApi {
  const [token, setTokenState] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState('세션 상태를 확인하는 중입니다…');
  const [isSessionNotice, setIsSessionNotice] = useState(false);
  const busyRef = useRef(false);
  const tokenRef = useRef('');
  const aliveRef = useRef(true);
  // 세션 복원은 한 번만 실행하고, 토큰 수신 콜백은 최신 값을 쓴다.
  const onCsrfTokenRef = useRef(onCsrfToken);
  onCsrfTokenRef.current = onCsrfToken;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const applySession = useCallback((session: SessionInfo, restored: boolean): void => {
    onCsrfTokenRef.current(session.csrfToken);
    tokenRef.current = '';
    setTokenState('');
    setInvalid(false);
    setIsSessionNotice(true);
    setStatus(`${restored ? '이전 세션을 확인했습니다' : '세션을 열었습니다'}. ${sessionNote(session)}`);
  }, []);

  const connect = useCallback((): void => {
    if (busyRef.current) return;
    const submitted = tokenRef.current;
    busyRef.current = true;
    setBusy(true);
    setIsSessionNotice(false);
    setStatus('세션을 여는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await openSession(fetch, submitted);
        if (!aliveRef.current) return;
        if (!result.ok) {
          setStatus(sessionFailureMessage(result.failure));
          if (result.failure.kind === 'invalid_token') setInvalid(true);
          return;
        }
        applySession(result.session, false);
      } finally {
        if (!aliveRef.current) return;
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [applySession]);

  useEffect(() => {
    void (async (): Promise<void> => {
      const result = await restoreSession(fetch);
      if (!aliveRef.current) return;
      if (result.ok) {
        applySession(result.session, true);
        return;
      }
      setStatus(result.failure.kind === 'no_session'
        ? '아직 세션이 없습니다. 운영자 토큰을 입력해 세션을 시작하세요.'
        : sessionFailureMessage(result.failure));
    })();
  }, [applySession]);

  const setToken = useCallback((value: string): void => {
    tokenRef.current = value;
    setTokenState(value);
    if (!invalid) return;
    setInvalid(false);
    setStatus('');
  }, [invalid]);

  return { token, setToken, busy, invalid, status, isSessionNotice, connect };
}
