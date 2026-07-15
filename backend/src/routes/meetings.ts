import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { SignJWT, jwtVerify } from 'jose';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth-middleware.js';
import { requireWorkspace } from '../lib/workspace-middleware.js';
import { env } from '../lib/env.js';
import { livekitToken } from '../lib/livekit.js';
import { EgressStatus } from 'livekit-server-sdk';
import { startRecording, stopRecording, receiveWebhook, getRecordingStream } from '../lib/recording.js';

const mt = schema.meetings;
const inviteSecret = () => new TextEncoder().encode(env.JWT_SECRET);

// ─────────────────────────────────────────────────────────────────────────────
// /api/meetings — управление встречами (члены воркспейса)
// ─────────────────────────────────────────────────────────────────────────────
export const meetingRoutes = new Hono();
meetingRoutes.use('*', requireAuth, requireWorkspace);

// Список встреч воркспейса.
meetingRoutes.get('/', async (c) => {
  const w = c.get('workspace');
  const rows = await db
    .select({
      id: mt.id, title: mt.title, status: mt.status, captions: mt.captions,
      recordingStatus: mt.recordingStatus, recordingKey: mt.recordingKey,
      transcriptionId: mt.transcriptionId,
      createdAt: mt.createdAt, endedAt: mt.endedAt,
    })
    .from(mt)
    .where(eq(mt.workspaceId, w.id))
    .orderBy(desc(mt.createdAt));
  return c.json(rows);
});

// Детали одной встречи (для карточки + поллинга статуса записи/расшифровки).
meetingRoutes.get('/:id', async (c) => {
  const w = c.get('workspace');
  const [m] = await db.select({
    id: mt.id, title: mt.title, status: mt.status, captions: mt.captions,
    recordingStatus: mt.recordingStatus, recordingKey: mt.recordingKey,
    transcriptionId: mt.transcriptionId, createdAt: mt.createdAt, endedAt: mt.endedAt,
  }).from(mt).where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...m, canManage: w.role === 'owner' || w.role === 'admin' });
});

// Создать встречу. Возвращает id + имя комнаты LiveKit.
meetingRoutes.post('/', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const title = z.string().trim().min(1).max(200).catch('Встреча').parse(body?.title);
  const captions = z.boolean().catch(false).parse(body?.captions);  // субтитры по умолчанию ВЫКЛ (юзер включает сам)

  const roomName = `ws_${w.id.slice(0, 8)}_${randomUUID().slice(0, 8)}`;
  const [row] = await db.insert(mt)
    .values({ workspaceId: w.id, createdBy: u.sub, title, roomName, captions })
    .returning({ id: mt.id, roomName: mt.roomName });
  return c.json(row, 201);
});

// Токен на вход для члена воркспейса. identity = userId, язык из профиля → metadata.
meetingRoutes.post('/:id/token', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.status !== 'active') return c.json({ error: 'ended' }, 409);

  const [usr] = await db.select({ name: schema.users.displayName, lang: schema.users.lang })
    .from(schema.users).where(eq(schema.users.id, u.sub)).limit(1);

  const token = await livekitToken({
    room: m.roomName,
    identity: u.sub,
    name: usr?.name ?? 'Участник',
    metadata: JSON.stringify({ lang: usr?.lang ?? 'ru', role: w.role }),
  });
  return c.json({
    url: env.LIVEKIT_WS_URL, token, room: m.roomName, title: m.title, captions: m.captions,
    recordingStatus: m.recordingStatus, canRecord: w.role === 'owner' || w.role === 'admin',
  });
});

// Инвайт-ссылка для внешних. Подписанный short-lived JWT, без аккаунта. owner/admin.
meetingRoutes.post('/:id/invite', async (c) => {
  const w = c.get('workspace');
  if (w.role !== 'owner' && w.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.status !== 'active') return c.json({ error: 'ended' }, 409);

  const ttl = 60 * 60 * 24; // ссылка живёт 24 часа
  const now = Math.floor(Date.now() / 1000);
  const invite = await new SignJWT({ mid: m.id, kind: 'meet-invite' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(inviteSecret());
  return c.json({ url: `${env.PUBLIC_APP_URL}/join/${invite}`, expiresIn: ttl });
});

// Вкл/выкл субтитры для встречи (управляет тем, зайдёт ли caption-agent в комнату).
meetingRoutes.patch('/:id/captions', async (c) => {
  const w = c.get('workspace');
  const body = await c.req.json().catch(() => ({}));
  const enabled = z.boolean().catch(true).parse(body?.enabled);
  const [row] = await db.update(mt).set({ captions: enabled })
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id)))
    .returning({ id: mt.id });
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, captions: enabled });
});

// Начать запись встречи (egress RoomComposite → mp4 в MinIO). owner/admin.
meetingRoutes.post('/:id/recording/start', async (c) => {
  const w = c.get('workspace');
  if (w.role !== 'owner' && w.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.status !== 'active') return c.json({ error: 'ended' }, 409);
  if (m.recordingStatus === 'active' || m.recordingStatus === 'processing') {
    return c.json({ error: 'already_recording' }, 409);
  }
  try {
    const { egressId, key } = await startRecording(m.roomName, Date.now());
    await db.update(mt)
      .set({ recordingStatus: 'active', egressId, recordingKey: key })
      .where(eq(mt.id, m.id));
    return c.json({ ok: true, recordingStatus: 'active' });
  } catch (e) {
    console.error('recording start failed', e);
    return c.json({ error: 'egress_failed' }, 502);
  }
});

// Остановить запись. egress завершится и пришлёт вебхук с финальным статусом. owner/admin.
meetingRoutes.post('/:id/recording/stop', async (c) => {
  const w = c.get('workspace');
  if (w.role !== 'owner' && w.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.recordingStatus !== 'active' || !m.egressId) return c.json({ error: 'not_recording' }, 409);
  await stopRecording(m.egressId);
  await db.update(mt).set({ recordingStatus: 'processing' }).where(eq(mt.id, m.id));
  return c.json({ ok: true, recordingStatus: 'processing' });
});

// Скачать запись (mp4) — стрим из MinIO. Доступно членам воркспейса.
meetingRoutes.get('/:id/recording', async (c) => {
  const w = c.get('workspace');
  const [m] = await db.select({ recordingStatus: mt.recordingStatus, recordingKey: mt.recordingKey, title: mt.title })
    .from(mt).where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.recordingStatus !== 'ready' || !m.recordingKey) return c.json({ error: 'not_ready' }, 404);
  let node: Readable;
  try {
    node = await getRecordingStream(m.recordingKey);
  } catch {
    return c.json({ error: 'unavailable' }, 502);
  }
  const base = (m.title || 'meeting').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'meeting';
  c.header('Content-Type', 'video/mp4');
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '.mp4')}`);
  return c.body(Readable.toWeb(node) as ReadableStream);
});

// Переименовать встречу. owner/admin.
meetingRoutes.patch('/:id', async (c) => {
  const w = c.get('workspace');
  if (w.role !== 'owner' && w.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const title = z.string().trim().min(1).max(200).safeParse(body?.title);
  if (!title.success) return c.json({ error: 'bad_title' }, 400);
  const [row] = await db.update(mt).set({ title: title.data })
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id)))
    .returning({ id: mt.id, title: mt.title });
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, title: row.title });
});

// Отправить запись в расшифровку: mp4 из MinIO → общий том → очередь transcriptions. owner/admin.
meetingRoutes.post('/:id/transcribe', async (c) => {
  const w = c.get('workspace');
  const u = c.get('user');
  if (w.role !== 'owner' && w.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.recordingStatus !== 'ready' || !m.recordingKey) return c.json({ error: 'no_recording' }, 409);
  if (m.transcriptionId) return c.json({ error: 'already_transcribed', transcriptionId: m.transcriptionId }, 409);

  // Вставляем в неклеймируемом статусе 'transcribing', заливаем файл, лишь потом → 'queued'
  // (иначе воркер заклеймит задачу до появления audio.mp4 на томе).
  const [tRow] = await db.insert(schema.transcriptions)
    .values({ workspaceId: w.id, userId: u.sub, filename: `${m.title || 'meeting'}.mp4`, lang: 'auto', status: 'transcribing' })
    .returning({ id: schema.transcriptions.id });
  const tid = tRow!.id;
  try {
    const d = join(env.TRANSCRIBE_DATA_DIR, tid);
    await mkdir(d, { recursive: true });
    const node = await getRecordingStream(m.recordingKey);
    await pipeline(node, createWriteStream(join(d, 'audio.mp4')));
    await db.update(schema.transcriptions).set({ status: 'queued', updatedAt: new Date() })
      .where(eq(schema.transcriptions.id, tid));
    await db.update(mt).set({ transcriptionId: tid }).where(eq(mt.id, m.id));
    return c.json({ ok: true, transcriptionId: tid }, 201);
  } catch (e) {
    console.error('transcribe copy failed', e);
    await db.update(schema.transcriptions).set({ status: 'failed', error: 'копирование записи не удалось' })
      .where(eq(schema.transcriptions.id, tid));
    return c.json({ error: 'copy_failed' }, 502);
  }
});

// Завершить встречу. Если идёт запись — гасим egress заодно.
meetingRoutes.post('/:id/end', async (c) => {
  const w = c.get('workspace');
  const [m] = await db.select().from(mt)
    .where(and(eq(mt.id, c.req.param('id')!), eq(mt.workspaceId, w.id))).limit(1);
  if (!m) return c.json({ error: 'not_found' }, 404);
  if (m.recordingStatus === 'active' && m.egressId) {
    await stopRecording(m.egressId);
    await db.update(mt).set({ recordingStatus: 'processing' }).where(eq(mt.id, m.id));
  }
  const [row] = await db.update(mt)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(mt.id, m.id), eq(mt.status, 'active')))
    .returning({ id: mt.id });
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/join — публичный вход по инвайт-ссылке (внешние гости, БЕЗ JWT).
// Гейт — подписанный инвайт-токен (проверяем подпись и срок), не аккаунт.
// ─────────────────────────────────────────────────────────────────────────────
export const meetingGuestRoutes = new Hono();

// Проверить инвайт (для страницы входа: показать название встречи).
meetingGuestRoutes.post('/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const invite = z.string().min(10).safeParse(body?.invite);
  if (!invite.success) return c.json({ error: 'bad_invite' }, 400);
  const m = await resolveInvite(invite.data);
  if (!m) return c.json({ error: 'invalid_or_expired' }, 401);
  return c.json({ title: m.title, captions: m.captions });
});

// Выдать гостю токен LiveKit по инвайту + введённому имени и языку.
meetingGuestRoutes.post('/token', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const p = z.object({
    invite: z.string().min(10),
    name: z.string().trim().min(1).max(80),
    lang: z.enum(['ru', 'es']).catch('ru'),
  }).safeParse(body);
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const m = await resolveInvite(p.data.invite);
  if (!m) return c.json({ error: 'invalid_or_expired' }, 401);

  const token = await livekitToken({
    room: m.roomName,
    identity: `guest_${randomUUID().slice(0, 12)}`,
    name: p.data.name,
    metadata: JSON.stringify({ lang: p.data.lang, guest: true }),
  });
  return c.json({ url: env.LIVEKIT_WS_URL, token, room: m.roomName, title: m.title, captions: m.captions });
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/caption-worker — для caption-agent (GPU, вне контейнера бэка). Не JWT:
// общий секрет WORKER_TOKEN. Агент опрашивает, в какие комнаты заходить.
// ─────────────────────────────────────────────────────────────────────────────
export const captionWorkerRoutes = new Hono();
captionWorkerRoutes.use('*', async (c, next) => {
  if (!env.WORKER_TOKEN || c.req.header('X-Worker-Token') !== env.WORKER_TOKEN) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return next();
});

// Активные встречи с включёнными субтитрами → список имён комнат LiveKit.
captionWorkerRoutes.get('/rooms', async (c) => {
  const rows = await db.select({ roomName: mt.roomName }).from(mt)
    .where(and(eq(mt.status, 'active'), eq(mt.captions, true)));
  return c.json(rows.map((r) => r.roomName));
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/livekit-webhook — вебхуки LiveKit (egress). БЕЗ JWT: подпись проверяет
// WebhookReceiver (Authorization = подписанный ключом токен + sha256 тела).
// Обновляет recordingStatus/recordingKey по завершении egress.
// ─────────────────────────────────────────────────────────────────────────────
export const livekitWebhookRoutes = new Hono();
livekitWebhookRoutes.post('/webhook', async (c) => {
  const raw = await c.req.text();
  const auth = c.req.header('Authorization') ?? '';
  let ev;
  try {
    ev = await receiveWebhook(raw, auth);
  } catch {
    return c.json({ error: 'bad_signature' }, 401);
  }
  const info = ev.egressInfo;
  if (!info?.egressId) return c.json({ ok: true }); // не egress-событие — игнор

  const status = info.status;
  if (status === EgressStatus.EGRESS_COMPLETE) {
    const key = info.fileResults?.[0]?.filename || undefined;
    await db.update(mt)
      .set({ recordingStatus: 'ready', ...(key ? { recordingKey: key } : {}) })
      .where(eq(mt.egressId, info.egressId));
  } else if (status === EgressStatus.EGRESS_FAILED || status === EgressStatus.EGRESS_ABORTED) {
    await db.update(mt).set({ recordingStatus: 'failed' }).where(eq(mt.egressId, info.egressId));
  }
  return c.json({ ok: true });
});

// Проверяет подпись/срок инвайта и что встреча ещё активна.
async function resolveInvite(invite: string) {
  let mid: string;
  try {
    const { payload } = await jwtVerify(invite, inviteSecret());
    if (payload.kind !== 'meet-invite' || typeof payload.mid !== 'string') return null;
    mid = payload.mid;
  } catch {
    return null;
  }
  const [m] = await db.select({ roomName: mt.roomName, title: mt.title, status: mt.status, captions: mt.captions })
    .from(mt).where(eq(mt.id, mid)).limit(1);
  if (!m || m.status !== 'active') return null;
  return m;
}
