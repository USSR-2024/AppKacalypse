import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { mkdir, readFile, rm, rename, readdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import type { Context, Next } from 'hono';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { env } from '../lib/env.js';

const tr = schema.transcriptions;

const dir = (id: string) => join(env.TRANSCRIBE_DATA_DIR, id);

// Незавершённые загрузки. Лежат на том же томе, что и data — иначе rename()
// в конце загрузки станет копированием через границу ФС.
const TMP = join(env.TRANSCRIBE_DATA_DIR, '.tmp');
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** Убрать обрывки: если соединение упало или бэк перезапустился на середине
 *  загрузки, .tmp-файл остаётся навсегда. Гигабайтные, копятся молча. */
async function sweepStaleUploads() {
  const now = Date.now();
  for (const name of await readdir(TMP).catch(() => [] as string[])) {
    const p = join(TMP, name);
    const s = await stat(p).catch(() => null);
    if (s && now - s.mtimeMs > STALE_UPLOAD_MS) await rm(p, { force: true }).catch(() => {});
  }
}

// Расшифровки доступны только владельцу пространства.
async function requireWsOwner(c: Context, next: Next) {
  if (c.get('workspace').role !== 'owner') return c.json({ error: 'forbidden' }, 403);
  return next();
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/transcriptions — пользовательские эндпоинты (owner воркспейса)
// ─────────────────────────────────────────────────────────────────────────────
export const transcriptionRoutes = new Hono();
transcriptionRoutes.use('*', requireAuth, requireWorkspace, requireWsOwner);

// Список расшифровок пространства (для экрана + поллинга статусов).
transcriptionRoutes.get('/', async (c) => {
  const w = c.get('workspace');
  const rows = await db
    .select({
      id: tr.id, filename: tr.filename, lang: tr.lang, status: tr.status,
      protocolStatus: tr.protocolStatus, error: tr.error, createdAt: tr.createdAt,
    })
    .from(tr)
    .where(eq(tr.workspaceId, w.id))
    .orderBy(desc(tr.createdAt));
  return c.json(rows);
});

// Загрузить аудио/видео. Тело — СЫРОЙ поток файла, не multipart: пишем его на
// диск чанками, память не зависит от размера. Через parseBody() файл целиком
// оседал в RAM (2.6 ГБ → ~5 ГБ пика и 500 через 4 минуты). Имя и язык — в query.
//
// Задачу в БД создаём ПОСЛЕ того, как файл лёг на диск: строка сразу видна
// воркеру как queued, и он заклеймил бы её, пока файл ещё льётся.
transcriptionRoutes.put('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const q = z.object({
    filename: z.string().trim().min(1).max(200),
    lang: z.enum(['auto', 'ru', 'es']).catch('auto'),
  }).safeParse({ filename: c.req.query('filename'), lang: c.req.query('lang') });
  if (!q.success) return c.json({ error: 'bad_request' }, 400);

  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'file_required' }, 400);

  await sweepStaleUploads();
  await mkdir(TMP, { recursive: true });
  const ext = (extname(q.data.filename) || '.m4a').toLowerCase();
  const tmp = join(TMP, randomUUID() + ext);

  try {
    await pipeline(Readable.fromWeb(body as NodeReadableStream), createWriteStream(tmp));
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
    return c.json({ error: 'upload_failed' }, 500);   // связь оборвалась на середине
  }

  const size = (await stat(tmp).catch(() => null))?.size ?? 0;
  if (size === 0) {
    await rm(tmp, { force: true }).catch(() => {});
    return c.json({ error: 'file_required' }, 400);
  }

  const [row] = await db.insert(tr)
    .values({ workspaceId: w.id, userId: u.sub, filename: q.data.filename, lang: q.data.lang })
    .returning({ id: tr.id });
  try {
    await mkdir(dir(row!.id), { recursive: true });
    await rename(tmp, join(dir(row!.id), 'audio' + ext));
  } catch {
    // Файл не доехал до места — строка без аудио навсегда осталась бы queued.
    await db.delete(tr).where(eq(tr.id, row!.id));
    await rm(tmp, { force: true }).catch(() => {});
    await rm(dir(row!.id), { recursive: true, force: true }).catch(() => {});
    return c.json({ error: 'upload_failed' }, 500);
  }

  return c.json({ id: row!.id }, 201);
});

// Запросить составление протокола (только когда транскрипт готов).
transcriptionRoutes.post('/:id/protocol', async (c) => {
  const w = c.get('workspace');
  const id = c.req.param('id')!;
  const [row] = await db.select({ status: tr.status }).from(tr)
    .where(and(eq(tr.id, id), eq(tr.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'transcribed') return c.json({ error: 'not_ready' }, 409);
  await db.update(tr).set({ protocolStatus: 'queued', error: null, updatedAt: new Date() })
    .where(eq(tr.id, id));
  return c.json({ ok: true });
});

// Скачать транскрипт (.txt), протокол (.md) или протокол в PDF.
const DL = {
  transcript: { file: 'transcript.txt', ext: '.txt', type: 'text/plain; charset=utf-8' },
  protocol: { file: 'protocol.md', ext: '.protocol.md', type: 'text/markdown; charset=utf-8' },
  pdf: { file: 'protocol.pdf', ext: '.protocol.pdf', type: 'application/pdf' },
} as const;

async function download(c: Context, kind: keyof typeof DL) {
  const w = c.get('workspace');
  const id = c.req.param('id')!;
  const [row] = await db.select({ filename: tr.filename }).from(tr)
    .where(and(eq(tr.id, id), eq(tr.workspaceId, w.id))).limit(1);
  if (!row) return c.json({ error: 'not_found' }, 404);
  let data: Buffer;
  try {
    data = await readFile(join(dir(id), DL[kind].file));
  } catch {
    return c.json({ error: 'not_ready' }, 404);
  }
  const base = row.filename.replace(/\.[^.]+$/, '') || 'meeting';
  c.header('Content-Type', DL[kind].type);
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + DL[kind].ext)}`);
  return c.body(new Uint8Array(data));
}
transcriptionRoutes.get('/:id/transcript', (c) => download(c, 'transcript'));
transcriptionRoutes.get('/:id/protocol/file', (c) => download(c, 'protocol'));
transcriptionRoutes.get('/:id/protocol/pdf', (c) => download(c, 'pdf'));

// Удалить расшифровку (запись + файлы).
transcriptionRoutes.delete('/:id', async (c) => {
  const w = c.get('workspace');
  const [row] = await db.delete(tr)
    .where(and(eq(tr.id, c.req.param('id')!), eq(tr.workspaceId, w.id)))
    .returning({ id: tr.id });
  if (!row) return c.json({ error: 'not_found' }, 404);
  await rm(dir(row.id), { recursive: true, force: true }).catch(() => {});
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/transcribe-worker — эндпоинты хостового воркера (akc-transcribe-worker).
// Не JWT: общий секрет WORKER_TOKEN в заголовке X-Worker-Token. Воркер видит
// бэкенд по 127.0.0.1:8081, наружу этот путь недоступен (только через Caddy+JWT нет).
// ─────────────────────────────────────────────────────────────────────────────
export const transcribeWorkerRoutes = new Hono();
transcribeWorkerRoutes.use('*', async (c, next) => {
  if (!env.WORKER_TOKEN || c.req.header('X-Worker-Token') !== env.WORKER_TOKEN) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
});

// Забрать следующую задачу. Сначала транскрибация, затем протоколы. SKIP LOCKED —
// на случай нескольких воркеров. Возвращает {id, kind, lang} или 204.
transcribeWorkerRoutes.post('/claim', async (c) => {
  const job = await db.transaction(async (tx) => {
    const [t] = await tx.select({ id: tr.id, lang: tr.lang }).from(tr)
      .where(eq(tr.status, 'queued')).orderBy(tr.createdAt).limit(1).for('update', { skipLocked: true });
    if (t) {
      await tx.update(tr).set({ status: 'transcribing', updatedAt: new Date() }).where(eq(tr.id, t.id));
      return { id: t.id, kind: 'transcribe' as const, lang: t.lang };
    }
    const [p] = await tx.select({ id: tr.id, lang: tr.lang }).from(tr)
      .where(and(eq(tr.status, 'transcribed'), eq(tr.protocolStatus, 'queued')))
      .orderBy(tr.updatedAt).limit(1).for('update', { skipLocked: true });
    if (p) {
      await tx.update(tr).set({ protocolStatus: 'running', updatedAt: new Date() }).where(eq(tr.id, p.id));
      return { id: p.id, kind: 'protocol' as const, lang: p.lang };
    }
    return null;
  });
  if (!job) return c.body(null, 204);
  return c.json(job);
});

// Отчёт о завершении этапа. Файлы воркер уже записал на общий том.
transcribeWorkerRoutes.post('/:id/result', async (c) => {
  const p = z.object({
    kind: z.enum(['transcribe', 'protocol']),
    ok: z.boolean(),
    error: z.string().max(2000).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);
  const { kind, ok, error } = p.data;

  const id = c.req.param('id')!;
  if (kind === 'transcribe') {
    await db.update(tr).set({ status: ok ? 'transcribed' : 'failed', error: ok ? null : (error ?? 'ошибка'), updatedAt: new Date() })
      .where(eq(tr.id, id));
  } else {
    await db.update(tr).set({ protocolStatus: ok ? 'ready' : 'failed', error: ok ? null : (error ?? 'ошибка'), updatedAt: new Date() })
      .where(eq(tr.id, id));
  }
  return c.json({ ok: true });
});
