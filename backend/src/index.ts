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
import { userRoutes } from './routes/users.js';

const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors());

app.get('/health', (c) => c.json({ status: 'ok', service: 'backend' }));

app.route('/api/auth', authRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/users', userRoutes);

// Текущий пользователь по JWT.
app.get('/api/me', requireAuth, async (c) => {
  const { sub } = c.get('user');
  const [me] = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      role: schema.users.role,
      timezone: schema.users.timezone,
      lang: schema.users.lang,
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
});
