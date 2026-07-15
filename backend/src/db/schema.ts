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

// Доступ участника к задачам проекта: own = только свои, all = все задачи проекта
// (руководитель видит всё, не будучи добавленным в задачу).
export const projectAccess = pgEnum('project_access', ['own', 'all']);

// Роль участника внутри воркспейса (компании). owner = создатель пространства.
export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member']);

// Статус членства: active = полноправный, pending = вступил по инвайту, ждёт одобрения админа.
export const memberStatus = pgEnum('member_status', ['active', 'pending']);

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
  projectView: text('project_view').notNull().default('list'),  // вид в проекте: list | board | table

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
// workspaces — арендатор (компания/команда). URL: /<slug>. Изоляция данных по
// workspace_id на core-таблицах (tasks/projects/teams).
// ─────────────────────────────────────────────────────────────────────────────
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),               // часть URL, латиница/цифры/дефис
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugUnique: unique('workspace_slug_unique').on(t.slug),
}));

// ─────────────────────────────────────────────────────────────────────────────
// workspace_members — членство юзера в воркспейсе и роль внутри него.
// Один юзер может состоять в нескольких компаниях.
// ─────────────────────────────────────────────────────────────────────────────
export const workspaceMembers = pgTable('workspace_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: workspaceRole('role').notNull().default('member'),
  // active = доступ есть; pending = вступил по инвайту, ждёт одобрения админа (доступа нет).
  status: memberStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceUserUnique: unique('workspace_member_unique').on(t.workspaceId, t.userId),
  workspaceIdx: index('workspace_members_workspace_idx').on(t.workspaceId),
  userIdx: index('workspace_members_user_idx').on(t.userId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// workspace_invites — ссылки-приглашения в воркспейс. Вступивший по коду получает
// членство status='pending'. Многоразовая до истечения; гейт — одобрение админа.
// ─────────────────────────────────────────────────────────────────────────────
export const workspaceInvites = pgTable('workspace_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  role: workspaceRole('role').notNull().default('member'),  // роль, которую получит вступивший после одобрения
  // Одобрять некому, когда главу пространства зовёт владелец платформы → сразу active.
  // Инвайты главы своим сотрудникам остаются pending (false).
  autoApprove: boolean('auto_approve').notNull().default(false),
  // null = многоразовая (ссылка главы своим). Число = сколько входов осталось;
  // приглашение главе выдаётся одноразовым, чтобы утёкшая ссылка не сделала
  // главой компании случайного человека.
  usesLeft: integer('uses_left'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUnique: unique('workspace_invite_code_unique').on(t.code),
  workspaceIdx: index('workspace_invites_workspace_idx').on(t.workspaceId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// email_login_codes — беспарольный вход по коду на почту (OTP). Тот же примитив
// закрывает и вход, и регистрацию по инвайту, и привязку почты в профиле.
// Код хранится ХЕШЕМ: дамп базы не должен давать возможности войти.
// ─────────────────────────────────────────────────────────────────────────────
export const emailLoginCodes = pgTable('email_login_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),                       // нормализованный (lowercase, trim)
  codeHash: text('code_hash').notNull(),                // sha256(код)
  inviteCode: text('invite_code'),                      // если это регистрация по приглашению
  linkUserId: uuid('link_user_id').references(() => users.id, { onDelete: 'cascade' }), // привязка почты в профиле
  attempts: integer('attempts').notNull().default(0),   // защита от перебора шестизначного кода
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('email_login_codes_email_idx').on(t.email),
}));

// ─────────────────────────────────────────────────────────────────────────────
// projects — направления (напр. «Контроль текущих проектов»). null у задачи = личная/Inbox.
// ─────────────────────────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  color: text('color'),                       // для UI/досок
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('projects_workspace_idx').on(t.workspaceId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// project_members — кто в команде проекта и с какой ролью.
// ─────────────────────────────────────────────────────────────────────────────
export const projectMembers = pgTable('project_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: projectMemberRole('role').notNull().default('member'),
  // Доступ к задачам проекта: own = только свои, all = все. Default 'all' — сохраняет
  // прежнее поведение для уже существующих участников (раньше член проекта видел всё).
  accessScope: projectAccess('access_scope').notNull().default('all'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectUserUnique: unique('project_member_unique').on(t.projectId, t.userId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// project_sections — разделы внутри проекта (секции à la Todoist).
// ─────────────────────────────────────────────────────────────────────────────
export const projectSections = pgTable('project_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index('project_sections_project_idx').on(t.projectId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// tasks — ядро. projectId null = личная или Inbox (различаем по isTriaged).
//   Inbox     = isTriaged=false (ещё не разобрана, лежит во «Входящих»).
//   Личная    = isTriaged=true  И projectId=null.
//   Проектная = projectId задан.
// ─────────────────────────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),

  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  sectionId: uuid('section_id').references(() => projectSections.id, { onDelete: 'set null' }),
  creatorId: uuid('creator_id').notNull().references(() => users.id),
  // Контролёр = ответственный за результат. По умолчанию = создатель (проставляется в коде/миграции).
  // Исполнители вынесены в task_assignees (несколько + внешние без аккаунта).
  controllerId: uuid('controller_id').references(() => users.id),

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
  controllerIdx: index('tasks_controller_idx').on(t.controllerId),
  projectIdx: index('tasks_project_idx').on(t.projectId),
  statusIdx: index('tasks_status_idx').on(t.status),
  dueIdx: index('tasks_due_idx').on(t.dueAt),
  workspaceIdx: index('tasks_workspace_idx').on(t.workspaceId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// task_assignees — исполнители задачи. Несколько на задачу. Либо внутренний
// (userId), либо внешний без аккаунта (externalName) — задачу поставили человеку
// не из команды, а отвечает за результат контролёр.
// ─────────────────────────────────────────────────────────────────────────────
export const taskAssignees = pgTable('task_assignees', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  externalName: text('external_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index('task_assignees_task_idx').on(t.taskId),
  userIdx: index('task_assignees_user_idx').on(t.userId),
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
// task_comments — обсуждение/«работы» под задачей. mentions = userId[] упомянутых
// (@упоминание → уведомление). Закрывает «добавить нюансы/что сделано» по задаче.
// ─────────────────────────────────────────────────────────────────────────────
export const taskComments = pgTable('task_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  mentions: jsonb('mentions').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index('task_comments_task_idx').on(t.taskId),
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
// teams — переиспользуемый набор людей. Команду можно добавить в проект целиком
// (её участники становятся участниками проекта).
// ─────────────────────────────────────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('teams_workspace_idx').on(t.workspaceId),
}));

export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamUserUnique: unique('team_member_unique').on(t.teamId, t.userId),
  teamIdx: index('team_members_team_idx').on(t.teamId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// changelog — журнал изменений приложения. announcedAt=null → ещё не уведомляли.
// Из неуведомлённых пунктов LLM готовит черновик рассылки.
// ─────────────────────────────────────────────────────────────────────────────
export const changelog = pgTable('changelog', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  announcedAt: timestamp('announced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// broadcasts — история ручных рассылок «уведомление об обновлении» (owner/admin).
// ─────────────────────────────────────────────────────────────────────────────
export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  senderId: uuid('sender_id').notNull().references(() => users.id),
  channels: jsonb('channels').notNull().default([]),
  recipientCount: integer('recipient_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// transcriptions — расшифровки встреч (Zoom m4a → текст + протокол). Пайплайн
// гоняет хостовый воркер akc-transcribe-worker (GPU, whisperx + qwen3), бэкенд
// только принимает файл, отдаёт статус/результат. Файлы — на общем томе /data/<id>/.
//   status:         queued → transcribing → transcribed | failed
//   protocolStatus: none → queued → running → ready | failed  (по запросу пользователя)
// ─────────────────────────────────────────────────────────────────────────────
export const transcriptionStatus = pgEnum('transcription_status', ['queued', 'transcribing', 'transcribed', 'failed']);
export const protocolStatus = pgEnum('protocol_status', ['none', 'queued', 'running', 'ready', 'failed']);

export const transcriptions = pgTable('transcriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),                 // исходное имя файла (для показа)
  lang: text('lang').notNull().default('auto'),         // auto | ru | es
  status: transcriptionStatus('status').notNull().default('queued'),
  protocolStatus: protocolStatus('protocol_status').notNull().default('none'),
  error: text('error'),                                 // текст ошибки последнего упавшего этапа
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workspaceIdx: index('transcriptions_workspace_idx').on(t.workspaceId),
  statusIdx: index('transcriptions_status_idx').on(t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// meetings — видеовстречи (LiveKit). Комната создаётся в воркспейсе, участники
// заходят из трекера (JWT) или по подписанной инвайт-ссылке (внешние гости).
// Запись (по требованию) и субтитры — опциональны, тумблерами.
//   status: active → ended
// ─────────────────────────────────────────────────────────────────────────────
export const meetingStatus = pgEnum('meeting_status', ['active', 'ended']);
// Статус записи встречи: none → active (egress пишет) → processing (egress завершается,
// заливает в MinIO) → ready (mp4 в бакете, есть ключ) | failed.
export const recordingStatus = pgEnum('recording_status', ['none', 'active', 'processing', 'ready', 'failed']);

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default('Встреча'),
  roomName: text('room_name').notNull(),                 // имя комнаты LiveKit
  status: meetingStatus('status').notNull().default('active'),
  captions: boolean('captions').notNull().default(false),  // живые субтитры вкл/выкл
  recordingStatus: recordingStatus('recording_status').notNull().default('none'), // состояние записи
  egressId: text('egress_id'),                           // id активного/последнего LiveKit Egress
  recordingKey: text('recording_key'),                   // ключ mp4 в бакете MinIO (когда ready)
  transcriptionId: uuid('transcription_id').references(() => transcriptions.id, { onDelete: 'set null' }), // запись → расшифровка
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => ({
  workspaceIdx: index('meetings_workspace_idx').on(t.workspaceId),
  roomUnique: unique('meetings_room_unique').on(t.roomName),
}));

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
