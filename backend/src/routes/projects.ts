import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';

export const projectRoutes = new Hono();
projectRoutes.use('*', requireAuth);

const p = schema.projects;
const pm = schema.projectMembers;
const ps = schema.projectSections;

const isAdmin = (role: string) => role === 'admin' || role === 'owner';

// ── создание ──────────────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
});

projectRoutes.post('/', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const project = await db.transaction(async (tx) => {
    const [created] = await tx.insert(p).values({
      name: parsed.data.name,
      description: parsed.data.description ?? '',
      color: parsed.data.color ?? null,
      ownerId: u.sub,
    }).returning();
    // Создатель — lead проекта.
    await tx.insert(pm).values({ projectId: created!.id, userId: u.sub, role: 'lead' });
    return created!;
  });

  return c.json(project, 201);
});

// ── список (командные направления видны всем) ──────────────────────────────────
projectRoutes.get('/', async (c) => {
  const includeArchived = c.req.query('archived') === '1';
  const rows = await db
    .select()
    .from(p)
    .where(includeArchived ? undefined : eq(p.isArchived, false))
    .orderBy(p.name);
  return c.json(rows);
});

// ── один проект + участники ─────────────────────────────────────────────────────
projectRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);

  const members = await db
    .select({
      userId: pm.userId,
      role: pm.role,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(pm)
    .innerJoin(schema.users, eq(schema.users.id, pm.userId))
    .where(eq(pm.projectId, id));

  const sections = await db.select().from(ps).where(eq(ps.projectId, id)).orderBy(ps.position);

  return c.json({ ...project, members, sections });
});

// ── разделы (секции) проекта ────────────────────────────────────────────────────
projectRoutes.post('/:id/sections', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  const parsed = z.object({ name: z.string().min(1).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const existing = await db.select({ position: ps.position }).from(ps).where(eq(ps.projectId, id));
  const pos = existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0;
  const [section] = await db.insert(ps).values({ projectId: id, name: parsed.data.name, position: pos }).returning();
  return c.json(section, 201);
});

projectRoutes.patch('/:id/sections/:sectionId', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  const parsed = z.object({ name: z.string().min(1).max(200).optional(), position: z.number().int().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const [section] = await db.update(ps).set(parsed.data).where(and(eq(ps.id, c.req.param('sectionId')), eq(ps.projectId, id))).returning();
  return c.json(section);
});

projectRoutes.delete('/:id/sections/:sectionId', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);
  // задачи раздела автоматически получают section_id=null (FK on delete set null)
  await db.delete(ps).where(and(eq(ps.id, c.req.param('sectionId')), eq(ps.projectId, id)));
  return c.json({ ok: true });
});

// ── правка (owner проекта или admin) ────────────────────────────────────────────
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).nullable().optional(),
  isArchived: z.boolean().optional(),
});

projectRoutes.patch('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const [updated] = await db.update(p)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(p.id, id))
    .returning();
  return c.json(updated);
});

// ── архив (любой участник проекта; admin/owner — всегда) ─────────────────────────
projectRoutes.post('/:id/archive', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (!isAdmin(u.role)) {
    const [m] = await db.select({ id: pm.id }).from(pm).where(and(eq(pm.projectId, id), eq(pm.userId, u.sub))).limit(1);
    if (!m) return c.json({ error: 'forbidden' }, 403);
  }
  const parsed = z.object({ archived: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);
  const [updated] = await db.update(p).set({ isArchived: parsed.data.archived, updatedAt: new Date() }).where(eq(p.id, id)).returning();
  return c.json(updated);
});

// ── удаление (только admin/owner) ────────────────────────────────────────────────
// Каскад: участники и разделы удаляются (FK cascade); задачи проекта остаются,
// но project_id обнуляется (FK set null) — становятся личными у создателей.
projectRoutes.delete('/:id', async (c) => {
  const u = c.get('user');
  if (!isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  await db.delete(p).where(eq(p.id, id));
  return c.json({ ok: true });
});

// ── участники ──────────────────────────────────────────────────────────────────
projectRoutes.post('/:id/members', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({
    userId: z.string().uuid(),
    role: z.enum(['lead', 'member']).optional(),
  }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const [member] = await db.insert(pm)
    .values({ projectId: id, userId: parsed.data.userId, role: parsed.data.role ?? 'member' })
    .onConflictDoUpdate({
      target: [pm.projectId, pm.userId],
      set: { role: parsed.data.role ?? 'member' },
    })
    .returning();
  return c.json(member, 201);
});

// Добавить команду целиком — её участники становятся участниками проекта.
projectRoutes.post('/:id/team', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  const parsed = z.object({ teamId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const members = await db
    .select({ userId: schema.teamMembers.userId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, parsed.data.teamId));
  if (members.length) {
    await db.insert(pm)
      .values(members.map((m) => ({ projectId: id, userId: m.userId, role: 'member' as const })))
      .onConflictDoNothing();
  }
  return c.json({ ok: true, added: members.length }, 201);
});

projectRoutes.delete('/:id/members/:userId', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [project] = await db.select().from(p).where(eq(p.id, id)).limit(1);
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.ownerId !== u.sub && !isAdmin(u.role)) return c.json({ error: 'forbidden' }, 403);

  await db.delete(pm).where(and(eq(pm.projectId, id), eq(pm.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
