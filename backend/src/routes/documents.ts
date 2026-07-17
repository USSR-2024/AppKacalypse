import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { nextRegistryNumber, visibilityCond, canView, isDocsAdmin, logDoc, versionKey, dsKey } from '../lib/dms.js';
import { putVersion, getVersionStream } from '../lib/dms-storage.js';

// /api/documents — карточки документов, версии, переход на согласование.
// Модуль «Документы»: спека docs/ТЗ-документооборот.md, порядок docs/ПЛАН-документооборот.md.

const doc = schema.documents;
const ver = schema.documentVersions;

export const documentRoutes = new Hono();
documentRoutes.use('*', requireAuth, requireWorkspace);

const MAX_FILE = 100 * 1024 * 1024;   // 100 МБ — договор столько не весит; защита от заливки видео

// ── Список ───────────────────────────────────────────────────────────────────
// Базовый (полный реестр с фасетами — фаза 6).
documentRoutes.get('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const conds = [eq(doc.workspaceId, w.id)];
  const vis = visibilityCond(u, w.role);
  if (vis) conds.push(vis);

  const status = z.enum(['draft', 'on_approval', 'rework', 'approved', 'on_signing', 'signed', 'active', 'expired', 'terminated', 'archived', 'cancelled'])
    .optional().safeParse(c.req.query('status'));
  if (status.success && status.data) conds.push(eq(doc.status, status.data));

  const rows = await db
    .select({
      id: doc.id, registryNumber: doc.registryNumber, title: doc.title, status: doc.status,
      priority: doc.priority, dueAt: doc.dueAt, counterpartyName: doc.counterpartyName,
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
      dueAt: doc.dueAt, typeId: doc.typeId, groupId: doc.groupId, counterpartyName: doc.counterpartyName,
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
  if (!(await canView(u, w.role, id))) return c.json({ error: 'forbidden' }, 403);

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
  const canEdit = row.status === 'draft' && (isDocsAdmin(w.role) || row.ownerId === u.sub || row.authorId === u.sub);
  return c.json({ ...row, versions, canEdit, canManage: isDocsAdmin(w.role) });
});

// ── Создание ─────────────────────────────────────────────────────────────────
const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  typeId: z.string().uuid(),
  description: z.string().max(10000).optional(),
  counterpartyName: z.string().max(500).optional(),
  priority: z.enum(['critical', 'urgent', 'important', 'low']).optional(),
  priorityReason: z.string().max(1000).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  amount: z.number().optional(),
  currency: z.string().length(3).optional(),
});

documentRoutes.post('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
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

  const row = await db.transaction(async (tx) => {
    const [d] = await tx.insert(doc).values({
      workspaceId: w.id,
      title: p.data.title,
      description: p.data.description ?? null,
      typeId: type.id,
      groupId: type.groupId,          // группа наследуется от типа
      authorId: u.sub,
      ownerId: u.sub,                 // ответственный по умолчанию — инициатор
      counterpartyName: p.data.counterpartyName ?? null,
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
  if (!isDocsAdmin(w.role) && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  // Ушедшую на согласование карточку не правим: у согласующих на руках её содержимое.
  if (row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);

  const d = p.data;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.description !== undefined) patch.description = d.description;
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
  if (!isDocsAdmin(w.role) && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
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

// Скачать версию. Файлы отдаёт только бэкенд, проверив права: бакет не публичный.
documentRoutes.get('/:id/versions/:versionId/file', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, w.role, id))) return c.json({ error: 'forbidden' }, 403);

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

// ── Переход на согласование ──────────────────────────────────────────────────
// Здесь карточка получает реестровый номер — ОДИН РАЗ и навсегда.
// Сборку маршрута из матрицы подключит фаза 3; сейчас переход только меняет статус.
documentRoutes.post('/:id/submit', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;

  const [row] = await db.select().from(doc).where(and(eq(doc.id, id), eq(doc.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!isDocsAdmin(w.role) && row.ownerId !== u.sub && row.authorId !== u.sub) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'draft') return c.json({ error: 'not_draft' }, 409);
  if (!row.currentVersionId) return c.json({ error: 'no_version' }, 409);   // согласовывать нечего

  const [type] = await db.select({
    id: schema.docTypes.id, code: schema.docTypes.code, registryMask: schema.docTypes.registryMask,
    requiresNote: schema.docTypes.requiresNote,
  }).from(schema.docTypes).where(eq(schema.docTypes.id, row.typeId)).limit(1);
  if (!type) return c.json({ error: 'bad_type' }, 400);

  // Записка обязательна по флагу типа — без неё маршрут не запускается.
  if (type.requiresNote) {
    const [note] = await db.select({ id: schema.explanatoryNotes.id })
      .from(schema.explanatoryNotes).where(eq(schema.explanatoryNotes.documentId, id)).limit(1);
    if (!note) return c.json({ error: 'note_required' }, 409);
  }

  const [group] = row.groupId
    ? await db.select({ code: schema.docGroups.code }).from(schema.docGroups).where(eq(schema.docGroups.id, row.groupId)).limit(1)
    : [{ code: '' }];

  const result = await db.transaction(async (tx) => {
    // Номер присваивается один раз: если он уже есть (вернули на корректировку и
    // отправили снова) — не перевыпускаем.
    const number = row.registryNumber ?? await nextRegistryNumber(tx, w.id, type, group?.code ?? '');
    await tx.update(doc).set({ registryNumber: number, status: 'on_approval', updatedAt: new Date() }).where(eq(doc.id, id));
    await logDoc(tx, {
      workspaceId: w.id, documentId: id, entity: 'document', entityId: id, actorId: u.sub,
      action: 'status_changed', payload: { from: 'draft', to: 'on_approval', registryNumber: number },
    });
    return { registryNumber: number };
  });
  return c.json({ ok: true, ...result, status: 'on_approval' });
});

// ── Журнал ───────────────────────────────────────────────────────────────────
documentRoutes.get('/:id/activity', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const id = c.req.param('id')!;
  if (!(await canView(u, w.role, id))) return c.json({ error: 'forbidden' }, 403);
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
