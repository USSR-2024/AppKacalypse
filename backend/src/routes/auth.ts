import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { signSession } from '../lib/jwt.js';
import { verifyTelegramLogin } from '../lib/telegram.js';

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
  const externalId = String(tg.id);
  const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username || 'User';

  // Найти существующую identity либо создать пользователя + identity.
  const user = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.authIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.authIdentities.userId))
      .where(and(
        eq(schema.authIdentities.provider, 'telegram'),
        eq(schema.authIdentities.externalId, externalId),
      ))
      .limit(1);

    if (existing[0]) return existing[0];

    // Первый зарегистрировавшийся = owner, остальные = member.
    const anyUser = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    const role = anyUser.length ? 'member' : 'owner';

    const [created] = await tx
      .insert(schema.users)
      .values({ displayName, role, avatarUrl: tg.photo_url })
      .returning({ id: schema.users.id, role: schema.users.role });

    await tx.insert(schema.authIdentities).values({
      userId: created!.id,
      provider: 'telegram',
      externalId,
      meta: { username: tg.username ?? null, photo_url: tg.photo_url ?? null },
    });

    return created!;
  });

  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token });
});
