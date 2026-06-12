import type { Context, Next } from 'hono';
import { verifySession, type SessionClaims } from './jwt.js';

declare module 'hono' {
  interface ContextVariableMap {
    user: SessionClaims;
  }
}

/** Требует валидный Bearer-JWT. Кладёт claims в c.get('user'). */
export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  try {
    c.set('user', await verifySession(token));
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }
  return next();
}
