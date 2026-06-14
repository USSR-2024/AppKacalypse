import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { logActivity } from '../lib/activity.js';
import { withAssignees, assignedTaskIds, isAssignee, replaceAssignees } from '../lib/assignees.js';
import type { SessionClaims } from '../lib/jwt.js';

export const taskRoutes = new Hono();
taskRoutes.use('*', requireAuth);

const STATUSES = ['queued', 'in_progress', 'done', 'cancelled', 'archived'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const SOURCES = ['app', 'telegram', 'email', 'calendar', 'ai'] as const;

const t = schema.tasks;

// Менять задачу может создатель, контролёр, любой исполнитель, admin/owner.
async function canModify(task: { id: string; creatorId: string; controllerId: string | null }, u: SessionClaims): Promise<boolean> {
  if (task.creatorId === u.sub || task.controllerId === u.sub || u.role === 'admin' || u.role === 'owner') return true;
  return isAssignee(task.id, u.sub);
}

// Проекты, где пользователь — участник (для видимости проектных задач).
async function myProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ pid: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, userId));
  return rows.map((r) => r.pid);
}

// Видимость: member видит задачи, где он автор/контролёр/исполнитель или член проекта.
// owner/admin видят всё (надзор). Возвращает null, если ограничение не нужно.
async function visibilityCond(u: SessionClaims): Promise<SQL | null> {
  if (u.role === 'owner' || u.role === 'admin') return null;
  const pids = await myProjectIds(u.sub);
  const ors: SQL[] = [eq(t.creatorId, u.sub), eq(t.controllerId, u.sub), inArray(t.id, assignedTaskIds(u.sub))];
  if (pids.length) ors.push(inArray(t.projectId, pids));
  return or(...ors)!;
}

// ── создание ────────────────────────────────────────────────────────────────
const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  controllerId: z.string().uuid().nullable().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  externalAssignees: z.array(z.string().min(1).max(100)).optional(),
  priority: z.enum(PRIORITIES).optional(),
  isImportant: z.boolean().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  remindAt: z.string().datetime({ offset: true }).nullable().optional(),
  source: z.enum(SOURCES).optional(),
  isTriaged: z.boolean().optional(),
});

taskRoutes.post('/', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => null);
  const p = createSchema.safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.flatten() }, 400);
  const d = p.data;

  const source = d.source ?? 'app';
  // Задача без проекта от AI/телеги/почты → во Входящих; явно созданная в приложении → разобрана.
  const isTriaged = d.isTriaged ?? (d.projectId ? true : source === 'app');

  const task = await db.transaction(async (tx) => {
    const [created] = await tx.insert(t).values({
      title: d.title,
      description: d.description ?? '',
      projectId: d.projectId ?? null,
      creatorId: u.sub,
      controllerId: d.controllerId ?? u.sub,   // по умолчанию контролёр = создатель
      priority: d.priority ?? 'normal',
      isImportant: d.isImportant ?? false,
      isTriaged,
      dueAt: d.dueAt ? new Date(d.dueAt) : null,
      remindAt: d.remindAt ? new Date(d.remindAt) : null,
      source,
    }).returning();
    await replaceAssignees(tx, created!.id, d.assigneeIds ?? [], d.externalAssignees ?? []);
    return created!;
  });

  await logActivity({ taskId: task.id, actorId: u.sub, type: 'created' });
  const [withA] = await withAssignees([task]);
  return c.json(withA, 201);
});

// ── список с фильтрами ────────────────────────────────────────────────────────
// ?mine=1 &assigneeId= &projectId= &inbox=1 &important=1 &status=queued,in_progress
// &dueBefore=ISO &dueAfter=ISO
taskRoutes.get('/', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const conds: SQL[] = [];

  if (q.mine === '1') conds.push(or(eq(t.controllerId, u.sub), inArray(t.id, assignedTaskIds(u.sub)))!);
  else if (q.assigneeId) conds.push(inArray(t.id, assignedTaskIds(q.assigneeId)));

  if (q.projectId) conds.push(eq(t.projectId, q.projectId));
  if (q.inbox === '1') conds.push(eq(t.isTriaged, false));
  if (q.important === '1') conds.push(eq(t.isImportant, true));

  if (q.status) {
    const wanted = q.status.split(',').filter((s) => (STATUSES as readonly string[]).includes(s));
    if (wanted.length) conds.push(inArray(t.status, wanted as typeof STATUSES[number][]));
  }
  if (q.dueBefore) conds.push(lte(t.dueAt, new Date(q.dueBefore)));
  if (q.dueAfter) conds.push(gte(t.dueAt, new Date(q.dueAfter)));

  const vis = await visibilityCond(u);
  if (vis) conds.push(vis);

  const rows = await db
    .select()
    .from(t)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(t.isImportant), asc(t.dueAt), desc(t.priority), desc(t.createdAt))
    .limit(500);

  return c.json(await withAssignees(rows));
});

// ── одна задача ───────────────────────────────────────────────────────────────
taskRoutes.get('/:id', async (c) => {
  const u = c.get('user');
  const [task] = await db.select().from(t).where(eq(t.id, c.req.param('id'))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (u.role !== 'owner' && u.role !== 'admin') {
    const visible =
      task.creatorId === u.sub ||
      task.controllerId === u.sub ||
      (await isAssignee(task.id, u.sub)) ||
      (!!task.projectId && (await myProjectIds(u.sub)).includes(task.projectId));
    if (!visible) return c.json({ error: 'not_found' }, 404);
  }
  const [withA] = await withAssignees([task]);
  return c.json(withA);
});

// ── правка полей ──────────────────────────────────────────────────────────────
const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  controllerId: z.string().uuid().nullable().optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  externalAssignees: z.array(z.string().min(1).max(100)).optional(),
  priority: z.enum(PRIORITIES).optional(),
  isImportant: z.boolean().optional(),
  isTriaged: z.boolean().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  remindAt: z.string().datetime({ offset: true }).nullable().optional(),
});

taskRoutes.patch('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [task] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const p = updateSchema.safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.flatten() }, 400);
  const d = p.data;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.description !== undefined) patch.description = d.description;
  if (d.projectId !== undefined) patch.projectId = d.projectId;
  if (d.controllerId !== undefined) patch.controllerId = d.controllerId;
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.isImportant !== undefined) patch.isImportant = d.isImportant;
  if (d.isTriaged !== undefined) patch.isTriaged = d.isTriaged;
  if (d.dueAt !== undefined) patch.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.remindAt !== undefined) patch.remindAt = d.remindAt ? new Date(d.remindAt) : null;

  const [updated] = await db.update(t).set(patch).where(eq(t.id, id)).returning();

  // Замена набора исполнителей (если переданы).
  if (d.assigneeIds !== undefined || d.externalAssignees !== undefined) {
    await replaceAssignees(db, id, d.assigneeIds ?? [], d.externalAssignees ?? []);
    await logActivity({ taskId: id, actorId: u.sub, type: 'assigned' });
  }
  if (d.isTriaged === true && task.isTriaged === false) {
    await logActivity({ taskId: id, actorId: u.sub, type: 'triaged', payload: { projectId: updated!.projectId } });
  }
  await logActivity({ taskId: id, actorId: u.sub, type: 'edited' });
  const [withA] = await withAssignees([updated!]);
  return c.json(withA);
});

// ── смена статуса ─────────────────────────────────────────────────────────────
taskRoutes.post('/:id/status', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const p = z.object({ status: z.enum(STATUSES) }).safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const [task] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u))) return c.json({ error: 'forbidden' }, 403);
  if (task.status === p.data.status) return c.json(task);

  const [updated] = await db.update(t).set({
    status: p.data.status,
    completedAt: p.data.status === 'done' ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(t.id, id)).returning();

  await logActivity({ taskId: id, actorId: u.sub, type: 'status_changed', payload: { from: task.status, to: p.data.status } });
  const [withA] = await withAssignees([updated!]);
  return c.json(withA);
});

// ── удаление ──────────────────────────────────────────────────────────────────
taskRoutes.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  const [task] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u))) return c.json({ error: 'forbidden' }, 403);

  await db.delete(t).where(eq(t.id, id));
  return c.json({ ok: true });
});
