import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface WorkflowAccess { token: string; browserOrigin: string; serverOrigin: string; analysisProviderOrigin?: string | null }
export class WorkflowHTTPError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
export function deny(status: number, code: string): never { throw new WorkflowHTTPError(status, code); }
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
};
export class WorkflowSessions {
  private readonly sessions = new Map<string, { csrf: string; expires: number }>();
  private readonly access: WorkflowAccess;
  private readonly clock: () => number;
  constructor(access: WorkflowAccess, clock: () => number = Date.now) {
    this.access = access; this.clock = clock;
    if (access.token.length < 32) throw new Error('WORKFLOW_TOKEN_TOO_SHORT');
    for (const origin of [access.browserOrigin, access.serverOrigin]) {
      const u = new URL(origin);
      if (u.origin !== origin || u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
        throw new Error('WORKFLOW_LOOPBACK_ORIGIN_REQUIRED');
      }
    }
  }
  checkBoundary(request: IncomingMessage, write: boolean): void {
    if (request.headers.host !== new URL(this.access.serverOrigin).host) deny(403, 'HOST_REJECTED');
    const origin = request.headers.origin;
    if ((write && origin !== this.access.browserOrigin) || (origin !== undefined && origin !== this.access.browserOrigin)) deny(403, 'ORIGIN_REJECTED');
    if (request.headers['sec-fetch-site'] === 'cross-site') deny(403, 'ORIGIN_REJECTED');
  }
  open(request: IncomingMessage, response: ServerResponse, token: unknown): { csrf_token: string; expires_at: string } {
    this.checkBoundary(request, true);
    if (typeof token !== 'string' || !equal(token, this.access.token)) deny(401, 'AUTH_REQUIRED');
    for (const [id, session] of this.sessions) if (session.expires <= this.clock()) this.sessions.delete(id);
    if (this.sessions.size >= 100) deny(429, 'SESSION_LIMIT');
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), expires = this.clock() + 3600000;
    this.sessions.set(id, { csrf, expires });
    response.setHeader('Set-Cookie', `safehandoff_session=${id}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=3600`);
    return { csrf_token: csrf, expires_at: new Date(expires).toISOString() };
  }
  require(request: IncomingMessage, write: boolean): { csrf_token: string; expires_at: string } {
    this.checkBoundary(request, write);
    const values = (request.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith('safehandoff_session='));
    const session = values.length === 1 ? this.sessions.get(values[0]!.slice('safehandoff_session='.length)) : undefined;
    if (!session || session.expires <= this.clock()) deny(401, 'AUTH_REQUIRED');
    if (write && (typeof request.headers['x-csrf-token'] !== 'string' || !equal(request.headers['x-csrf-token'], session.csrf))) deny(403, 'CSRF_REJECTED');
    return { csrf_token: session.csrf, expires_at: new Date(session.expires).toISOString() };
  }
}
