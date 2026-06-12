import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { signSession } from '../lib/jwt.js';
import { verifyTelegramLogin } from '../lib/telegram.js';
import { env } from '../lib/env.js';

export const authRoutes = new Hono();

// Найти existing identity или создать пользователя + identity.
async function findOrCreateUser(provider: 'telegram' | 'email', externalId: string, displayName: string, avatarUrl?: string, meta: Record<string, unknown> = {}) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.authIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.authIdentities.userId))
      .where(and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.externalId, externalId),
      ))
      .limit(1);
    if (existing[0]) return existing[0];

    // Первый зарегистрировавшийся = owner.
    const anyUser = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    const role = anyUser.length ? 'member' : 'owner';

    const [created] = await tx
      .insert(schema.users)
      .values({ displayName, role, avatarUrl })
      .returning({ id: schema.users.id, role: schema.users.role });
    await tx.insert(schema.authIdentities).values({ userId: created!.id, provider, externalId, meta });
    return created!;
  });
}

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
