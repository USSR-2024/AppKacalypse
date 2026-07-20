import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { isDocsAdmin, getDocPerms, isFeatureEnabled, logDoc } from '../lib/dms.js';

// Админка модуля «Документы» (раздел «Настройки»): справочники типов/групп,
// функциональные группы согласования и матрица. Всё — ДАННЫЕ, редактируемые в UI
// (требование владельца: «редактировать и не лезть в код»). Только админ модуля.
// План M1. Спека: ТЗ §3, §5.

const g = schema.docGroups;
const t = schema.docTypes;
const ou = schema.orgUnits;
const oum = schema.orgUnitMembers;
const am = schema.approvalMatrix;
const wm = schema.workspaceMembers;
const wf = schema.workspaceFeatures;
const dmp = schema.docMemberPerms;

export const docsAdminRoutes = new Hono();
docsAdminRoutes.use('*', requireAuth, requireWorkspace);
// Гейт «Настроек» — право администрировать модуль (canManage). Фиче-флаг здесь НЕ
// проверяем намеренно: иначе, выключив модуль, владелец не смог бы включить обратно.
docsAdminRoutes.use('*', async (c, next) => {
  const w = c.get('workspace');
  const perms = await getDocPerms(w.id, c.get('user').sub, w.role);
  if (!perms.canManage) return c.json({ error: 'forbidden' }, 403);
  await next();
});

// ── Группы документов (категории) ────────────────────────────────────────────
docsAdminRoutes.get('/groups', async (c) => {
  const w = c.get('workspace');
  const rows = await db.select({ id: g.id, code: g.code, name: g.name, sortOrder: g.sortOrder, isActive: g.isActive })
    .from(g).where(eq(g.workspaceId, w.id)).orderBy(asc(g.sortOrder), asc(g.name));
  return c.json(rows);
});

const groupSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

docsAdminRoutes.post('/groups', async (c) => {
  const w = c.get('workspace');
  const p = groupSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  try {
    const [row] = await db.insert(g).values({ workspaceId: w.id, code: p.data.code, name: p.data.name, sortOrder: p.data.sortOrder ?? 0 }).returning({ id: g.id });
    return c.json(row, 201);
  } catch { return c.json({ error: 'code_taken' }, 409); }
});

docsAdminRoutes.patch('/groups/:id', async (c) => {
  const w = c.get('workspace');
  const p = groupSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  await db.update(g).set(p.data).where(and(eq(g.id, c.req.param('id')), eq(g.workspaceId, w.id)));
  return c.json({ ok: true });
});

docsAdminRoutes.delete('/groups/:id', async (c) => {
  const w = c.get('workspace');
  // Мягко: группа с типами не удалится (FK restrict) → гасим флагом.
  try {
    await db.delete(g).where(and(eq(g.id, c.req.param('id')), eq(g.workspaceId, w.id)));
    return c.json({ ok: true });
  } catch { return c.json({ error: 'in_use' }, 409); }
});

// ── Типы документов ──────────────────────────────────────────────────────────
docsAdminRoutes.get('/types', async (c) => {
  const w = c.get('workspace');
  const rows = await db.select({
    id: t.id, code: t.code, name: t.name, groupId: t.groupId, registryMask: t.registryMask,
    requiresNote: t.requiresNote, slaDays: t.slaDays, requiresCounterparty: t.requiresCounterparty,
    requiresValidity: t.requiresValidity, riskLevel: t.riskLevel, isActive: t.isActive,
    groupName: g.name,
  }).from(t).leftJoin(g, eq(g.id, t.groupId)).where(eq(t.workspaceId, w.id)).orderBy(asc(t.name));
  return c.json(rows);
});

const typeSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  groupId: z.string().uuid().nullable().optional(),
  registryMask: z.string().trim().min(1).max(100).optional(),
  requiresNote: z.boolean().optional(),
  slaDays: z.number().int().min(0).max(365).optional(),
  requiresCounterparty: z.boolean().optional(),
  requiresValidity: z.boolean().optional(),
  riskLevel: z.string().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
});

docsAdminRoutes.post('/types', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const p = typeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.issues }, 400);
  try {
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(t).values({ workspaceId: w.id, ...p.data }).returning({ id: t.id });
      await logDoc(tx, { workspaceId: w.id, entity: 'doc_type', entityId: r!.id, actorId: u.sub, action: 'created', payload: { name: p.data.name } });
      return r!;
    });
    return c.json(row, 201);
  } catch { return c.json({ error: 'code_taken' }, 409); }
});

docsAdminRoutes.patch('/types/:id', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const p = typeSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  await db.transaction(async (tx) => {
    await tx.update(t).set(p.data).where(and(eq(t.id, c.req.param('id')), eq(t.workspaceId, w.id)));
    await logDoc(tx, { workspaceId: w.id, entity: 'doc_type', entityId: c.req.param('id'), actorId: u.sub, action: 'edited', payload: { fields: Object.keys(p.data) } });
  });
  return c.json({ ok: true });
});

docsAdminRoutes.delete('/types/:id', async (c) => {
  const w = c.get('workspace');
  // Тип с документами не удаляем (FK restrict на documents.typeId) — гасим isActive.
  try {
    await db.delete(t).where(and(eq(t.id, c.req.param('id')), eq(t.workspaceId, w.id)));
    return c.json({ ok: true });
  } catch { return c.json({ error: 'in_use' }, 409); }
});

// ── Функциональные группы (кто согласует) + состав ───────────────────────────
docsAdminRoutes.get('/units', async (c) => {
  const w = c.get('workspace');
  const units = await db.select({ id: ou.id, code: ou.code, name: ou.name, isActive: ou.isActive })
    .from(ou).where(eq(ou.workspaceId, w.id)).orderBy(asc(ou.name));
  const members = await db.select({
    unitId: oum.unitId, userId: oum.userId, role: oum.role, canApprove: oum.canApprove,
    displayName: schema.users.displayName,
  }).from(oum).innerJoin(ou, eq(ou.id, oum.unitId)).innerJoin(schema.users, eq(schema.users.id, oum.userId))
    .where(eq(ou.workspaceId, w.id));
  const byUnit = new Map<string, typeof members>();
  for (const m of members) {
    const arr = byUnit.get(m.unitId) ?? [];
    arr.push(m);
    byUnit.set(m.unitId, arr);
  }
  return c.json(units.map((un) => ({ ...un, members: byUnit.get(un.id) ?? [] })));
});

const unitSchema = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1).max(200), isActive: z.boolean().optional() });

docsAdminRoutes.post('/units', async (c) => {
  const w = c.get('workspace');
  const p = unitSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  try {
    const [row] = await db.insert(ou).values({ workspaceId: w.id, ...p.data }).returning({ id: ou.id });
    return c.json(row, 201);
  } catch { return c.json({ error: 'code_taken' }, 409); }
});

docsAdminRoutes.patch('/units/:id', async (c) => {
  const w = c.get('workspace');
  const p = unitSchema.partial().safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  await db.update(ou).set(p.data).where(and(eq(ou.id, c.req.param('id')), eq(ou.workspaceId, w.id)));
  return c.json({ ok: true });
});

docsAdminRoutes.delete('/units/:id', async (c) => {
  const w = c.get('workspace');
  try {
    await db.delete(ou).where(and(eq(ou.id, c.req.param('id')), eq(ou.workspaceId, w.id)));
    return c.json({ ok: true });
  } catch { return c.json({ error: 'in_use' }, 409); }   // в матрице → FK restrict
});

// Проверка, что группа принадлежит нашему пространству (юзеров кладём только в свои).
async function unitInWs(unitId: string, wsId: string): Promise<boolean> {
  const [r] = await db.select({ id: ou.id }).from(ou).where(and(eq(ou.id, unitId), eq(ou.workspaceId, wsId))).limit(1);
  return !!r;
}

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['lead', 'member', 'deputy']).optional(),
  canApprove: z.boolean().optional(),
});

docsAdminRoutes.post('/units/:id/members', async (c) => {
  const w = c.get('workspace');
  const unitId = c.req.param('id');
  if (!(await unitInWs(unitId, w.id))) return c.json({ error: 'not_found' }, 404);
  const p = memberSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  // Юзер должен быть участником пространства.
  const [mem] = await db.select({ id: schema.workspaceMembers.userId }).from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, w.id), eq(schema.workspaceMembers.userId, p.data.userId), eq(schema.workspaceMembers.status, 'active'))).limit(1);
  if (!mem) return c.json({ error: 'not_member' }, 400);
  const [row] = await db.insert(oum).values({ unitId, userId: p.data.userId, role: p.data.role ?? 'member', canApprove: p.data.canApprove ?? false })
    .onConflictDoUpdate({ target: [oum.unitId, oum.userId], set: { role: p.data.role ?? 'member', canApprove: p.data.canApprove ?? false } })
    .returning({ id: oum.id });
  return c.json(row, 201);
});

docsAdminRoutes.delete('/units/:id/members/:userId', async (c) => {
  const w = c.get('workspace');
  if (!(await unitInWs(c.req.param('id'), w.id))) return c.json({ error: 'not_found' }, 404);
  await db.delete(oum).where(and(eq(oum.unitId, c.req.param('id')), eq(oum.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});

// ── Матрица согласований: тип → группы по стадиям ────────────────────────────
docsAdminRoutes.get('/matrix/:typeId', async (c) => {
  const w = c.get('workspace');
  const rows = await db.select({
    id: am.id, unitId: am.unitId, stageNo: am.stageNo, isRequired: am.isRequired, slaDays: am.slaDays,
    unitName: ou.name,
  }).from(am).innerJoin(ou, eq(ou.id, am.unitId))
    .where(and(eq(am.workspaceId, w.id), eq(am.typeId, c.req.param('typeId'))))
    .orderBy(asc(am.stageNo), asc(ou.name));
  return c.json(rows);
});

// Заменяем матрицу типа целиком (проще и предсказуемее, чем точечные правки).
const matrixSchema = z.object({
  rows: z.array(z.object({
    unitId: z.string().uuid(),
    stageNo: z.number().int().min(1).max(50),
    isRequired: z.boolean().optional(),
    slaDays: z.number().int().min(0).max(365).nullable().optional(),
  })).max(100),
});

docsAdminRoutes.put('/matrix/:typeId', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const typeId = c.req.param('typeId');
  const p = matrixSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  // Тип наш?
  const [ty] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, typeId), eq(t.workspaceId, w.id))).limit(1);
  if (!ty) return c.json({ error: 'not_found' }, 404);
  // Все группы — наши.
  for (const r of p.data.rows) if (!(await unitInWs(r.unitId, w.id))) return c.json({ error: 'bad_unit' }, 400);

  await db.transaction(async (tx) => {
    await tx.delete(am).where(and(eq(am.workspaceId, w.id), eq(am.typeId, typeId)));
    if (p.data.rows.length) {
      await tx.insert(am).values(p.data.rows.map((r) => ({
        workspaceId: w.id, typeId, unitId: r.unitId, stageNo: r.stageNo,
        isRequired: r.isRequired ?? true, slaDays: r.slaDays ?? null,
      })));
    }
    await logDoc(tx, { workspaceId: w.id, entity: 'matrix', entityId: typeId, actorId: u.sub, action: 'edited', payload: { rows: p.data.rows.length } });
  });
  return c.json({ ok: true });
});

// ── Доступ: фиче-флаг модуля + права участников ──────────────────────────────
// Управление доступом = действие главы пространства (owner/admin), не любого canManage
// (иначе тот, кому дали «администрировать», выдал бы себе всё). Должность (кто согласует)
// — это org_units; здесь ПРАВА ДОСТУПА, ортогональное измерение.

docsAdminRoutes.get('/access', async (c) => {
  const w = c.get('workspace');
  if (!isDocsAdmin(w.role)) return c.json({ error: 'forbidden' }, 403);
  const members = await db
    .select({ userId: wm.userId, wsRole: wm.role, displayName: schema.users.displayName })
    .from(wm).innerJoin(schema.users, eq(schema.users.id, wm.userId))
    .where(and(eq(wm.workspaceId, w.id), eq(wm.status, 'active')))
    .orderBy(asc(schema.users.displayName));
  const overrides = await db.select({ userId: dmp.userId, canCreate: dmp.canCreate, canManage: dmp.canManage, canViewAll: dmp.canViewAll })
    .from(dmp).where(eq(dmp.workspaceId, w.id));
  const byUser = new Map(overrides.map((o) => [o.userId, o]));
  return c.json({
    documentsEnabled: await isFeatureEnabled(w.id, 'documents'),
    members: members.map((m) => {
      const o = byUser.get(m.userId);
      const admin = m.wsRole === 'owner' || m.wsRole === 'admin';
      return {
        userId: m.userId, displayName: m.displayName, wsRole: m.wsRole,
        canCreate: o?.canCreate ?? true,
        canManage: o?.canManage ?? admin,
        canViewAll: o?.canViewAll ?? admin,
        isOverride: !!o,
      };
    }),
  });
});

// Включить/выключить модуль в пространстве.
docsAdminRoutes.put('/access/feature', async (c) => {
  const w = c.get('workspace');
  if (!isDocsAdmin(w.role)) return c.json({ error: 'forbidden' }, 403);
  const p = z.object({ feature: z.string().default('documents'), enabled: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  await db.insert(wf).values({ workspaceId: w.id, feature: p.data.feature, enabled: p.data.enabled })
    .onConflictDoUpdate({ target: [wf.workspaceId, wf.feature], set: { enabled: p.data.enabled } });
  return c.json({ ok: true });
});

// Задать права участника (переопределение дефолта по роли).
docsAdminRoutes.put('/access/member/:userId', async (c) => {
  const w = c.get('workspace');
  if (!isDocsAdmin(w.role)) return c.json({ error: 'forbidden' }, 403);
  const userId = c.req.param('userId');
  const p = z.object({ canCreate: z.boolean(), canManage: z.boolean(), canViewAll: z.boolean() }).safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const [mem] = await db.select({ id: wm.userId }).from(wm)
    .where(and(eq(wm.workspaceId, w.id), eq(wm.userId, userId), eq(wm.status, 'active'))).limit(1);
  if (!mem) return c.json({ error: 'not_member' }, 400);
  await db.insert(dmp).values({ workspaceId: w.id, userId, ...p.data })
    .onConflictDoUpdate({ target: [dmp.workspaceId, dmp.userId], set: p.data });
  return c.json({ ok: true });
});

// Сбросить права участника к дефолту по роли (удалить переопределение).
docsAdminRoutes.delete('/access/member/:userId', async (c) => {
  const w = c.get('workspace');
  if (!isDocsAdmin(w.role)) return c.json({ error: 'forbidden' }, 403);
  await db.delete(dmp).where(and(eq(dmp.workspaceId, w.id), eq(dmp.userId, c.req.param('userId'))));
  return c.json({ ok: true });
});
