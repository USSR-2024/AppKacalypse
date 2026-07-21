import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { nextRegistryNumber, visibilityCond, canView, getDocPerms, isFeatureEnabled, logDoc, versionKey, dsKey } from '../lib/dms.js';
import { putVersion, getVersionStream } from '../lib/dms-storage.js';
import { BLANK_DOCX_B64 } from '../lib/blank-docx.js';
import { startRoute, activeStepForUser, approveStep, rejectStep, assembleMatrix, type RouteStepInput } from '../lib/route-engine.js';
import { openTrackingTask, openStepTasks, closeStepTask, cancelOpenStepTasks, closeTrackingTask, type DocMeta } from '../lib/doc-tasks.js';
import { notifyApprovalStep, notifyApprovalDecision } from '../lib/notify.js';
import { env } from '../lib/env.js';
import {
  dsEnabled, signDs, signFileToken, signCallbackToken, docType, resolveAccess, commandForcesave,
} from '../lib/ds.js';

// /api/documents — карточки документов, версии, переход на согласование.
// Модуль «Документы»: спека docs/ТЗ-документооборот.md, порядок docs/ПЛАН-документооборот.md.

const doc = schema.documents;
const ver = schema.documentVersions;

/** Имя пользователя для уведомлений (в JWT его нет — только id и роль). */
async function actorDisplayName(userId: string): Promise<string> {
  const [row] = await db.select({ name: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row?.name ?? 'Пользователь';
}

/** Контрагент из справочника этого ws → {id, name}, иначе null (чужой/несуществующий). */
async function resolveCounterparty(workspaceId: string, counterpartyId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db.select({ id: schema.docCounterparties.id, name: schema.docCounterparties.name })
    .from(schema.docCounterparties)
    .where(and(eq(schema.docCounterparties.id, counterpartyId), eq(schema.docCounterparties.workspaceId, workspaceId))).limit(1);
  return row ?? null;
}

export const documentRoutes = new Hono();
documentRoutes.use('*', requireAuth, requireWorkspace);
// Фиче-флаг модуля + права юзера (резолвим один раз, кладём в контекст).
documentRoutes.use('*', async (c, next) => {
  const w = c.get('workspace');
  if (!(await isFeatureEnabled(w.id, 'documents'))) return c.json({ error: 'module_disabled' }, 403);
  c.set('docPerms', await getDocPerms(w.id, c.get('user').sub, w.role));
  await next();
});

const MAX_FILE = 100 * 1024 * 1024;   // 100 МБ — договор столько не весит; защита от заливки видео

// ── Список ───────────────────────────────────────────────────────────────────
// Базовый (полный реестр с фасетами — фаза 6).
documentRoutes.get('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const conds = [eq(doc.workspaceId, w.id)];
  const vis = visibilityCond(u, c.get('docPerms').canViewAll);
  if (vis) conds.push(vis);

  const status = z.enum(['draft', 'on_approval', 'rework', 'approved', 'on_signing', 'signed', 'active', 'expired', 'terminated', 'archived', 'cancelled'])
    .optional().safeParse(c.req.query('status'));
  if (status.success && status.data) conds.push(eq(doc.status, status.data));

  // Корзина IA: «В работе» (идёт согласование/подписание) vs «Реестр» (подписанные/архив).
  // Явный status уточняет внутри корзины; без него — вся корзина.
  else {
    const bucket = c.req.query('bucket');
    if (bucket === 'active') conds.push(inArray(doc.status, ['draft', 'on_approval', 'rework', 'approved', 'on_signing']));
    else if (bucket === 'registry') conds.push(inArray(doc.status, ['signed', 'active', 'expired', 'terminated', 'archived', 'cancelled']));
  }

  // Фасеты реестра: контрагент, категория(группа), тип. «Все документы контрагента».
  const cpId = c.req.query('counterpartyId');
  if (cpId) conds.push(eq(doc.counterpartyId, cpId));
  const groupId = c.req.query('groupId');
  if (groupId) conds.push(eq(doc.groupId, groupId));
  const typeId = c.req.query('typeId');
  if (typeId) conds.push(eq(doc.typeId, typeId));

  // Личные срезы: «мои» (я автор или ответственный) и «просрочено» (срок в прошлом).
  if (c.req.query('mine') === '1') conds.push(or(eq(doc.authorId, u.sub), eq(doc.ownerId, u.sub))!);
  if (c.req.query('overdue') === '1') conds.push(and(isNotNull(doc.dueAt), lt(doc.dueAt, new Date()))!);

  const rows = await db
    .select({
      id: doc.id, registryNumber: doc.registryNumber, title: doc.title, status: doc.status,
      priority: doc.priority, dueAt: doc.dueAt, counterpartyName: doc.counterpartyName, counterpartyId: doc.counterpartyId,
      typeName: schema.docTypes.name, groupName: schema.docGroups.name,
      ownerName: schema.users.displayName,
      createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    })
    .from(doc)
    .leftJoin(schema.docTypes, eq(schema.docTypes.id, doc.typeId))
    .leftJoin(schema.docGroups, eq(schema.docGroups.id, doc.groupId))
    .leftJoin(schema.users, eq(schema.users.id, doc.ownerId))
    .where(and(...conds))
    .orderBy(desc(doc.updatedAt));
  return c.json(rows);
});

// Типы документов для формы создания. ★ Строго ДО '/:id': Hono матчит роуты по
// порядку регистрации, иначе 'types' уедет в параметрический роут как id.
documentRoutes.get('/types', async (c) => {
  const w = c.get('workspace');
  const rows = await db
    .select({
      id: schema.docTypes.id, code: schema.docTypes.code, name: schema.docTypes.name,
      requiresNote: schema.docTypes.requiresNote,
    })
    .from(schema.docTypes)
    .where(and(eq(schema.docTypes.workspaceId, w.id), eq(schema.docTypes.isActive, true)))
    .orderBy(schema.docTypes.name);
  return c.json(rows);
});

// Участники пространства — кого можно поставить согласующим. ★ Строго ДО '/:id'.
documentRoutes.get('/members', async (c) => {
  const w = c.get('workspace');
  const rows = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(and(eq(schema.workspaceMembers.workspaceId, w.id), eq(schema.workspaceMembers.status, 'active')))
    .orderBy(schema.users.displayName);
  return c.json(rows);
});

// Моя очередь: документы, где сейчас ждут МОЕГО решения (активный шаг на мне).
// ★ Строго ДО '/:id'. Это «жду моего решения» — главный видимый экран согласующего.
documentRoutes.get('/inbox', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const rows = await db
    .select({
      id: doc.id, registryNumber: doc.registryNumber, title: doc.title, status: doc.status,
      priority: doc.priority, dueAt: doc.dueAt, counterpartyName: doc.counterpartyName,
      typeName: schema.docTypes.name, ownerName: schema.users.displayName,
      stageNo: schema.routeSteps.stageNo, activatedAt: schema.routeSteps.activatedAt,
      updatedAt: doc.updatedAt,
    })
    .from(schema.routeSteps)
    .innerJoin(schema.routeInstances, eq(schema.routeInstances.id, schema.routeSteps.routeInstanceId))
    .innerJoin(doc, eq(doc.id, schema.routeInstances.documentId))
    .leftJoin(schema.docTypes, eq(schema.docTypes.id, doc.typeId))
    .leftJoin(schema.users, eq(schema.users.id, doc.ownerId))
    .where(and(
      eq(doc.workspaceId, w.id),
      eq(schema.routeSteps.assigneeId, u.sub),
      eq(schema.routeSteps.status, 'active'),
      eq(schema.routeInstances.status, 'running'),
    ))
    .orderBy(desc(schema.routeSteps.activatedAt));
  return c.json(rows);
});

// ── Справочник контрагентов (M2) ─────────────────────────────────────────────
// ★ Строго ДО '/:id'. Читают все (для пикера и фасета реестра); создавать может
// canCreate (в т.ч. инлайн при заведении документа), править/удалять — canManage.
const cp = schema.docCounterparties;

documentRoutes.get('/counterparties', async (c) => {
  const w = c.get('workspace');
  const all = c.req.query('all') === '1';
  const conds = [eq(cp.workspaceId, w.id)];
  if (!all) conds.push(eq(cp.isActive, true));
  const rows = await db
    .select({ id: cp.id, name: cp.name, inn: cp.inn, note: cp.note, externalSource: cp.externalSource, isActive: cp.isActive })
    .from(cp).where(and(...conds)).orderBy(cp.name);
  return c.json(rows);
});

const cpCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  inn: z.string().trim().max(20).optional(),
  note: z.string().trim().max(1000).optional(),
});

documentRoutes.post('/counterparties', async (c) => {
  const w = c.get('workspace');
  if (!c.get('docPerms').canCreate) return c.json({ error: 'no_create_permission' }, 403);
  const p = cpCreateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  try {
    const [row] = await db.insert(cp).values({
      workspaceId: w.id, name: p.data.name, inn: p.data.inn || null, note: p.data.note || null,
    }).returning({ id: cp.id, name: cp.name, inn: cp.inn, note: cp.note, isActive: cp.isActive });
    return c.json(row, 201);
  } catch {
    return c.json({ error: 'duplicate_name' }, 409);   // unique(workspace_id,name)
  }
});

const cpUpdateSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  inn: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

documentRoutes.patch('/counterparties/:cid', async (c) => {
  const w = c.get('workspace');
  if (!c.get('docPerms').canManage) return c.json({ error: 'forbidden' }, 403);
  const p = cpUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (p.data.name !== undefined) patch.name = p.data.name;
  if (p.data.inn !== undefined) patch.inn = p.data.inn || null;
  if (p.data.note !== undefined) patch.note = p.data.note || null;
  if (p.data.isActive !== undefined) patch.isActive = p.data.isActive;
  try {
    const [row] = await db.update(cp).set(patch)
      .where(and(eq(cp.id, c.req.param('cid')), eq(cp.workspaceId, w.id)))
      .returning({ id: cp.id, name: cp.name, inn: cp.inn, note: cp.note, isActive: cp.isActive });
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(row);
  } catch {
    return c.json({ error: 'duplicate_name' }, 409);
  }
});

documentRoutes.delete('/counterparties/:cid', async (c) => {
  const w = c.get('workspace');
  if (!c.get('docPerms').canManage) return c.json({ error: 'forbidden' }, 403);
  // FK documents.counterparty_id ON DELETE SET NULL — привязанные документы сохранят
  // строковое имя (counterparty_name), но потеряют ссылку. Мягче — деактивация (PATCH).
  await db.delete(cp).where(and(eq(cp.id, c.req.param('cid')), eq(cp.workspaceId, w.id)));
  return c.json({ ok: true });
});

// ── Карточка ─────────────────────────────────────────────────────────────────
documentRoutes.get('/:id', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;

  // Джойны обязательны: карточка документа без названия типа — не карточка.
  const [row] = await db
    .select({
      id: doc.id, workspaceId: doc.workspaceId, registryNumber: doc.registryNumber, title: doc.title,
      description: doc.description, status: doc.status, priority: doc.priority, priorityReason: doc.priorityReason,
      dueAt: doc.dueAt, typeId: doc.typeId, groupId: doc.groupId,
      counterpartyId: doc.counterpartyId, counterpartyName: doc.counterpartyName,
      amount: doc.amount, currency: doc.currency, currentVersionId: doc.currentVersionId,
      signedVersionId: doc.signedVersionId, storageLocation: doc.storageLocation,
      dateSigned: doc.dateSigned, effectiveFrom: doc.effectiveFrom, effectiveTo: doc.effectiveTo,
      authorId: doc.authorId, ownerId: doc.ownerId, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
      typeName: schema.docTypes.name, requiresNote: schema.docTypes.requiresNote,
      groupName: schema.docGroups.name, ownerName: schema.users.displayName,
    })
    .from(doc)
    .leftJoin(schema.docTypes, eq(schema.docTypes.id, doc.typeId))
    .leftJoin(schema.docGroups, eq(schema.docGroups.id, doc.groupId))
    .leftJoin(schema.users, eq(schema.users.id, doc.ownerId))
    .where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  const versions = await db
    .select({
      id: ver.id, versionNo: ver.versionNo, fileName: ver.fileName, fileSize: ver.fileSize,
      fileHash: ver.fileHash, mimeType: ver.mimeType, comment: ver.comment,
      isSignedOriginal: ver.isSignedOriginal, createdAt: ver.createdAt,
      authorName: schema.users.displayName,
    })
    .from(ver)
    .leftJoin(schema.users, eq(schema.users.id, ver.authorId))
    .where(eq(ver.documentId, id))
    .orderBy(desc(ver.versionNo));

  // Черновик правит только его владелец (или админ модуля); дальше карточка read-only,
  // менять её содержимое можно лишь загрузкой новой версии.
  const perms = c.get('docPerms');
  const mine = perms.canManage || row.ownerId === u.sub || row.authorId === u.sub;
  const canEdit = row.status === 'draft' && mine;
  // Отправить на согласование может владелец карточки из черновика или из корректировки.
  const canSubmit = (row.status === 'draft' || row.status === 'rework') && mine;
  return c.json({ ...row, versions, canEdit, canSubmit, canManage: perms.canManage });
});

// ── Создание ─────────────────────────────────────────────────────────────────
const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  typeId: z.string().uuid(),
  description: z.string().max(10000).optional(),
  counterpartyId: z.string().uuid().nullable().optional(),   // из справочника (M2)
  counterpartyName: z.string().max(500).optional(),          // свободный ввод (fallback)
  priority: z.enum(['critical', 'urgent', 'important', 'low']).optional(),
  priorityReason: z.string().max(1000).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
});

documentRoutes.post('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  if (!c.get('docPerms').canCreate) return c.json({ error: 'no_create_permission' }, 403);
  const p = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request', details: p.error.issues }, 400);

  const [type] = await db.select({ id: schema.docTypes.id, groupId: schema.docTypes.groupId, isActive: schema.docTypes.isActive })
    .from(schema.docTypes)
    .where(and(eq(schema.docTypes.id, p.data.typeId), eq(schema.docTypes.workspaceId, w.id))).limit(1);
  if (!type || !type.isActive) return c.json({ error: 'bad_type' }, 400);

  // Критический приоритет требует обоснования — иначе критическим станет всё.
  if (p.data.priority === 'critical' && !p.data.priorityReason?.trim()) {
    return c.json({ error: 'priority_reason_required' }, 400);
  }

  // Контрагент из справочника → берём его имя (денормализация); иначе свободный ввод.
  let cpId: string | null = null;
  let cpName: string | null = p.data.counterpartyName?.trim() || null;
  if (p.data.counterpartyId) {
    const found = await resolveCounterparty(w.id, p.data.counterpartyId);
    if (!found) return c.json({ error: 'bad_counterparty' }, 400);
    cpId = found.id; cpName = found.name;
  }

  const row = await db.transaction(async (tx) => {
    const [d] = await tx.insert(doc).values({
      workspaceId: w.id,
      title: p.data.title,
      description: p.data.description ?? null,
      typeId: type.id,
      groupId: type.groupId,          // группа наследуется от типа
      authorId: u.sub,
      ownerId: u.sub,                 // ответственный по умолчанию — инициатор
      counterpartyId: cpId,
      counterpartyName: cpName,
      priority: p.data.priority ?? 'important',
      priorityReason: p.data.priorityReason ?? null,
      dueAt: p.data.dueAt ? new Date(p.data.dueAt) : null,
      amount: p.data.amount != null ? String(p.data.amount) : null,
      currency: p.data.currency ?? null,
    }).returning({ id: doc.id, status: doc.status });
    await logDoc(tx, {
      workspaceId: w.id, documentId: d!.id, entity: 'document', entityId: d!.id,
      actorId: u.sub, action: 'created', payload: { title: p.data.title },
    });
    return d!;
  });
  return c.json(row, 201);
});

// ── Правка черновика ─────────────────────────────────────────────────────────
const patchSchema = createSchema.partial().omit({ typeId: true });

documentRoutes.patch('/:id', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  const p = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const [row] = await db.select().from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!c.get('docPerms').canManage && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  // Ушедшую на согласование карточку не правим: у согласующих на руках её содержимое.
  if (row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);

  const d = p.data;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.description !== undefined) patch.description = d.description;
  // Контрагент: id из справочника (проставляем и денормализованное имя), либо свободный ввод.
  if (d.counterpartyId !== undefined) {
    if (d.counterpartyId) {
      const found = await resolveCounterparty(w.id, d.counterpartyId);
      if (!found) return c.json({ error: 'bad_counterparty' }, 400);
      patch.counterpartyId = found.id; patch.counterpartyName = found.name;
    } else {
      patch.counterpartyId = null;   // отвязали от справочника (имя оставит следующая строка, если пришло)
    }
  }
  if (d.counterpartyName !== undefined) patch.counterpartyName = d.counterpartyName;
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.priorityReason !== undefined) patch.priorityReason = d.priorityReason;
  if (d.dueAt !== undefined) patch.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.amount !== undefined) patch.amount = d.amount != null ? String(d.amount) : null;
  if (d.currency !== undefined) patch.currency = d.currency;

  const finalPriority = (patch.priority as string) ?? row.priority;
  const finalReason = (patch.priorityReason as string | null) ?? row.priorityReason;
  if (finalPriority === 'critical' && !finalReason?.trim()) return c.json({ error: 'priority_reason_required' }, 400);

  await db.transaction(async (tx) => {
    await tx.update(doc).set(patch).where(eq(doc.id, id));
    await logDoc(tx, {
      workspaceId: w.id, documentId: id, entity: 'document', entityId: id,
      actorId: u.sub, action: 'edited', payload: { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });
  });
  return c.json({ ok: true });
});

// ── Версии ───────────────────────────────────────────────────────────────────

// Загрузка версии: PUT с сырым телом (?filename=). Не multipart: parseBody складывает
// тело целиком в RAM — на этом уже горели при заливке видео (см. CLAUDE.md).
documentRoutes.put('/:id/versions', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  const fileName = (c.req.query('filename') || '').trim();
  const comment = (c.req.query('comment') || '').trim() || null;
  if (!fileName) return c.json({ error: 'filename_required' }, 400);

  const [row] = await db.select().from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!c.get('docPerms').canManage && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  // Версию кладём в черновик или в карточку, вернувшуюся на корректировку.
  if (row.status !== 'draft' && row.status !== 'rework') return c.json({ error: 'bad_status' }, 409);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'empty_body' }, 400);
  const buf = Buffer.from(await new Response(body).arrayBuffer());
  if (!buf.length) return c.json({ error: 'empty_file' }, 400);
  if (buf.length > MAX_FILE) return c.json({ error: 'too_large' }, 413);

  const mime = c.req.header('content-type') || 'application/octet-stream';
  const ext = extname(fileName) || '.bin';

  try {
    const created = await db.transaction(async (tx) => {
      // Номер версии берём под блокировкой строки карточки: две одновременные
      // загрузки иначе получат один номер и вторая упадёт на уникальном индексе.
      await tx.execute(sql`SELECT id FROM documents WHERE id = ${id} FOR UPDATE`);
      const [last] = await tx.select({ n: ver.versionNo }).from(ver)
        .where(eq(ver.documentId, id)).orderBy(desc(ver.versionNo)).limit(1);
      const versionNo = (last?.n ?? 0) + 1;
      const key = versionKey(id, versionNo, ext);

      const { hash, size } = await putVersion(key, buf, mime);
      const [v] = await tx.insert(ver).values({
        documentId: id, versionNo, objectKey: key, fileName, fileSize: size,
        fileHash: hash, mimeType: mime, authorId: u.sub, comment,
        dsKey: dsKey(id, versionNo, hash),   // резерв под ONLYOFFICE; хэш решает инвалидацию кэша
      }).returning({ id: ver.id, versionNo: ver.versionNo });

      await tx.update(doc).set({ currentVersionId: v!.id, updatedAt: new Date() }).where(eq(doc.id, id));
      await logDoc(tx, {
        workspaceId: w.id, documentId: id, entity: 'version', entityId: v!.id,
        actorId: u.sub, action: 'version_saved', payload: { versionNo, fileName, size, hash },
      });
      return v!;
    });
    return c.json(created, 201);
  } catch (e) {
    console.error('version upload failed', e);
    return c.json({ error: 'upload_failed' }, 502);
  }
});

// Создать ПУСТУЮ версию (чистый docx) — чтобы начать документ прямо в приложении,
// без готового файла. Дальше открывается в редакторе. Только на свежей карточке-черновике.
documentRoutes.post('/:id/versions/blank', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;

  const [row] = await db.select({ status: doc.status, ownerId: doc.ownerId, authorId: doc.authorId })
    .from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!c.get('docPerms').canManage && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);

  const [existing] = await db.select({ id: ver.id }).from(ver).where(eq(ver.documentId, id)).limit(1);
  if (existing) return c.json({ error: 'has_versions' }, 409);   // пустой док заводят только на чистой карточке

  const buf = Buffer.from(BLANK_DOCX_B64, 'base64');
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const fileName = 'Документ.docx';
  const key = versionKey(id, 1, '.docx');

  const created = await db.transaction(async (tx) => {
    const { hash, size } = await putVersion(key, buf, mime);
    const [v] = await tx.insert(ver).values({
      documentId: id, versionNo: 1, objectKey: key, fileName, fileSize: size,
      fileHash: hash, mimeType: mime, authorId: u.sub, comment: 'Создан пустой документ',
      dsKey: dsKey(id, 1, hash),
    }).returning({ id: ver.id, versionNo: ver.versionNo });
    await tx.update(doc).set({ currentVersionId: v!.id, updatedAt: new Date() }).where(eq(doc.id, id));
    await logDoc(tx, {
      workspaceId: w.id, documentId: id, entity: 'version', entityId: v!.id,
      actorId: u.sub, action: 'version_saved', payload: { versionNo: 1, blank: true },
    });
    return v!;
  });
  return c.json(created, 201);
});

// Скачать версию. Файлы отдаёт только бэкенд, проверив права: бакет не публичный.
documentRoutes.get('/:id/versions/:versionId/file', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  const [v] = await db.select({ key: ver.objectKey, fileName: ver.fileName, mime: ver.mimeType })
    .from(ver).where(and(eq(ver.id, c.req.param('versionId')!), eq(ver.documentId, id))).limit(1);
  if (!v) return c.json({ error: 'not_found' }, 404);

  let node: Readable;
  try {
    node = await getVersionStream(v.key);
  } catch {
    return c.json({ error: 'unavailable' }, 502);
  }
  c.header('Content-Type', v.mime);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(v.fileName)}`);
  return c.body(Readable.toWeb(node) as ReadableStream);
});

// ── Предпросмотр маршрута ────────────────────────────────────────────────────
// Есть ли матрица для типа и как соберётся маршрут. Фронт по этому показывает либо
// авто-предпросмотр (матрица), либо ручной выбор людей.
documentRoutes.get('/:id/route-preview', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);
  const [row] = await db.select({ typeId: doc.typeId }).from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);

  const asm = await assembleMatrix(w.id, row.typeId);
  if (!asm.hasMatrix) return c.json({ mode: 'manual' });
  const unresolvedRequired = asm.rows.filter((r) => r.isRequired && !r.assigneeId).map((r) => r.unitName);
  return c.json({ mode: 'matrix', rows: asm.rows, canSubmit: unresolvedRequired.length === 0, unresolvedRequired });
});

// ── Переход на согласование ──────────────────────────────────────────────────
// Карточка получает реестровый номер (ОДИН РАЗ) и стартует маршрут. Если у типа
// есть матрица — маршрут собирается САМ (группы → конкретные визирующие); иначе
// берём переданный вручную список людей (ad-hoc).
const submitSchema = z.object({
  approvers: z.array(z.string().uuid()).max(20).optional(),   // нужны только при РУЧНОМ маршруте (нет матрицы)
});

documentRoutes.post('/:id/submit', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  const p = submitSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const [row] = await db.select().from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!c.get('docPerms').canManage && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'draft' && row.status !== 'rework') return c.json({ error: 'not_submittable' }, 409);
  if (!row.currentVersionId) return c.json({ error: 'no_version' }, 409);   // согласовывать нечего

  const [type] = await db.select({
    id: schema.docTypes.id, code: schema.docTypes.code, registryMask: schema.docTypes.registryMask,
    requiresNote: schema.docTypes.requiresNote,
  }).from(schema.docTypes).where(eq(schema.docTypes.id, row.typeId)).limit(1);
  if (!type) return c.json({ error: 'bad_type' }, 400);

  if (type.requiresNote) {
    const [note] = await db.select({ id: schema.explanatoryNotes.id })
      .from(schema.explanatoryNotes).where(eq(schema.explanatoryNotes.documentId, id)).limit(1);
    if (!note) return c.json({ error: 'note_required' }, 409);
  }

  // ── Собрать шаги: из матрицы либо из ручного списка ──
  const asm = await assembleMatrix(w.id, row.typeId);
  let steps: RouteStepInput[];
  let definition: Record<string, unknown>;
  if (asm.hasMatrix) {
    const unresolved = asm.rows.filter((r) => r.isRequired && !r.assigneeId).map((r) => r.unitName);
    if (unresolved.length) return c.json({ error: 'unresolved_groups', groups: unresolved }, 409);
    steps = asm.rows.filter((r) => r.assigneeId).map((r) => ({ unitId: r.unitId, assigneeId: r.assigneeId!, stageNo: r.stageNo, isRequired: r.isRequired }));
    if (!steps.length) return c.json({ error: 'empty_route' }, 409);
    definition = { mode: 'matrix', rows: asm.rows };
  } else {
    const approverIds = [...new Set(p.data.approvers ?? [])];
    if (!approverIds.length) return c.json({ error: 'approvers_required' }, 400);
    const members = await db
      .select({ id: schema.users.id, name: schema.users.displayName })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
      .where(and(eq(schema.workspaceMembers.workspaceId, w.id), eq(schema.workspaceMembers.status, 'active'), inArray(schema.users.id, approverIds)));
    const byId = new Map(members.map((m) => [m.id, m.name]));
    if (approverIds.some((aid) => !byId.has(aid))) return c.json({ error: 'bad_approver' }, 400);
    // Ручной маршрут = цепочка: каждый на своей стадии (последовательно).
    steps = approverIds.map((aid, i) => ({ unitId: null, assigneeId: aid, stageNo: i + 1, isRequired: true }));
    definition = { mode: 'manual', approvers: approverIds.map((aid) => ({ userId: aid, name: byId.get(aid)! })) };
  }

  const [group] = row.groupId
    ? await db.select({ code: schema.docGroups.code }).from(schema.docGroups).where(eq(schema.docGroups.id, row.groupId)).limit(1)
    : [{ code: '' }];

  const result = await db.transaction(async (tx) => {
    const number = row.registryNumber ?? await nextRegistryNumber(tx, w.id, type, group?.code ?? '');
    await tx.update(doc).set({ registryNumber: number, status: 'on_approval', updatedAt: new Date() }).where(eq(doc.id, id));
    await logDoc(tx, {
      workspaceId: w.id, documentId: id, entity: 'document', entityId: id, actorId: u.sub,
      action: 'status_changed', payload: { from: row.status, to: 'on_approval', registryNumber: number },
    });
    const started = await startRoute(tx, { workspaceId: w.id, documentId: id, steps, definition, actorId: u.sub });
    // Мост в задачи: инициатору — трекинг-задача, согласующим первой стадии — задачи во «Входящие».
    const meta: DocMeta = { workspaceId: w.id, documentId: id, docTitle: row.title, registryNumber: number, authorId: row.authorId, dueAt: row.dueAt };
    await openTrackingTask(tx, meta);
    await openStepTasks(tx, meta);
    return { registryNumber: number, firstAssignees: started.firstAssignees };
  });

  // Уведомляем всех согласующих первой стадии (вне транзакции — внешние каналы не откатишь).
  const actorName = await actorDisplayName(u.sub);
  for (const aid of [...new Set(result.firstAssignees)]) notifyApprovalStep(id, row.title, aid, actorName, u.sub).catch(() => {});
  return c.json({ ok: true, registryNumber: result.registryNumber, status: 'on_approval' });
});

// ── Маршрут документа: цепочка шагов + замечания ─────────────────────────────
documentRoutes.get('/:id/route', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  // Последний (текущий) круг согласования.
  const [route] = await db
    .select({ id: schema.routeInstances.id, status: schema.routeInstances.status, currentStage: schema.routeInstances.currentStage, iteration: schema.routeInstances.iteration, startedAt: schema.routeInstances.startedAt })
    .from(schema.routeInstances)
    .where(eq(schema.routeInstances.documentId, id))
    .orderBy(desc(schema.routeInstances.iteration))
    .limit(1);
  if (!route) return c.json({ route: null, steps: [], remarks: [] });

  const steps = await db
    .select({
      id: schema.routeSteps.id, stageNo: schema.routeSteps.stageNo, status: schema.routeSteps.status,
      assigneeId: schema.routeSteps.assigneeId, assigneeName: schema.users.displayName,
      activatedAt: schema.routeSteps.activatedAt, decidedAt: schema.routeSteps.decidedAt,
    })
    .from(schema.routeSteps)
    .leftJoin(schema.users, eq(schema.users.id, schema.routeSteps.assigneeId))
    .where(eq(schema.routeSteps.routeInstanceId, route.id))
    .orderBy(schema.routeSteps.stageNo);

  const remarks = await db
    .select({
      id: schema.stepRemarks.id, stepId: schema.stepRemarks.stepId, kind: schema.stepRemarks.kind,
      text: schema.stepRemarks.text, createdAt: schema.stepRemarks.createdAt,
      authorName: schema.users.displayName,
    })
    .from(schema.stepRemarks)
    .leftJoin(schema.users, eq(schema.users.id, schema.stepRemarks.authorId))
    .where(eq(schema.stepRemarks.documentId, id))
    .orderBy(desc(schema.stepRemarks.createdAt));

  // Могу ли я решать прямо сейчас: есть активный шаг ТЕКУЩЕЙ стадии, назначенный на меня
  // (в параллельной стадии активных несколько — важен свой).
  const myActive = steps.find((s) => s.status === 'active' && s.assigneeId === u.sub);
  const canDecide = !!myActive;
  return c.json({ route, steps, remarks, canDecide, activeStepId: myActive?.id ?? null });
});

// Решение по активному шагу: согласовать (можно с комментарием) или вернуть (замечание).
const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().max(5000).optional(),
});

documentRoutes.post('/:id/decision', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  const p = decisionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const [row] = await db.select({ id: doc.id, title: doc.title, status: doc.status, ownerId: doc.ownerId, authorId: doc.authorId, currentVersionId: doc.currentVersionId, registryNumber: doc.registryNumber, dueAt: doc.dueAt })
    .from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'on_approval') return c.json({ error: 'not_on_approval' }, 409);

  // Мой активный шаг (в параллельной стадии у каждого свой). Нет — не моя очередь.
  const step = await activeStepForUser(id, u.sub);
  if (!step) return c.json({ error: 'not_your_step' }, 403);

  if (p.data.decision === 'reject' && !p.data.comment?.trim()) {
    return c.json({ error: 'remark_required' }, 400);   // вернуть без причины нельзя
  }

  const meta: DocMeta = { workspaceId: w.id, documentId: id, docTitle: row.title, registryNumber: row.registryNumber, authorId: row.authorId, dueAt: row.dueAt };
  const res = await db.transaction(async (tx) => {
    if (p.data.decision === 'approve') {
      const { finished, nextAssignees } = await approveStep(tx, {
        workspaceId: w.id, documentId: id, routeId: step.routeId, stepId: step.stepId, stageNo: step.stageNo,
        currentVersionId: row.currentVersionId, actorId: u.sub, comment: p.data.comment ?? null,
      });
      // Мост: моя задача-шаг закрыта; маршрут пройден → закрыть трекинг; иначе открыть задачи новой стадии.
      await closeStepTask(tx, step.stepId);
      if (finished) await closeTrackingTask(tx, id);
      else if (nextAssignees.length) await openStepTasks(tx, meta);
      return { outcome: finished ? 'finished' as const : 'approved' as const, nextAssignees };
    }
    await rejectStep(tx, {
      workspaceId: w.id, documentId: id, routeId: step.routeId, stepId: step.stepId, stageNo: step.stageNo,
      currentVersionId: row.currentVersionId, actorId: u.sub, remark: p.data.comment!,
    });
    // Мост: моя задача-шаг закрыта (я вернул), остальные задачи-шаги этого круга снимаем; трекинг остаётся.
    await closeStepTask(tx, step.stepId);
    await cancelOpenStepTasks(tx, step.routeId);
    return { outcome: 'rework' as const, nextAssignees: [] as string[] };
  });

  // Уведомления вне транзакции. Согласование сдвинуло стадию → зовём следующих; инициатору — об исходе.
  const actorName = await actorDisplayName(u.sub);
  for (const aid of [...new Set(res.nextAssignees)]) notifyApprovalStep(id, row.title, aid, actorName, u.sub).catch(() => {});
  notifyApprovalDecision(id, row.title, row.authorId, actorName, res.outcome, u.sub).catch(() => {});
  return c.json({ ok: true, outcome: res.outcome });
});

// ── ONLYOFFICE: конфиг редактора, forcesave, история ─────────────────────────

/** Роль юзера в текущем маршруте документа: активный согласующий / уже решивший. */
async function approverRelation(documentId: string, userId: string): Promise<{ active: boolean; past: boolean }> {
  const rows = await db
    .select({ status: schema.routeSteps.status })
    .from(schema.routeSteps)
    .innerJoin(schema.routeInstances, eq(schema.routeInstances.id, schema.routeSteps.routeInstanceId))
    .where(and(
      eq(schema.routeInstances.documentId, documentId),
      eq(schema.routeInstances.status, 'running'),
      eq(schema.routeSteps.assigneeId, userId),
    ));
  return {
    active: rows.some((r) => r.status === 'active'),
    past: rows.some((r) => r.status === 'approved' || r.status === 'rejected'),
  };
}

// Конфиг для DocsAPI.DocEditor: подписанный JWT DS, права по статусу/роли, key версии.
documentRoutes.get('/:id/editor-config', async (c) => {
  if (!dsEnabled()) return c.json({ error: 'editor_disabled' }, 503);
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  const [row] = await db.select({
    id: doc.id, title: doc.title, status: doc.status, authorId: doc.authorId, ownerId: doc.ownerId,
    currentVersionId: doc.currentVersionId, registryNumber: doc.registryNumber,
  }).from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!row.currentVersionId) return c.json({ error: 'no_version' }, 409);   // редактировать нечего

  const [v] = await db.select({
    id: ver.id, versionNo: ver.versionNo, fileName: ver.fileName, fileHash: ver.fileHash, dsKey: ver.dsKey,
  }).from(ver).where(eq(ver.id, row.currentVersionId)).limit(1);
  if (!v) return c.json({ error: 'no_version' }, 409);

  const dt = docType(v.fileName);
  if (!dt) return c.json({ error: 'not_editable' }, 400);   // не офисный формат — редактора нет

  const rel = await approverRelation(id, u.sub);
  const access = resolveAccess({
    status: row.status,
    isAuthor: c.get('docPerms').canManage || row.authorId === u.sub || row.ownerId === u.sub,
    activeApprover: rel.active,
    pastApprover: rel.past,
  });
  const userName = await actorDisplayName(u.sub);
  const key = v.dsKey || `d${id.replace(/-/g, '').slice(0, 12)}_v${v.versionNo}_${v.fileHash.slice(0, 16)}`;
  const fileToken = await signFileToken(id, v.id);
  const cbToken = await signCallbackToken(id);

  const config = {
    documentType: dt.documentType,
    document: {
      fileType: dt.fileType,
      key,
      title: `${row.registryNumber ? row.registryNumber + ' ' : ''}${v.fileName}`,
      url: `${env.BACKEND_INTERNAL_URL}/api/ds/file/${fileToken}`,
      permissions: {
        edit: access.edit,
        review: access.review,
        comment: access.comment,
        download: true,
        print: true,
        copy: true,
      },
    },
    editorConfig: {
      mode: access.mode,
      callbackUrl: `${env.BACKEND_INTERNAL_URL}/api/ds/callback/${cbToken}`,
      lang: 'ru',
      user: { id: u.sub, name: userName },
      customization: {
        forcesave: true,
        autosave: true,
        comments: true,
        review: { trackChanges: access.trackChanges, reviewDisplay: 'markup', hoverMode: false },
      },
    },
  };
  // JWT всего конфига — DS проверяет подпись (JWT_ENABLED).
  const token = await signDs(config as unknown as Record<string, unknown>);
  return c.json({
    config: { ...config, token },
    apiUrl: `${env.DS_PUBLIC_URL}/web-apps/apps/api/documents/api.js`,
    editable: access.mode === 'edit',
  });
});

// Принудительное сохранение перед «отправить дальше»: снимает текущее состояние из DS,
// не дожидаясь, пока закроют вкладку. Вызовет callback status:6 → там родится версия.
documentRoutes.post('/:id/forcesave', async (c) => {
  if (!dsEnabled()) return c.json({ error: 'editor_disabled' }, 503);
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  const [row] = await db.select({ currentVersionId: doc.currentVersionId }).from(doc)
    .where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row?.currentVersionId) return c.json({ error: 'no_version' }, 409);
  const [v] = await db.select({ versionNo: ver.versionNo, fileHash: ver.fileHash, dsKey: ver.dsKey })
    .from(ver).where(eq(ver.id, row.currentVersionId)).limit(1);
  if (!v) return c.json({ error: 'no_version' }, 409);
  const key = v.dsKey || `d${id.replace(/-/g, '').slice(0, 12)}_v${v.versionNo}_${v.fileHash.slice(0, 16)}`;
  const r = await commandForcesave(key);
  // error:4 = «нечего сохранять, изменений нет» — это не ошибка для нас.
  return c.json({ ok: r.error === 0 || r.error === 4, dsError: r.error });
});

// История версий для нативной панели DS (подсветка правок между версиями, ТЗ §4.6).
documentRoutes.get('/:id/history', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);

  const versions = await db.select({
    versionNo: ver.versionNo, dsKey: ver.dsKey, fileHash: ver.fileHash, createdAt: ver.createdAt,
    changesHistory: ver.changesHistory, dsServerVersion: ver.dsServerVersion, authorId: ver.authorId,
    authorName: schema.users.displayName,
  }).from(ver).leftJoin(schema.users, eq(schema.users.id, ver.authorId))
    .where(eq(ver.documentId, id)).orderBy(ver.versionNo);
  if (versions.length === 0) return c.json({ currentVersion: 0, history: [] });

  const history = versions.map((v) => ({
    version: v.versionNo,
    key: v.dsKey || `d${id.replace(/-/g, '').slice(0, 12)}_v${v.versionNo}_${v.fileHash.slice(0, 16)}`,
    created: v.createdAt.toISOString(),
    user: { id: v.authorId, name: v.authorName ?? '—' },
    changes: (v.changesHistory as { changes?: unknown[] } | null)?.changes ?? undefined,
    serverVersion: v.dsServerVersion ?? undefined,
  }));
  return c.json({ currentVersion: versions[versions.length - 1]!.versionNo, history });
});

// Данные одной версии для истории DS: url файла и changesUrl (оба — подписанные ссылки в DS).
documentRoutes.get('/:id/history/:versionNo', async (c) => {
  if (!dsEnabled()) return c.json({ error: 'editor_disabled' }, 503);
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  const versionNo = Number(c.req.param('versionNo'));
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);
  if (!Number.isInteger(versionNo)) return c.json({ error: 'bad_request' }, 400);

  const rows = await db.select({
    id: ver.id, versionNo: ver.versionNo, fileHash: ver.fileHash, dsKey: ver.dsKey, changesObjectKey: ver.changesObjectKey,
  }).from(ver).where(eq(ver.documentId, id)).orderBy(ver.versionNo);
  const cur = rows.find((r) => r.versionNo === versionNo);
  if (!cur) return c.json({ error: 'not_found' }, 404);
  const prev = rows.filter((r) => r.versionNo < versionNo).at(-1);

  const key = (r: { versionNo: number; fileHash: string; dsKey: string | null }) =>
    r.dsKey || `d${id.replace(/-/g, '').slice(0, 12)}_v${r.versionNo}_${r.fileHash.slice(0, 16)}`;
  const out: Record<string, unknown> = {
    version: versionNo,
    key: key(cur),
    url: `${env.BACKEND_INTERNAL_URL}/api/ds/file/${await signFileToken(id, cur.id)}`,
  };
  if (cur.changesObjectKey) {
    out.changesUrl = `${env.BACKEND_INTERNAL_URL}/api/ds/changes/${await signFileToken(id, cur.id)}`;
    if (prev) out.previous = { key: key(prev), url: `${env.BACKEND_INTERNAL_URL}/api/ds/file/${await signFileToken(id, prev.id)}` };
  }
  out.token = await signDs(out as Record<string, unknown>);
  return c.json(out);
});

// ── Журнал ───────────────────────────────────────────────────────────────────
documentRoutes.get('/:id/activity', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, c.get('docPerms').canViewAll, id))) return c.json({ error: 'forbidden' }, 403);
  const rows = await db
    .select({
      id: schema.documentActivity.id, entity: schema.documentActivity.entity,
      action: schema.documentActivity.action, payload: schema.documentActivity.payload,
      at: schema.documentActivity.at, actorName: schema.users.displayName,
    })
    .from(schema.documentActivity)
    .leftJoin(schema.users, eq(schema.users.id, schema.documentActivity.actorId))
    .where(eq(schema.documentActivity.documentId, id))
    .orderBy(desc(schema.documentActivity.at));
  return c.json(rows);
});
