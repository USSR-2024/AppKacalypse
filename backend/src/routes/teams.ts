import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import type { SessionClaims } from '../lib/jwt.js';

export const teamRoutes = new Hono();
teamRoutes.use('*', requireAuth);

const teams = schema.teams;
const tm = schema.teamMembers;
const isPriv = (role: string) => role === 'owner' || role === 'admin';

async function canManage(teamId: string, me: SessionClaims): Promise<boolean> {
  if (isPriv(me.role)) return true;
  const [t] = await db.select({ ownerId: teams.ownerId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  return t?.ownerId === me.sub;
}

// ── список команд (с участниками) ───────────────────────────────────────────────
teamRoutes.get('/', async (c) => {
  const rows = await db.select().from(teams).orderBy(teams.name);
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
  const p = z.object({
    name: z.string().min(1).max(200),
    memberIds: z.array(z.string().uuid()).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const team = await db.transaction(async (tx) => {
    const [t] = await tx.insert(teams).values({ name: p.data.name, ownerId: me.sub }).returning();
    const ids = Array.from(new Set([me.sub, ...(p.data.memberIds ?? [])]));
    await tx.insert(tm).values(ids.map((userId) => ({ teamId: t!.id, userId }))).onConflictDoNothing();
    return t!;
  });
  return c.json(team, 201);
});

// ── переименование ──────────────────────────────────────────────────────────────
teamRoutes.patch('/:id', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  if (!(await canManage(id, me))) return c.json({ error: 'forbidden' }, 403);
  const p = z.object({ name: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const [t] = await db.update(teams).set({ name: p.data.name }).where(eq(teams.id, id)).returning();
  return c.json(t);
});

// ── удаление ──────────────────────────────────────────────────────────────────
teamRoutes.delete('/:id', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  if (!(await canManage(id, me))) return c.json({ error: 'forbidden' }, 403);
  await db.delete(teams).where(eq(teams.id, id));
  return c.json({ ok: true });
});

// ── участники ──────────────────────────────────────────────────────────────────
teamRoutes.post('/:id/members', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  if (!(await canManage(id, me))) return c.json({ error: 'forbidden' }, 403);
  const p = z.object({ userId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  await db.insert(tm).values({ teamId: id, userId: p.data.userId }).onConflictDoNothing();
  return c.json({ ok: true }, 201);
});

teamRoutes.delete('/:id/members/:userId', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  if (!(await canManage(id, me))) return c.json({ error: 'forbidden' }, 403);
  await db.delete(tm).where(and(eq(tm.teamId, id), eq(tm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
