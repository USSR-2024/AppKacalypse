import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { eq } from 'drizzle-orm';
import { env } from './lib/env.js';
import { db, schema } from './db/index.js';
import { requireAuth } from './lib/auth-middleware.js';
import { authRoutes } from './routes/auth.js';
import { taskRoutes } from './routes/tasks.js';
import { projectRoutes } from './routes/projects.js';
import { teamRoutes } from './routes/teams.js';
import { userRoutes } from './routes/users.js';
import { assistantRoutes } from './routes/assistant.js';
import { telegramRoutes } from './routes/telegram.js';
import { pushRoutes } from './routes/push.js';
import { broadcastRoutes } from './routes/broadcast.js';
import { workspaceRoutes, ownerRoutes, memberRoutes } from './routes/workspaces.js';
import { transcriptionRoutes, transcribeWorkerRoutes } from './routes/transcriptions.js';
import { meetingRoutes, meetingGuestRoutes, captionWorkerRoutes, livekitWebhookRoutes } from './routes/meetings.js';
import { documentRoutes } from './routes/documents.js';
import { dsRoutes } from './routes/documents-ds.js';
import { startScheduler } from './lib/scheduler.js';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

app.get('/health', (c) => c.json({ status: 'ok', service: 'backend' }));

app.route('/api/auth', authRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/teams', teamRoutes);
app.route('/api/users', userRoutes);
app.route('/api/assistant', assistantRoutes);
app.route('/api/documents', documentRoutes);
app.route('/api/ds', dsRoutes);   // DS-фейсинг (файл + колбэк), БЕЗ requireAuth — авторизация по токену
app.route('/api/telegram', telegramRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/broadcast', broadcastRoutes);
app.route('/api/workspaces', workspaceRoutes);
app.route('/api/owner', ownerRoutes);
app.route('/api/members', memberRoutes);
app.route('/api/transcriptions', transcriptionRoutes);
app.route('/api/transcribe-worker', transcribeWorkerRoutes);
app.route('/api/meetings', meetingRoutes);
app.route('/api/join', meetingGuestRoutes);
app.route('/api/caption-worker', captionWorkerRoutes);
app.route('/api/livekit', livekitWebhookRoutes);

// Текущий пользователь по JWT.
app.get('/api/me', requireAuth, async (c) => {
  const { sub } = c.get('user');
  const [me] = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      email: schema.users.email,        // привязана ли почта (второй способ входа)
      role: schema.users.role,
      timezone: schema.users.timezone,
      lang: schema.users.lang,
      projectView: schema.users.projectView,
      notifyMorning: schema.users.notifyMorning,
      notifyEvening: schema.users.notifyEvening,
      morningTime: schema.users.morningTime,
      eveningTime: schema.users.eveningTime,
      notifyChannels: schema.users.notifyChannels,
    })
    .from(schema.users)
    .where(eq(schema.users.id, sub))
    .limit(1);
  if (!me) return c.json({ error: 'not_found' }, 404);
  return c.json(me);
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`backend на :${info.port}`);
  startScheduler();
});
