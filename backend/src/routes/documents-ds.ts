import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../lib/env.js';
import { verifyDs, type FileToken, type CbToken } from '../lib/ds.js';
import { logDoc, versionKey, dsKey } from '../lib/dms.js';
import { putVersion, getVersionBuffer } from '../lib/dms-storage.js';

// DS-фейсинг эндпоинты — их дёргает САМ Document Server, БЕЗ сессии трекера.
// Авторизация только по подписанному токену (в URL) + JWT самого DS в колбэке.
// Монтируется в index.ts БЕЗ requireAuth. Спека: ТЗ §4.5, §4.7.

const ver = schema.documentVersions;
const doc = schema.documents;

export const dsRoutes = new Hono();

/** DS присылает cache-URL со своим хостом; тянем ВСЕГДА с внутреннего адреса DS (надёжнее в docker-сети). */
async function fetchFromDs(url: string): Promise<Buffer> {
  const u = new URL(url);
  const internal = new URL(env.DS_INTERNAL_URL);
  u.protocol = internal.protocol;
  u.host = internal.host;
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`ds fetch ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── Отдача файла версии в DS (ТЗ §4.7) ───────────────────────────────────────
dsRoutes.get('/file/:token', async (c) => {
  let t: FileToken;
  try { t = await verifyDs<FileToken>(c.req.param('token')); } catch { return c.json({ error: 'bad_token' }, 401); }
  if (t.p !== 'ds-file') return c.json({ error: 'bad_token' }, 401);

  const [v] = await db.select({ objectKey: ver.objectKey, mime: ver.mimeType })
    .from(ver).where(and(eq(ver.id, t.versionId), eq(ver.documentId, t.documentId))).limit(1);
  if (!v) return c.json({ error: 'not_found' }, 404);

  const { body } = await getVersionBuffer(v.objectKey);
  c.header('Content-Type', v.mime);
  c.header('Content-Length', String(body.length));   // DS плохо переваривает chunked без длины
  return c.body(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
});

// ── Отдача changes.zip версии в DS (для подсветки правок в истории) ───────────
dsRoutes.get('/changes/:token', async (c) => {
  let t: FileToken;
  try { t = await verifyDs<FileToken>(c.req.param('token')); } catch { return c.json({ error: 'bad_token' }, 401); }
  if (t.p !== 'ds-file') return c.json({ error: 'bad_token' }, 401);

  const [v] = await db.select({ key: ver.changesObjectKey })
    .from(ver).where(and(eq(ver.id, t.versionId), eq(ver.documentId, t.documentId))).limit(1);
  if (!v?.key) return c.json({ error: 'not_found' }, 404);
  const { body } = await getVersionBuffer(v.key);
  c.header('Content-Type', 'application/zip');
  c.header('Content-Length', String(body.length));
  return c.body(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
});

// ── Callback сохранения версии (ТЗ §4.5) ─────────────────────────────────────
// Тело DS подписано его JWT (JWT_IN_BODY=true) — берём данные ТОЛЬКО из проверенного payload.
interface DsCallbackBody {
  status: number;
  url?: string;
  changesurl?: string;
  history?: { serverVersion?: string; changes?: unknown[] };
  users?: string[];
  actions?: { type: number; userid: string }[];
  key?: string;
}

dsRoutes.post('/callback/:token', async (c) => {
  // 1) Наш токен колбэка → documentId.
  let ct: CbToken;
  try { ct = await verifyDs<CbToken>(c.req.param('token')); } catch { return c.json({ error: 1 }); }
  if (ct.p !== 'ds-cb') return c.json({ error: 1 });
  const documentId = ct.documentId;

  const raw = (await c.req.json().catch(() => ({}))) as DsCallbackBody & { token?: string };

  // 2) JWT самого DS: доверяем ТОЛЬКО проверенному телу (иначе кто угодно подменит документ).
  let body: DsCallbackBody;
  try {
    body = raw.token ? await verifyDs<DsCallbackBody>(raw.token) : (() => { throw new Error('no token'); })();
  } catch {
    return c.json({ error: 1 });   // без валидного JWT DS — не обрабатываем
  }

  // 3) Только «готов к сохранению» (2) и forcesave (6) несут новый файл.
  if (body.status !== 2 && body.status !== 6) return c.json({ error: 0 });

  try {
    if (!body.url) return c.json({ error: 0 });
    const file = await fetchFromDs(body.url);
    const hash = (await import('node:crypto')).createHash('sha256').update(file).digest('hex');

    const [d] = await db.select({ id: doc.id, workspaceId: doc.workspaceId, ownerId: doc.ownerId, currentVersionId: doc.currentVersionId })
      .from(doc).where(eq(doc.id, documentId)).limit(1);
    if (!d) return c.json({ error: 0 });

    // Идемпотентность: тот же файл (DS шлёт дубли) → новую версию НЕ плодим.
    if (d.currentVersionId) {
      const [curV] = await db.select({ hash: ver.fileHash, name: ver.fileName, mime: ver.mimeType }).from(ver).where(eq(ver.id, d.currentVersionId)).limit(1);
      if (curV?.hash === hash) return c.json({ error: 0 });
    }
    const [tmpl] = d.currentVersionId
      ? await db.select({ name: ver.fileName, mime: ver.mimeType }).from(ver).where(eq(ver.id, d.currentVersionId)).limit(1)
      : [{ name: 'document.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }];

    // Автор правки = юзер, которого DS вернул в actions/users (мы клали туда наш users.id).
    const editorId = body.actions?.[0]?.userid || body.users?.[0] || d.ownerId;
    const [validUser] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, editorId)).limit(1);
    const authorId = validUser?.id ?? d.ownerId;

    const changes = body.changesurl ? await fetchFromDs(body.changesurl).catch(() => null) : null;
    const ext = (tmpl!.name.match(/\.[^.]+$/)?.[0]) || '.docx';

    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM documents WHERE id = ${documentId} FOR UPDATE`);
      const [last] = await tx.select({ n: ver.versionNo }).from(ver).where(eq(ver.documentId, documentId)).orderBy(desc(ver.versionNo)).limit(1);
      const versionNo = (last?.n ?? 0) + 1;
      const key = versionKey(documentId, versionNo, ext);
      await putVersion(key, file, tmpl!.mime);

      let changesKey: string | null = null;
      if (changes) { changesKey = `documents/${documentId}/v${versionNo}.changes.zip`; await putVersion(changesKey, changes, 'application/zip'); }

      const [v] = await tx.insert(ver).values({
        documentId, versionNo, objectKey: key, fileName: tmpl!.name, fileSize: file.length,
        fileHash: hash, mimeType: tmpl!.mime, authorId, comment: 'Правка в редакторе',
        dsKey: dsKey(documentId, versionNo, hash),
        changesObjectKey: changesKey,
        changesHistory: body.history ?? null,
        dsServerVersion: body.history?.serverVersion ?? null,
      }).returning({ id: ver.id });
      await tx.update(doc).set({ currentVersionId: v!.id, updatedAt: new Date() }).where(eq(doc.id, documentId));
      await logDoc(tx, {
        workspaceId: d.workspaceId, documentId, entity: 'version', entityId: v!.id,
        actorId: authorId, action: 'version_saved', payload: { versionNo, via: 'editor', hash },
      });
    });
    return c.json({ error: 0 });
  } catch (e) {
    console.error('ds callback failed', e);
    return c.json({ error: 1 });   // не удалось сохранить → DS повторит, файл ещё в кэше
  }
});
