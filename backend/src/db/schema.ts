import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, pgEnum, unique, index } from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

// Глобальная роль пользователя в системе
export const userRole = pgEnum('user_role', ['owner', 'admin', 'member']);

// Способ входа. Telegram — основной; email и прочее добавляем позже без миграции данных.
export const authProvider = pgEnum('auth_provider', ['telegram', 'email']);

// Роль участника внутри проекта/направления
export const projectMemberRole = pgEnum('project_member_role', ['lead', 'member']);

// Статусы задачи (ТЗ: в очереди / выполняется / готово / отменено / архив)
export const taskStatus = pgEnum('task_status', [
  'queued',       // в очереди
  'in_progress',  // выполняется
  'done',         // готово
  'cancelled',    // отменено
  'archived',     // архив
]);

// Приоритет = срочность. Отдельно от флага «важная» (isImportant)
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high']);

// Откуда прилетела задача
export const taskSource = pgEnum('task_source', ['app', 'telegram', 'email', 'calendar', 'ai']);

// Тип события в логе активности задачи
export const activityType = pgEnum('activity_type', [
  'created',
  'status_changed',
  'assigned',
  'edited',
  'commented',
  'triaged',
]);

// ─────────────────────────────────────────────────────────────────────────────
// users — внутренняя идентичность. id навсегда, способ входа меняется отдельно.
// ─────────────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  role: userRole('role').notNull().default('member'),
  email: text('email'),                       // опционально, на будущее (вход/дайджесты по почте)
  avatarUrl: text('avatar_url'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  lang: text('lang').notNull().default('ru'),

  // Настройки напоминаний
  notifyMorning: boolean('notify_morning').notNull().default(true),
  notifyEvening: boolean('notify_evening').notNull().default(true),
  morningTime: text('morning_time').notNull().default('09:00'),   // HH:MM в timezone юзера
  eveningTime: text('evening_time').notNull().default('19:00'),
  // Каналы доставки: ['telegram'] | ['push'] | ['email'] | их комбинация
  notifyChannels: jsonb('notify_channels').notNull().default(['telegram']),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// auth_identities — способы подтвердить личность. Один user → много identity.
// Позволяет сменить/добавить Telegram/email, не трогая users.id.
// ─────────────────────────────────────────────────────────────────────────────
export const authIdentities = pgTable('auth_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: authProvider('provider').notNull(),
  externalId: text('external_id').notNull(),  // telegram_id или email
  meta: jsonb('meta').notNull().default({}),  // username, photo_url и т.п.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerExternalUnique: unique('auth_provider_external_unique').on(t.provider, t.externalId),
  userIdx: index('auth_identities_user_idx').on(t.userId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// projects — направления (напр. «Контроль текущих проектов»). null у задачи = личная/Inbox.
// ─────────────────────────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color'),                       // для UI/досок
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// project_members — кто в команде проекта и с какой ролью.
// ─────────────────────────────────────────────────────────────────────────────
export const projectMembers = pgTable('project_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: projectMemberRole('role').notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectUserUnique: unique('project_member_unique').on(t.projectId, t.userId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// tasks — ядро. projectId null = личная или Inbox (различаем по isTriaged).
//   Inbox     = isTriaged=false (ещё не разобрана, лежит во «Входящих»).
//   Личная    = isTriaged=true  И projectId=null.
//   Проектная = projectId задан.
// ─────────────────────────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),

  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  creatorId: uuid('creator_id').notNull().references(() => users.id),
  assigneeId: uuid('assignee_id').references(() => users.id),

  status: taskStatus('status').notNull().default('queued'),
  priority: taskPriority('priority').notNull().default('normal'),
  isImportant: boolean('is_important').notNull().default(false),  // «важная, не забыть» — отдельно от приоритета
  isTriaged: boolean('is_triaged').notNull().default(true),       // false = лежит во Входящих

  dueAt: timestamp('due_at', { withTimezone: true }),
  remindAt: timestamp('remind_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  source: taskSource('source').notNull().default('app'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  assigneeIdx: index('tasks_assignee_idx').on(t.assigneeId),
  projectIdx: index('tasks_project_idx').on(t.projectId),
  statusIdx: index('tasks_status_idx').on(t.status),
  dueIdx: index('tasks_due_idx').on(t.dueAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// task_activity — лог для контроля исполнения. actorId null = система/AI.
// ─────────────────────────────────────────────────────────────────────────────
export const taskActivity = pgTable('task_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id),
  type: activityType('type').notNull(),
  payload: jsonb('payload').notNull().default({}),   // {field, from, to} и т.п.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index('task_activity_task_idx').on(t.taskId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// bot_sessions — состояние доспроса в Telegram (1 незавершённый черновик на чат).
// ─────────────────────────────────────────────────────────────────────────────
export const botSessions = pgTable('bot_sessions', {
  telegramId: text('telegram_id').primaryKey(),   // = chat_id / from.id
  text: text('text').notNull(),                   // накопленный текст задачи
  rounds: integer('rounds').notNull().default(0), // сколько раз уже доспрашивали
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// tg_outbox — очередь исходящих в Telegram. Бэк (РФ) не достучится до api.telegram.org,
// поэтому пишет сюда, а релей вне РФ забирает и отправляет.
// ─────────────────────────────────────────────────────────────────────────────
export const tgOutbox = pgTable('tg_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: text('chat_id').notNull(),
  body: text('body').notNull(),
  markup: jsonb('markup'),                          // reply_markup для Telegram (кнопки), null = без кнопок
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => ({
  pendingIdx: index('tg_outbox_pending_idx').on(t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// bot_login_codes — одноразовые коды входа через Telegram-бота (обход блокировки
// веб-виджета в РФ). Веб выдаёт код → бот подтверждает (status=claimed, userId) →
// веб меняет код на JWT (status=consumed).
// ─────────────────────────────────────────────────────────────────────────────
export const botLoginCodes = pgTable('bot_login_codes', {
  code: text('code').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),  // pending | claimed | consumed
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// push_subscriptions — Web Push (PWA). Один user → много устройств.
// ─────────────────────────────────────────────────────────────────────────────
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  endpointUnique: unique('push_endpoint_unique').on(t.endpoint),
  userIdx: index('push_subscriptions_user_idx').on(t.userId),
}));
