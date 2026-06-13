import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
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

  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
  } catch {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // Блокировка: заблокированный (isActive=false) или удалённый юзер не проходит.
  const [row] = await db.select({ active: schema.users.isActive }).from(schema.users).where(eq(schema.users.id, claims.sub)).limit(1);
  if (!row || !row.active) return c.json({ error: 'blocked' }, 401);

  c.set('user', claims);
  return next();
}
