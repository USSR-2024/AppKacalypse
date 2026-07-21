import { Hono } from 'hono';
import { and, asc, desc, eq, gte, inArray, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { logActivity } from '../lib/activity.js';
import { withAssignees, assignedTaskIds, isAssignee, replaceAssignees, loadAssignees } from '../lib/assignees.js';
import { notifyMentions, notifyAssigned } from '../lib/notify.js';
import type { SessionClaims } from '../lib/jwt.js';

export const taskRoutes = new Hono();
taskRoutes.use('*', requireAuth);
taskRoutes.use('*', requireWorkspace);

const STATUSES = ['queued', 'in_progress', 'done', 'cancelled', 'archived'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
const SOURCES = ['app', 'telegram', 'email', 'calendar', 'ai'] as const;

const t = schema.tasks;
const tc = schema.taskComments;

// Видит ли пользователь задачу (создатель/контролёр/исполнитель/член проекта; admin/owner воркспейса — всё).
async function canView(task: { id: string; creatorId: string; controllerId: string | null; projectId: string | null }, u: SessionClaims, wsRole: string): Promise<boolean> {
  if (wsRole === 'owner' || wsRole === 'admin') return true;
  if (task.creatorId === u.sub || task.controllerId === u.sub) return true;
  if (await isAssignee(task.id, u.sub)) return true;
  if (task.projectId && (await myProjectIds(u.sub)).includes(task.projectId)) return true;
  return false;
}

// Менять задачу может создатель, контролёр, любой исполнитель, admin/owner воркспейса.
async function canModify(task: { id: string; creatorId: string; controllerId: string | null }, u: SessionClaims, wsRole: string): Promise<boolean> {
  if (task.creatorId === u.sub || task.controllerId === u.sub || wsRole === 'admin' || wsRole === 'owner') return true;
  return isAssignee(task.id, u.sub);
}

// Проекты, где пользователь видит ВСЕ задачи (accessScope='all' — руководитель/lead).
// Участники с accessScope='own' видят только свои задачи (через creator/controller/assignee).
async function myProjectIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ pid: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(and(eq(schema.projectMembers.userId, userId), eq(schema.projectMembers.accessScope, 'all')));
  return rows.map((r) => r.pid);
}

// Видимость: member видит задачи, где он автор/контролёр/исполнитель или член проекта.
// owner/admin видят всё (надзор). Возвращает null, если ограничение не нужно.
async function visibilityCond(u: SessionClaims, wsRole: string): Promise<SQL | null> {
  if (wsRole === 'owner' || wsRole === 'admin') return null;
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
  sectionId: z.string().uuid().nullable().optional(),
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
  const ws = c.get('workspace');
  const body = await c.req.json().catch(() => null);
  const p = createSchema.safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.flatten() }, 400);
  const d = p.data;

  const source = d.source ?? 'app';
  // Задача без проекта от AI/телеги/почты → во Входящих; явно созданная в приложении → разобрана.
  const isTriaged = d.isTriaged ?? (d.projectId ? true : source === 'app');

  const task = await db.transaction(async (tx) => {
    const [created] = await tx.insert(t).values({
      workspaceId: ws.id,
      title: d.title,
      description: d.description ?? '',
      projectId: d.projectId ?? null,
      sectionId: d.sectionId ?? null,
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
  if (d.assigneeIds?.length) {
    const [actor] = await db.select({ name: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, u.sub)).limit(1);
    await notifyAssigned(task.id, task.title, actor?.name ?? 'Кто-то', d.assigneeIds, u.sub);
  }
  const [withA] = await withAssignees([task]);
  return c.json(withA, 201);
});

// ── список с фильтрами ────────────────────────────────────────────────────────
// ?mine=1 &assigneeId= &projectId= &inbox=1 &important=1 &status=queued,in_progress
// &dueBefore=ISO &dueAfter=ISO
taskRoutes.get('/', async (c) => {
  const u = c.get('user');
  const ws = c.get('workspace');
  const q = c.req.query();
  const conds: SQL[] = [eq(t.workspaceId, ws.id)];

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

  const vis = await visibilityCond(u, ws.role);
  if (vis) conds.push(vis);

  const rows = await db
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(desc(t.isImportant), asc(t.dueAt), desc(t.priority), desc(t.createdAt))
    .limit(500);

  return c.json(await withAssignees(rows));
});

// ── одна задача ───────────────────────────────────────────────────────────────
taskRoutes.get('/:id', async (c) => {
  const u = c.get('user');
  const ws = c.get('workspace');
  const [task] = await db.select().from(t).where(and(eq(t.id, c.req.param('id')), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canView(task, u, ws.role))) return c.json({ error: 'not_found' }, 404);
  const [withA] = await withAssignees([task]);
  return c.json(withA);
});

// ── комментарии задачи ────────────────────────────────────────────────────────
taskRoutes.get('/:id/comments', async (c) => {
  const u = c.get('user');
  const ws = c.get('workspace');
  const [task] = await db.select().from(t).where(and(eq(t.id, c.req.param('id')), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canView(task, u, ws.role))) return c.json({ error: 'not_found' }, 404);

  const rows = await db
    .select({
      id: tc.id,
      body: tc.body,
      mentions: tc.mentions,
      createdAt: tc.createdAt,
      authorId: tc.authorId,
      authorName: schema.users.displayName,
      authorAvatar: schema.users.avatarUrl,
    })
    .from(tc)
    .innerJoin(schema.users, eq(schema.users.id, tc.authorId))
    .where(eq(tc.taskId, task.id))
    .orderBy(asc(tc.createdAt))
    .limit(500);
  return c.json(rows);
});

taskRoutes.post('/:id/comments', async (c) => {
  const u = c.get('user');
  const ws = c.get('workspace');
  const [task] = await db.select().from(t).where(and(eq(t.id, c.req.param('id')), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canView(task, u, ws.role))) return c.json({ error: 'not_found' }, 404);

  const p = z.object({
    body: z.string().min(1).max(2000),
    mentions: z.array(z.string().uuid()).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const mentions = p.data.mentions ?? [];

  const [me] = await db
    .select({ name: schema.users.displayName, avatar: schema.users.avatarUrl })
    .from(schema.users)
    .where(eq(schema.users.id, u.sub))
    .limit(1);

  const [created] = await db.insert(tc).values({ taskId: task.id, authorId: u.sub, body: p.data.body, mentions }).returning();
  await logActivity({ taskId: task.id, actorId: u.sub, type: 'commented' });
  await notifyMentions(task.id, task.title, me?.name ?? 'Кто-то', p.data.body, mentions, u.sub);

  return c.json({
    id: created!.id,
    body: created!.body,
    mentions: created!.mentions,
    createdAt: created!.createdAt,
    authorId: u.sub,
    authorName: me?.name ?? '',
    authorAvatar: me?.avatar ?? null,
  }, 201);
});

// ── правка полей ──────────────────────────────────────────────────────────────
const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
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
  const ws = c.get('workspace');
  const id = c.req.param('id');
  const [task] = await db.select().from(t).where(and(eq(t.id, id), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u, ws.role))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const p = updateSchema.safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.flatten() }, 400);
  const d = p.data;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.description !== undefined) patch.description = d.description;
  if (d.projectId !== undefined) patch.projectId = d.projectId;
  if (d.sectionId !== undefined) patch.sectionId = d.sectionId;
  // Сменили проект, но раздел явно не задан → сбрасываем (секция принадлежит проекту).
  if (d.projectId !== undefined && d.projectId !== task.projectId && d.sectionId === undefined) patch.sectionId = null;
  if (d.controllerId !== undefined) patch.controllerId = d.controllerId;
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.isImportant !== undefined) patch.isImportant = d.isImportant;
  if (d.isTriaged !== undefined) patch.isTriaged = d.isTriaged;
  if (d.dueAt !== undefined) patch.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.remindAt !== undefined) patch.remindAt = d.remindAt ? new Date(d.remindAt) : null;

  const [updated] = await db.update(t).set(patch).where(eq(t.id, id)).returning();

  // Замена набора исполнителей (если переданы).
  if (d.assigneeIds !== undefined || d.externalAssignees !== undefined) {
    const before = (await loadAssignees([id])).get(id) ?? [];
    const oldIds = new Set(before.map((a) => a.userId).filter(Boolean) as string[]);
    await replaceAssignees(db, id, d.assigneeIds ?? [], d.externalAssignees ?? []);
    await logActivity({ taskId: id, actorId: u.sub, type: 'assigned' });
    const added = (d.assigneeIds ?? []).filter((uid) => !oldIds.has(uid));
    if (added.length) {
      const [actor] = await db.select({ name: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, u.sub)).limit(1);
      await notifyAssigned(id, updated!.title, actor?.name ?? 'Кто-то', added, u.sub);
    }
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
  const ws = c.get('workspace');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const p = z.object({ status: z.enum(STATUSES) }).safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const [task] = await db.select().from(t).where(and(eq(t.id, id), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u, ws.role))) return c.json({ error: 'forbidden' }, 403);
  // Задача-мост из «Документов» — системная: статус ведёт движок согласования, руками нельзя.
  if (task.documentId) return c.json({ error: 'managed_by_document' }, 409);
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
  const ws = c.get('workspace');
  const id = c.req.param('id');
  const [task] = await db.select().from(t).where(and(eq(t.id, id), eq(t.workspaceId, ws.id))).limit(1);
  if (!task) return c.json({ error: 'not_found' }, 404);
  if (!(await canModify(task, u, ws.role))) return c.json({ error: 'forbidden' }, 403);

  await db.delete(t).where(eq(t.id, id));
  return c.json({ ok: true });
});
