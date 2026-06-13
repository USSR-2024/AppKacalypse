import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';

export const userRoutes = new Hono();
userRoutes.use('*', requireAuth);

const u = schema.users;

// ── список (для пикеров исполнителя) ────────────────────────────────────────────
userRoutes.get('/', async (c) => {
  const rows = await db
    .select({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role })
    .from(u)
    .where(eq(u.isActive, true))
    .orderBy(u.displayName);
  return c.json(rows);
});

// ── обновление своих настроек ────────────────────────────────────────────────────
const updateMeSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  timezone: z.string().max(64).optional(),
  lang: z.enum(['ru', 'es', 'en']).optional(),
  projectView: z.enum(['list', 'board', 'table']).optional(),
  notifyMorning: z.boolean().optional(),
  notifyEvening: z.boolean().optional(),
  morningTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  eveningTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  notifyChannels: z.array(z.enum(['telegram', 'push', 'email'])).optional(),
});

userRoutes.patch('/me', async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = updateMeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const [updated] = await db.update(u)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(u.id, me.sub))
    .returning({
      id: u.id, displayName: u.displayName, role: u.role, timezone: u.timezone,
      lang: u.lang, projectView: u.projectView, notifyMorning: u.notifyMorning, notifyEvening: u.notifyEvening,
      morningTime: u.morningTime, eveningTime: u.eveningTime, notifyChannels: u.notifyChannels,
    });
  return c.json(updated);
});
