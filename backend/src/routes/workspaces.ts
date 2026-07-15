import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Context, Next } from 'hono';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { notifyAdminGranted } from '../lib/notify.js';

const ws = schema.workspaces;
const wm = schema.workspaceMembers;
const wi = schema.workspaceInvites;

// Зарезервированные слаги (конфликтуют с путями приложения).
// 'join' — публичные инвайт-ссылки на встречи (/join/<token>), верхний уровень.
const RESERVED = new Set(['api', 'owner', 'auth', 'login', 'app', 'admin', 'static', '_next', 'health', 'sw.js', 'join']);
const slugSchema = z.string().regex(/^[a-z0-9-]{2,32}$/, 'slug: 2-32 символа a-z0-9-');

/** Платформенный owner (users.role='owner'). */
async function requireOwner(c: Context, next: Next) {
  const u = c.get('user');
  if (u.role !== 'owner') return c.json({ error: 'forbidden' }, 403);
  return next();
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/workspaces — для любого залогиненного юзера
// ─────────────────────────────────────────────────────────────────────────────
export const workspaceRoutes = new Hono();
workspaceRoutes.use('*', requireAuth);

// Пространства, в которых состоит текущий юзер (для лендинга/переключателя на фронте).
workspaceRoutes.get('/mine', async (c) => {
  const u = c.get('user');
  const rows = await db
    .select({ id: ws.id, slug: ws.slug, name: ws.name, role: wm.role, status: wm.status })
    .from(wm)
    .innerJoin(ws, eq(ws.id, wm.workspaceId))
    .where(and(eq(wm.userId, u.sub), eq(ws.isActive, true)))
    .orderBy(wm.createdAt);
  return c.json(rows);
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/owner — owner-консоль (отдельный интерфейс управления пространствами)
// ─────────────────────────────────────────────────────────────────────────────
export const ownerRoutes = new Hono();
ownerRoutes.use('*', requireAuth);
ownerRoutes.use('*', requireOwner);

// Все пространства + число участников.
ownerRoutes.get('/workspaces', async (c) => {
  const rows = await db
    .select({
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      isActive: ws.isActive,
      createdAt: ws.createdAt,
      memberCount: sql<number>`count(${wm.id})::int`,
    })
    .from(ws)
    .leftJoin(wm, eq(wm.workspaceId, ws.id))
    .groupBy(ws.id)
    .orderBy(ws.createdAt);
  return c.json(rows);
});

// Создать пространство. Опционально сразу назначить главу компании (existing userId → role admin).
ownerRoutes.post('/workspaces', async (c) => {
  const parsed = z.object({
    slug: slugSchema,
    name: z.string().min(1).max(120),
    adminUserId: z.string().uuid().optional(),   // глава воркспейса (роль admin)
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', details: parsed.error.flatten() }, 400);
  if (RESERVED.has(parsed.data.slug)) return c.json({ error: 'slug_reserved' }, 400);

  const [exists] = await db.select({ id: ws.id }).from(ws).where(eq(ws.slug, parsed.data.slug)).limit(1);
  if (exists) return c.json({ error: 'slug_taken' }, 409);

  const created = await db.transaction(async (tx) => {
    const [w] = await tx.insert(ws).values({ slug: parsed.data.slug, name: parsed.data.name }).returning();
    if (parsed.data.adminUserId) {
      await tx.insert(wm).values({ workspaceId: w!.id, userId: parsed.data.adminUserId, role: 'admin' }).onConflictDoNothing();
    }
    return w!;
  });
  return c.json(created, 201);
});

// Переименовать / (де)активировать пространство.
ownerRoutes.patch('/workspaces/:id', async (c) => {
  const parsed = z.object({
    name: z.string().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const [updated] = await db.update(ws).set({ ...parsed.data, updatedAt: new Date() }).where(eq(ws.id, c.req.param('id'))).returning();
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json(updated);
});

// Участники пространства.
ownerRoutes.get('/workspaces/:id/members', async (c) => {
  const rows = await db
    .select({ userId: wm.userId, role: wm.role, displayName: schema.users.displayName, avatarUrl: schema.users.avatarUrl })
    .from(wm)
    .innerJoin(schema.users, eq(schema.users.id, wm.userId))
    .where(eq(wm.workspaceId, c.req.param('id')))
    .orderBy(wm.createdAt);
  return c.json(rows);
});

ownerRoutes.post('/workspaces/:id/members', async (c) => {
  const parsed = z.object({
    userId: z.string().uuid(),
    role: z.enum(['owner', 'admin', 'member']).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const wsId = c.req.param('id');
  const role = parsed.data.role ?? 'member';
  const [prev] = await db.select({ role: wm.role }).from(wm)
    .where(and(eq(wm.workspaceId, wsId), eq(wm.userId, parsed.data.userId))).limit(1);
  const [member] = await db.insert(wm)
    .values({ workspaceId: wsId, userId: parsed.data.userId, role })
    .onConflictDoUpdate({ target: [wm.workspaceId, wm.userId], set: { role } })
    .returning();
  if (role === 'admin' && prev?.role !== 'admin') await notifyAdminGranted(parsed.data.userId, wsId);
  return c.json(member, 201);
});

ownerRoutes.delete('/workspaces/:id/members/:userId', async (c) => {
  await db.delete(wm).where(and(eq(wm.workspaceId, c.req.param('id')), eq(wm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});

// Все юзеры платформы (выбрать, кого добавить в пространство).
ownerRoutes.get('/users', async (c) => {
  const rows = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, avatarUrl: schema.users.avatarUrl, role: schema.users.role, isActive: schema.users.isActive })
    .from(schema.users)
    .orderBy(schema.users.displayName);
  return c.json(rows);
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/members — управление участниками ТЕКУЩЕГО воркспейса (для админа пространства).
// Инвайты + одобрение заявок (status pending → active). Скоуп — X-Workspace.
// ─────────────────────────────────────────────────────────────────────────────
export const memberRoutes = new Hono();
memberRoutes.use('*', requireAuth);
memberRoutes.use('*', requireWorkspace);

const isWsAdmin = (c: Context): boolean => {
  const w = c.get('workspace');
  return w.role === 'admin' || w.role === 'owner';
};

// Участники (active + pending) для экрана управления.
memberRoutes.get('/', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  const rows = await db
    .select({ userId: wm.userId, role: wm.role, status: wm.status, displayName: schema.users.displayName, avatarUrl: schema.users.avatarUrl })
    .from(wm)
    .innerJoin(schema.users, eq(schema.users.id, wm.userId))
    .where(eq(wm.workspaceId, w.id))
    .orderBy(wm.status, wm.createdAt);
  return c.json(rows);
});

// Создать инвайт-ссылку (код). Фронт строит t.me/<bot>?start=invite_<code>.
memberRoutes.post('/invite', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  const u = c.get('user');
  const p = z.object({ role: z.enum(['admin', 'member']).optional() }).safeParse(await c.req.json().catch(() => ({})));
  const role = p.success ? (p.data.role ?? 'member') : 'member';
  const code = randomBytes(9).toString('base64url');
  const expiresAt = new Date(Date.now() + 14 * 86400000);  // 14 дней
  await db.insert(wi).values({ workspaceId: w.id, code, role, createdBy: u.sub, expiresAt });
  return c.json({ code, expiresAt }, 201);
});

// Одобрить заявку (pending → active).
memberRoutes.post('/:userId/approve', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  await db.update(wm).set({ status: 'active' })
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});

// Отклонить заявку (удалить pending-членство).
memberRoutes.post('/:userId/reject', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  await db.delete(wm)
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId')), eq(wm.status, 'pending')));
  return c.json({ ok: true });
});

// Сменить роль участника (admin/member). owner неприкосновенен.
memberRoutes.patch('/:userId', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  const p = z.object({ role: z.enum(['admin', 'member']) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const [t] = await db.select({ role: wm.role }).from(wm)
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId')))).limit(1);
  if (!t) return c.json({ error: 'not_found' }, 404);
  if (t.role === 'owner') return c.json({ error: 'forbidden' }, 403);
  await db.update(wm).set({ role: p.data.role })
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId'))));
  if (p.data.role === 'admin' && t.role !== 'admin') await notifyAdminGranted(c.req.param('userId'), w.id);
  return c.json({ ok: true });
});

// Удалить участника. Себя и owner нельзя.
memberRoutes.delete('/:userId', async (c) => {
  if (!isWsAdmin(c)) return c.json({ error: 'forbidden' }, 403);
  const w = c.get('workspace');
  const u = c.get('user');
  if (c.req.param('userId') === u.sub) return c.json({ error: 'self_forbidden' }, 400);
  const [t] = await db.select({ role: wm.role }).from(wm)
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId')))).limit(1);
  if (t?.role === 'owner') return c.json({ error: 'forbidden' }, 403);
  await db.delete(wm).where(and(eq(wm.workspaceId, w.id), eq(wm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
