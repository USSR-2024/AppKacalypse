import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { signSession } from '../lib/jwt.js';
import { verifyTelegramLogin } from '../lib/telegram.js';
import { findOrCreateUser } from '../lib/users.js';
import { env } from '../lib/env.js';

export const authRoutes = new Hono();

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

/** POST /api/auth/telegram — приём payload от Telegram Login Widget. */
authRoutes.post('/telegram', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = telegramSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  if (!verifyTelegramLogin(parsed.data)) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const tg = parsed.data;
  const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username || 'User';

  const user = await findOrCreateUser('telegram', String(tg.id), displayName, tg.photo_url, {
    username: tg.username ?? null,
    photo_url: tg.photo_url ?? null,
  });

  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token });
});

/** POST /api/auth/dev — вход без подписи для локального теста UI. Только при ALLOW_DEV_AUTH=1. */
authRoutes.post('/dev', async (c) => {
  if (env.ALLOW_DEV_AUTH !== '1') return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = z.string().min(1).max(100).safeParse(body?.name);
  const displayName = name.success ? name.data : 'Dev User';
  const externalId = `dev:${displayName.toLowerCase()}`;
  const user = await findOrCreateUser('telegram', externalId, displayName);
  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token, dev: true });
});

// ── Вход через бота (обход блокировки веб-виджета в РФ) ────────────────────────
const CODE_TTL_MS = 5 * 60_000;

/** POST /api/auth/bot/start — веб запрашивает одноразовый код. Открывает t.me/<bot>?start=login_<code>. */
authRoutes.post('/bot/start', async (c) => {
  const code = randomBytes(18).toString('base64url');
  await db.insert(schema.botLoginCodes).values({ code, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return c.json({ code });
});

/** POST /api/auth/bot/exchange — веб меняет код на JWT (поллит, пока бот не подтвердит). */
authRoutes.post('/bot/exchange', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ code: z.string().min(1).max(128) }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const [row] = await db.select().from(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, parsed.data.code)).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) {
    if (row) await db.delete(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, row.code));
    return c.json({ error: 'expired' }, 410);
  }
  if (row.status === 'consumed') return c.json({ error: 'expired' }, 410);
  if (row.status !== 'claimed' || !row.userId) return c.json({ status: 'pending' });

  const [user] = await db.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
  if (!user) return c.json({ error: 'expired' }, 410);
  await db.delete(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, row.code));
  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token });
});
