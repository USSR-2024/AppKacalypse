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

const isPriv = (role: string) => role === 'owner' || role === 'admin';

// ── админ: список всех пользователей (вкл. заблокированных) ──────────────────────
userRoutes.get('/admin', async (c) => {
  const me = c.get('user');
  if (!isPriv(me.role)) return c.json({ error: 'forbidden' }, 403);
  const rows = await db
    .select({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role, isActive: u.isActive, createdAt: u.createdAt })
    .from(u)
    .orderBy(u.createdAt);
  return c.json(rows);
});

// ── админ: блокировка / смена роли ──────────────────────────────────────────────
const adminPatchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['admin', 'member']).optional(),
});
userRoutes.patch('/:id', async (c) => {
  const me = c.get('user');
  if (!isPriv(me.role)) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  if (id === me.sub) return c.json({ error: 'self_forbidden' }, 400);

  const [target] = await db.select({ role: u.role }).from(u).where(eq(u.id, id)).limit(1);
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'owner') return c.json({ error: 'forbidden' }, 403); // owner неприкосновенен

  const body = await c.req.json().catch(() => null);
  const p = adminPatchSchema.safeParse(body);
  if (!p.success || (p.data.isActive === undefined && p.data.role === undefined)) return c.json({ error: 'bad_request' }, 400);
  if (p.data.role !== undefined && me.role !== 'owner') return c.json({ error: 'forbidden' }, 403); // роли меняет только owner

  const [updated] = await db.update(u).set({ ...p.data, updatedAt: new Date() }).where(eq(u.id, id))
    .returning({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role, isActive: u.isActive, createdAt: u.createdAt });
  return c.json(updated);
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
