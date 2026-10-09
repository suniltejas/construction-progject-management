/** Express adapter for Better Auth's cookie-backed session API. */
import type { Request } from 'express';
import { auth } from './auth.js';

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
export type AuthUser = AuthSession['user'];

export async function getSessionFromRequest(req: Pick<Request, 'headers'>): Promise<AuthSession | null> {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      headers.set(name, name === 'cookie' ? rawValue.join('; ') : rawValue.join(', '));
    } else {
      headers.set(name, rawValue);
    }
  }
  return auth.api.getSession({ headers });
}
