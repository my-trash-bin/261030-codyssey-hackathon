// 로컬 접속(세션). 세션이 열려야 공개 결정 영역의 쓰기가 열린다.
// 토큰은 메모리에만 두고 저장하지 않는다. 세션 CSRF 토큰은 공개 결정 작업 공간에 넘긴다.
// 세션은 서버가 정한 8시간 고정 수명이며 연장하지 않는다. 만료 시각 타이머와 명시 재확인이
// 만료를 알리고, 서버가 401로 답하면 화면의 쓰기 권한도 함께 닫는다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { logoutSession, openSession, restoreSession, sessionFailureMessage } from '../../session-client.ts';
import type { SessionInfo } from '../../session-client.ts';

export interface SessionApi {
  /** 입력 중인 시작 토큰. 저장하지 않는다. */
  token: string;
  setToken: (value: string) => void;
  busy: boolean;
  invalid: boolean;
  /** 만료·401·로그아웃으로 세션이 닫혔는지. 화면은 토큰 입력으로 초점을 되돌린다. */
  expired: boolean;
  status: string;
  isSessionNotice: boolean;
  /** 열린 세션 정보. 없으면 null이며 이때 작업 공간은 쓰기를 열지 않는다. */
  session: SessionInfo | null;
  connect: () => void;
  logout: () => void;
  recheck: () => void;
}

export type SessionApplyMode = 'open' | 'restore';

const OPENED_MESSAGE = '세션을 열었습니다.';
const RESTORED_MESSAGE = '세션을 확인했습니다.';
const EXPIRED_MESSAGE = '세션이 만료되어 화면의 쓰기 권한을 닫았습니다. 시작 토큰은 서버를 시작할 때 한 번만 쓸 수 있으므로, 계속하려면 서버를 다시 시작하고 새로 표시되는 토큰을 입력하세요.';
const REJECTED_MESSAGE = '서버가 이 세션을 더 이상 인정하지 않습니다. 서버를 다시 시작했다면 시작 토큰도 새로 발급되므로, 표시된 토큰을 한 번 입력해 다시 여세요.';
const LOGGED_OUT_MESSAGE = '세션을 닫았습니다. 시작 토큰은 서버를 시작할 때 한 번만 쓸 수 있으므로, 다시 열려면 서버를 다시 시작해 새로 표시되는 토큰을 입력하세요.';
// setTimeout이 담을 수 있는 최대 지연. 8시간은 이보다 짧지만 계산을 신뢰하지 않고 만료 시 다시 검사한다.
const MAX_TIMER_DELAY = 2147483647;

/** 만료 시각을 화면 문구로 만든다. 날짜를 넘겨도 구분되도록 날짜와 시각을 함께 보여 준다. */
export function formatSessionExpiry(expiresAt: string): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return '만료 시각 확인 불가';
  return at.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sessionNote(session: SessionInfo): string {
  const environment = session.environment;
  const providerNote = environment?.providerOrigin
    ? `분석 provider ${environment.providerOrigin}`
    : '분석 provider 주소 미표시';
  const approvalNote = environment == null || environment.approvalStatus === 'operator_confirmation_required'
    ? ' 모델 연결 승인은 운영자가 확인해야 합니다.'
    : '';
  return `만료 ${formatSessionExpiry(session.expiresAt)}. ${providerNote}.${approvalNote}`;
}

export function useSession(onCsrfToken: (token: string | null) => void): SessionApi {
  const [token, setTokenState] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [expired, setExpired] = useState(false);
  const [status, setStatus] = useState('세션 상태를 확인하는 중입니다…');
  const [isSessionNotice, setIsSessionNotice] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const busyRef = useRef(false);
  const tokenRef = useRef('');
  const aliveRef = useRef(true);
  const sessionRef = useRef<SessionInfo | null>(null);
  // 세대 번호는 로그아웃·만료 뒤에 도착한 open/restore 응답이 세션을 되살리지 않게 한다.
  const generationRef = useRef(0);
  const recheckingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const expireRef = useRef<() => void>(() => {});
  // 세션 복원은 한 번만 실행하고, 토큰 수신 콜백은 최신 값을 쓴다.
  const onCsrfTokenRef = useRef(onCsrfToken);
  onCsrfTokenRef.current = onCsrfToken;

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** 세션을 닫고 화면의 쓰기 권한을 회수한다. 늦게 도착할 응답은 세대 번호로 버린다. */
  const closeSession = useCallback((message: string, reason: 'expired' | 'logout'): void => {
    clearTimer();
    generationRef.current += 1;
    sessionRef.current = null;
    tokenRef.current = '';
    setSession(null);
    setTokenState('');
    setInvalid(false);
    setExpired(reason === 'expired');
    setIsSessionNotice(false);
    setStatus(message);
    busyRef.current = false;
    recheckingRef.current = false;
    onCsrfTokenRef.current(null);
  }, [clearTimer]);

  const scheduleExpiry = useCallback((next: SessionInfo): void => {
    clearTimer();
    const at = Date.parse(next.expiresAt);
    if (Number.isNaN(at)) return;
    const delay = at - Date.now();
    if (delay <= 0) {
      expireRef.current();
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      expireRef.current();
    }, Math.min(delay, MAX_TIMER_DELAY));
  }, [clearTimer]);

  const applySession = useCallback((next: SessionInfo, mode: SessionApplyMode): void => {
    sessionRef.current = next;
    setSession(next);
    if (mode === 'open') {
      tokenRef.current = '';
      setTokenState('');
    }
    setInvalid(false);
    setExpired(false);
    setIsSessionNotice(true);
    setStatus(`${mode === 'open' ? OPENED_MESSAGE : RESTORED_MESSAGE} ${sessionNote(next)}`);
    onCsrfTokenRef.current(next.csrfToken);
    scheduleExpiry(next);
  }, [scheduleExpiry]);

  const expire = useCallback((): void => {
    const current = sessionRef.current;
    if (!current) return;
    const at = Date.parse(current.expiresAt);
    // 타이머가 일찍 깨졌으면 남은 시간만큼 다시 기다린다. 수명은 늘리지 않는다.
    if (!Number.isNaN(at) && at > Date.now()) {
      scheduleExpiry(current);
      return;
    }
    closeSession(EXPIRED_MESSAGE, 'expired');
  }, [closeSession, scheduleExpiry]);
  expireRef.current = expire;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const connect = useCallback((): void => {
    if (busyRef.current) return;
    const submitted = tokenRef.current;
    // 세션을 열기 시작한 순간 그전에 보낸 recheck/restore 응답은 무효가 된다.
    // 그 응답이 늦게 401로 도착해 방금 연 세션을 닫는 일을 막는다.
    generationRef.current += 1;
    const generation = generationRef.current;
    busyRef.current = true;
    setBusy(true);
    setIsSessionNotice(false);
    setStatus('세션을 여는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await openSession(fetch, submitted);
        if (!aliveRef.current || generation !== generationRef.current) return;
        if (!result.ok) {
          setStatus(sessionFailureMessage(result.failure));
          setExpired(false);
          if (result.failure.kind === 'invalid_token') setInvalid(true);
          return;
        }
        applySession(result.session, 'open');
      } finally {
        if (!aliveRef.current) return;
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [applySession]);

  const logout = useCallback((): void => {
    if (busyRef.current) return;
    const current = sessionRef.current;
    // 로그아웃을 시작한 순간 이전에 보낸 open/restore 응답은 무효가 된다.
    generationRef.current += 1;
    if (!current) {
      closeSession(LOGGED_OUT_MESSAGE, 'logout');
      return;
    }
    const generation = generationRef.current;
    busyRef.current = true;
    setBusy(true);
    setIsSessionNotice(false);
    setStatus('세션을 닫는 중입니다…');
    void (async (): Promise<void> => {
      try {
        const result = await logoutSession(fetch, current.csrfToken);
        if (!aliveRef.current || generation !== generationRef.current) return;
        if (result.ok) {
          closeSession(LOGGED_OUT_MESSAGE, 'logout');
          return;
        }
        if (result.failure.kind === 'no_session' || result.failure.kind === 'invalid_token') {
          closeSession(REJECTED_MESSAGE, 'expired');
          return;
        }
        setStatus(`세션을 닫지 못했습니다. ${sessionFailureMessage(result.failure)} session 쿠키가 남아 있으면 세션 상태 다시 확인으로 정리하세요.`);
      } finally {
        if (!aliveRef.current) return;
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [closeSession]);

  const recheck = useCallback((): void => {
    if (busyRef.current || recheckingRef.current) return;
    recheckingRef.current = true;
    const generation = generationRef.current;
    void (async (): Promise<void> => {
      try {
        const result = await restoreSession(fetch);
        if (!aliveRef.current || generation !== generationRef.current) return;
        if (result.ok) {
          applySession(result.session, 'restore');
          return;
        }
        if (result.failure.kind === 'no_session' || result.failure.kind === 'invalid_token') {
          if (sessionRef.current) closeSession(REJECTED_MESSAGE, 'expired');
          else {
            setExpired(true);
            setStatus('아직 세션이 없습니다. 서버를 시작할 때 터미널에 표시된 시작 토큰으로 세션을 여세요.');
          }
          return;
        }
        // 네트워크·서버 오류로는 세션을 회수하지 않는다. 서버가 401을 답했을 때만 닫는다.
        setStatus(`세션 상태를 확인하지 못했습니다. ${sessionFailureMessage(result.failure)}${sessionRef.current ? ' 열린 세션은 그대로 둡니다.' : ''}`);
      } finally {
        recheckingRef.current = false;
      }
    })();
  }, [applySession, closeSession]);

  useEffect(() => {
    const generation = generationRef.current;
    void (async (): Promise<void> => {
      const result = await restoreSession(fetch);
      if (!aliveRef.current || generation !== generationRef.current) return;
      if (result.ok) {
        // 복원이 늦게 끝났더라도 이미 로그아웃했으면 되살리지 않는다.
        if (sessionRef.current !== null) return;
        applySession(result.session, 'restore');
        return;
      }
      // 그사이 세션을 열었거나 닫았으면 이 실패 응답은 현재 상태를 설명하지 않는다.
      if (sessionRef.current !== null) return;
      setStatus(result.failure.kind === 'no_session'
        ? '아직 세션이 없습니다. 서버를 시작할 때 터미널에 표시된 시작 토큰으로 세션을 시작하세요.'
        : sessionFailureMessage(result.failure));
    })();
  }, [applySession]);

  const setToken = useCallback((value: string): void => {
    tokenRef.current = value;
    setTokenState(value);
    if (!invalid && !expired) return;
    setInvalid(false);
    setExpired(false);
    setStatus('');
  }, [invalid, expired]);

  return { token, setToken, busy, invalid, expired, status, isSessionNotice, session, connect, logout, recheck };
}
