import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import type { SessionClaims } from '../lib/jwt.js';
import type { WorkspaceCtx } from '../lib/workspace-middleware.js';

export const teamRoutes = new Hono();
teamRoutes.use('*', requireAuth);
teamRoutes.use('*', requireWorkspace);

const teams = schema.teams;
const tm = schema.teamMembers;
const wm = schema.workspaceMembers;
const isPriv = (role: string) => role === 'owner' || role === 'admin';

// Управлять командой может admin/owner воркспейса или владелец команды (в пределах воркспейса).
async function canManage(teamId: string, me: SessionClaims, ws: WorkspaceCtx): Promise<boolean> {
  if (isPriv(ws.role)) return true;
  const [t] = await db.select({ ownerId: teams.ownerId }).from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.workspaceId, ws.id))).limit(1);
  return t?.ownerId === me.sub;
}

// Оставить только тех из ids, кто — участник этого воркспейса (защита от добавления чужих).
async function filterWsMembers(workspaceId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.select({ userId: wm.userId }).from(wm)
    .where(and(eq(wm.workspaceId, workspaceId), inArray(wm.userId, ids)));
  return rows.map((r) => r.userId);
}

// ── список команд (с участниками) ───────────────────────────────────────────────
teamRoutes.get('/', async (c) => {
  const ws = c.get('workspace');
  const rows = await db.select().from(teams).where(eq(teams.workspaceId, ws.id)).orderBy(teams.name);
  const ids = rows.map((t) => t.id);
  const members = ids.length
    ? await db
        .select({ teamId: tm.teamId, userId: tm.userId, displayName: schema.users.displayName, avatarUrl: schema.users.avatarUrl })
        .from(tm)
        .innerJoin(schema.users, eq(schema.users.id, tm.userId))
        .where(inArray(tm.teamId, ids))
    : [];
  const byTeam = new Map<string, typeof members>();
  for (const m of members) {
    const arr = byTeam.get(m.teamId) ?? [];
    arr.push(m);
    byTeam.set(m.teamId, arr);
  }
  return c.json(rows.map((t) => ({ ...t, members: byTeam.get(t.id) ?? [] })));
});

// ── создание ──────────────────────────────────────────────────────────────────
teamRoutes.post('/', async (c) => {
  const me = c.get('user');
  const ws = c.get('workspace');
  const p = z.object({
    name: z.string().min(1).max(200),
    memberIds: z.array(z.string().uuid()).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const team = await db.transaction(async (tx) => {
    const [t] = await tx.insert(teams).values({ workspaceId: ws.id, name: p.data.name, ownerId: me.sub }).returning();
    const allowed = await filterWsMembers(ws.id, p.data.memberIds ?? []);
    const ids = Array.from(new Set([me.sub, ...allowed]));
    await tx.insert(tm).values(ids.map((userId) => ({ teamId: t!.id, userId }))).onConflictDoNothing();
    return t!;
  });
  return c.json(team, 201);
});

// ── переименование ──────────────────────────────────────────────────────────────
teamRoutes.patch('/:id', async (c) => {
  const me = c.get('user');
  const ws = c.get('workspace');
  const id = c.req.param('id');
  if (!(await canManage(id, me, ws))) return c.json({ error: 'forbidden' }, 403);
  const p = z.object({ name: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const [t] = await db.update(teams).set({ name: p.data.name })
    .where(and(eq(teams.id, id), eq(teams.workspaceId, ws.id))).returning();
  return c.json(t);
});

// ── удаление ──────────────────────────────────────────────────────────────────
teamRoutes.delete('/:id', async (c) => {
  const me = c.get('user');
  const ws = c.get('workspace');
  const id = c.req.param('id');
  if (!(await canManage(id, me, ws))) return c.json({ error: 'forbidden' }, 403);
  await db.delete(teams).where(and(eq(teams.id, id), eq(teams.workspaceId, ws.id)));
  return c.json({ ok: true });
});

// ── участники ──────────────────────────────────────────────────────────────────
teamRoutes.post('/:id/members', async (c) => {
  const me = c.get('user');
  const ws = c.get('workspace');
  const id = c.req.param('id');
  if (!(await canManage(id, me, ws))) return c.json({ error: 'forbidden' }, 403);
  const p = z.object({ userId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const [allowed] = await filterWsMembers(ws.id, [p.data.userId]);
  if (!allowed) return c.json({ error: 'not_a_member' }, 400);
  await db.insert(tm).values({ teamId: id, userId: allowed }).onConflictDoNothing();
  return c.json({ ok: true }, 201);
});

teamRoutes.delete('/:id/members/:userId', async (c) => {
  const me = c.get('user');
  const ws = c.get('workspace');
  const id = c.req.param('id');
  if (!(await canManage(id, me, ws))) return c.json({ error: 'forbidden' }, 403);
  await db.delete(tm).where(and(eq(tm.teamId, id), eq(tm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
