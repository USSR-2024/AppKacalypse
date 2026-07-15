import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { sendLoginCode } from '../lib/mail.js';
import { CODE_TTL_MIN, normEmail, tooManyCodes, issueCode, consumeCode } from '../lib/email-auth.js';

export const userRoutes = new Hono();
userRoutes.use('*', requireAuth);

const u = schema.users;
const wm = schema.workspaceMembers;

// ── список (для пикеров исполнителя) — только участники текущего воркспейса ───────
userRoutes.get('/', requireWorkspace, async (c) => {
  const ws = c.get('workspace');
  const rows = await db
    .select({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: wm.role })
    .from(u)
    .innerJoin(wm, eq(wm.userId, u.id))
    .where(and(eq(wm.workspaceId, ws.id), eq(u.isActive, true)))
    .orderBy(u.displayName);
  return c.json(rows);
});

// Эти роуты — платформенные: список ВСЕХ юзеров всех пространств и блокировка по
// всей платформе. Инструмент оператора, а не главы компании (у главы для своего
// пространства есть /api/members). Раньше пускало и role='admin'.
const isPriv = (role: string) => role === 'owner';

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

// ── обновление своих настроек ────────────────────────────────────────────────────
// ВАЖНО: статический '/me' должен идти ДО '/:id' — иначе Hono матчит '/me' на '/:id' (id='me').
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

// ── Привязка почты к своему аккаунту (тот же код на почту) ────────────────────
// Даёт второй способ входа тем, кто пришёл через Telegram. Адрес подтверждаем
// кодом: иначе можно вписать чужую почту и войти потом под этим аккаунтом с неё.
// ВАЖНО: статические роуты — ДО '/:id', иначе Hono отдаст их в параметрический
// (матчит по порядку регистрации, а не «статик важнее»).

userRoutes.post('/me/email/request', async (c) => {
  const me = c.get('user');
  const p = z.object({ email: z.string().trim().toLowerCase().email().max(200) })
    .safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const email = normEmail(p.data.email);

  const [taken] = await db.select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, 'email'), eq(schema.authIdentities.externalId, email)))
    .limit(1);
  if (taken && taken.userId !== me.sub) return c.json({ error: 'email_taken' }, 409);
  if (await tooManyCodes(email)) return c.json({ error: 'too_many' }, 429);

  const code = await issueCode(email, { linkUserId: me.sub });
  await sendLoginCode(email, code, CODE_TTL_MIN);
  return c.json({ ok: true, ttlMinutes: CODE_TTL_MIN });
});

userRoutes.post('/me/email/verify', async (c) => {
  const me = c.get('user');
  const p = z.object({
    email: z.string().trim().toLowerCase().email().max(200),
    code: z.string().trim().min(4).max(10),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const email = normEmail(p.data.email);

  const res = await consumeCode(email, p.data.code);
  if (!res.ok) return c.json({ error: res.reason }, res.reason === 'expired' ? 410 : 401);
  // Код, выписанный для входа, не должен привязывать почту к чужому аккаунту.
  if (res.row.linkUserId !== me.sub) return c.json({ error: 'invalid' }, 401);

  await db.insert(schema.authIdentities)
    .values({ userId: me.sub, provider: 'email', externalId: email, meta: {} })
    .onConflictDoNothing();
  await db.update(u).set({ email, updatedAt: new Date() }).where(eq(u.id, me.sub));
  return c.json({ ok: true, email });
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
      id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role, timezone: u.timezone,
      lang: u.lang, projectView: u.projectView, notifyMorning: u.notifyMorning, notifyEvening: u.notifyEvening,
      morningTime: u.morningTime, eveningTime: u.eveningTime, notifyChannels: u.notifyChannels,
    });
  return c.json(updated);
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
