// 로컬 접속 구역. 토큰은 화면 메모리에만 두고 저장하지 않는다.
// 토큰이 거부되면 입력에 aria-invalid를 붙이고 다시 초점을 준다.

import { useEffect, useRef } from 'react';
import type { FormEvent, JSX } from 'react';
import type { SessionApi } from './hooks/useSession.ts';

export function SessionSection(props: { session: SessionApi }): JSX.Element {
  const { session } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (session.invalid) inputRef.current?.focus();
  }, [session.invalid]);

  return (
    <section className="session" id="session" aria-labelledby="session-heading">
      <h2 id="session-heading">로컬 접속</h2>
      <p className="hint" id="session-hint">서버를 시작할 때 설정한 운영자 토큰으로 세션을 엽니다. 토큰은 이 화면의 메모리에만 쓰고 저장하지 않습니다. 세션은 1시간 뒤 만료되며, 만료되면 다시 입력해야 합니다.</p>
      <form
        className="form session__form"
        id="session-form"
        noValidate
        aria-busy={session.busy ? 'true' : undefined}
        onSubmit={(event: FormEvent<HTMLFormElement>): void => {
          event.preventDefault();
          session.connect();
        }}
      >
        <div className="field">
          <label htmlFor="session-token">운영자 토큰</label>
          <input
            id="session-token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            ref={inputRef}
            value={session.token}
            aria-invalid={session.invalid ? 'true' : undefined}
            aria-describedby="session-hint session-status"
            onChange={(event): void => { session.setToken(event.currentTarget.value); }}
          />
        </div>
        <button
          className="button button--solid"
          id="session-connect"
          type="submit"
          disabled={session.busy}
          aria-busy={session.busy ? 'true' : undefined}
        >세션 열기</button>
      </form>
      <p className="status" id="session-status" role="status" aria-live="polite">{session.status}</p>
    </section>
  );
}
