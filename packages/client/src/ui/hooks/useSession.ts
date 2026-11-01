// 세션은 페이지 접속 시 자동 준비한다. 사용자 로그인이나 시작 토큰은 사용하지 않는다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { openSession, restoreSession, sessionFailureMessage } from '../../session-client.ts';
import type { SessionInfo } from '../../session-client.ts';

export interface SessionApi {
  busy: boolean;
  status: string;
  session: SessionInfo | null;
  recheck: () => void;
}

export function useSession(onCsrfToken: (token: string | null) => void): SessionApi {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('서버에 연결하는 중입니다…');
  const alive = useRef(true);
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  const onCsrf = useRef(onCsrfToken);
  onCsrf.current = onCsrfToken;
  const reconnect = useRef<() => void>(() => {});

  const recheck = useCallback((): void => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    void (async () => {
      try {
        let result = await restoreSession(fetch);
        if (!alive.current) return;
        if (!result.ok && result.failure.kind === 'no_session') result = await openSession(fetch);
        if (!alive.current) return;
        if (!result.ok) { setStatus(sessionFailureMessage(result.failure)); return; }
        setSession(result.session);
        onCsrf.current(result.session.csrfToken);
        setStatus('서버에 연결되었습니다.');
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setSession(null);
          onCsrf.current(null);
          reconnect.current();
        }, Math.max(0, Math.min(Date.parse(result.session.expiresAt) - Date.now(), 2147483647)));
      } finally {
        pending.current = false;
        if (alive.current) setBusy(false);
      }
    })();
  }, []);
  reconnect.current = recheck;

  useEffect(() => {
    alive.current = true;
    recheck();
    return () => {
      alive.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [recheck]);

  return { session, busy, status, recheck };
}
