import type { JSX } from 'react';
import type { SessionApi } from './hooks/useSession.ts';

export function SessionSection({ session, heading = 'h2' }: { session: SessionApi; heading?: 'h2' | 'h3' }): JSX.Element {
  const Heading = heading;
  return (
    <section className="session" aria-label="서버 연결">
      <Heading>서버 연결</Heading>
      <p className="status" id="session-status" role="status" aria-live="polite">{session.status}</p>
      {!session.session && !session.busy
        ? <button className="button" type="button" onClick={session.recheck}>다시 연결</button>
        : null}
    </section>
  );
}
