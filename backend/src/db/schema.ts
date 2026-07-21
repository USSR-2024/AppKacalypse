import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, numeric, date, pgEnum, unique, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

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

  // Задача-мост из модуля «Документы». Не null ⇒ задача СИСТЕМНАЯ: руками статус не
  // меняют, гасит её только сам движок согласования (см. lib/doc-tasks.ts). Даёт и связь
  // с карточкой (deep-link). FK — только в SQL (миграция 0021): tasks↔documents циклична,
  // как currentVersionId, иначе tsc не выведет тип.
  documentId: uuid('document_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  controllerIdx: index('tasks_controller_idx').on(t.controllerId),
  projectIdx: index('tasks_project_idx').on(t.projectId),
  statusIdx: index('tasks_status_idx').on(t.status),
  dueIdx: index('tasks_due_idx').on(t.dueAt),
  workspaceIdx: index('tasks_workspace_idx').on(t.workspaceId),
  documentIdx: index('tasks_document_idx').on(t.documentId),
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
// заходят из трекера (JWT) или по инвайт-ссылке (внешние гости).
// Запись (по требованию) и субтитры — опциональны, тумблерами.
//   status: active → ended — это ЖИЗНЕННЫЙ ЦИКЛ («не завершена» / «завершена»),
//   а НЕ «идёт ли прямо сейчас»: запланированная встреча тоже active, пока не
//   завершена. Идёт ли она — считается из kind + startAt (см. joinGate в routes).
// ─────────────────────────────────────────────────────────────────────────────
export const meetingStatus = pgEnum('meeting_status', ['active', 'ended']);
// Тип встречи:
//   instant   — начата сейчас, ссылка живёт до завершения (поведение по умолчанию);
//   scheduled — на дату/время, вход открывается за 15 минут до начала, хост не нужен;
//   permanent — постоянная комната («планёрка»): ссылка не протухает, зашёл когда хочешь.
export const meetingKind = pgEnum('meeting_kind', ['instant', 'scheduled', 'permanent']);
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
  kind: meetingKind('kind').notNull().default('instant'),
  startAt: timestamp('start_at', { withTimezone: true }), // только у scheduled
  inviteCode: text('invite_code'),                        // код ссылки /join/<code>; перевыпуск отзывает старую
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
  inviteCodeIdx: uniqueIndex('meetings_invite_code_unique').on(t.inviteCode),
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

// ═════════════════════════════════════════════════════════════════════════════
// ДОКУМЕНТООБОРОТ («Документы»). Спека — docs/ТЗ-документооборот.md, порядок работ
// и границы первого захода — docs/ПЛАН-документооборот.md.
//
// Отличия от SQL в ТЗ (оно писалось под другой стек — это НЕ отсебятина):
//   • BIGSERIAL → uuid: users.id здесь uuid, сквозные BIGINT-ключи бы не сошлись;
//   • отдельная схема `docs` → префикс doc_/route_ в public: остальной трекер живёт так же;
//   • + workspace_id ВЕЗДЕ с первого дня (в ТЗ его нет вовсе — оно single-tenant).
//     Дописывать его в 14 таблиц потом — дороже, чем завести сразу.
//   • справочника контрагентов НЕТ (за границами первого захода) → на карточке
//     свободное текстовое поле counterparty_name: реестр по нему ищет, справочник не нужен.
//
// Центральная сущность — КАРТОЧКА документа, файл = её свойство. Задачи трекера
// (tasks) намеренно не переиспользуются: домен свой, иначе тащим шрамы трекерной модели.
// ═════════════════════════════════════════════════════════════════════════════

// Жизненный цикл карточки (ТЗ §2.1). ЭДО/ЭЦП вычеркнуты: подписание бумажное,
// в систему кладётся скан/PDF подписанного оригинала.
export const documentStatus = pgEnum('document_status', [
  'draft',        // черновик — правит инициатор
  'on_approval',  // идёт согласование по маршруту
  'rework',       // вернули на корректировку (есть блокирующее замечание)
  'approved',     // все обязательные согласовали
  'on_signing',   // у ГД на утверждении
  'signed',       // подписан, загружен оригинал
  'active',       // действует
  'expired',      // срок действия истёк
  'terminated',   // расторгнут
  'archived',     // сдан в архив (soft-delete: файлы не удаляем)
  'cancelled',    // отменён до подписания
]);

// ── Справочники ──────────────────────────────────────────────────────────────

// Группа документов — «чьи это». 7 категорий из приёмочного теста (кадровые,
// договорные, финансовые…). Дерево: parent_id. Редактируются в админке.
export const docGroups = pgTable('doc_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),                            // self-FK ставится в SQL миграции
  code: text('code').notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('doc_groups_ws_idx').on(t.workspaceId),
  codeUnique: unique('doc_groups_ws_code_unique').on(t.workspaceId, t.code),
}));

// Тип документа (договор, допсоглашение, приём сотрудника…). Именно тип решает,
// КТО согласует (через матрицу), нужна ли пояснительная записка и какой SLA.
export const docTypes = pgTable('doc_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => docGroups.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  registryMask: text('registry_mask').notNull().default('{TYPE}-{YYYY}-{NNNN}'),  // ТЗ §3.2
  requiresNote: boolean('requires_note').notNull().default(false),   // нужна пояснительная записка
  noteProfileId: uuid('note_profile_id'),                            // FK в SQL (циклическая ссылка)
  slaDays: integer('sla_days').notNull().default(3),                 // срок согласования, рабочих дней
  riskLevel: text('risk_level'),                                     // термин из регламента; смысл пока не определён
  requiresCounterparty: boolean('requires_counterparty').notNull().default(false),
  requiresValidity: boolean('requires_validity').notNull().default(false),
  attrSchema: jsonb('attr_schema').notNull().default({}),            // JSON Schema доп. атрибутов
  templateObjectKey: text('template_object_key'),                    // шаблон .docx в MinIO
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('doc_types_ws_idx').on(t.workspaceId),
  codeUnique: unique('doc_types_ws_code_unique').on(t.workspaceId, t.code),
}));

// Счётчик реестровых номеров. Отдельная таблица РАДИ АТОМАРНОСТИ: номер выдаётся
// через INSERT ... ON CONFLICT DO UPDATE ... RETURNING, а не SELECT MAX()+1 (гонка → дубли).
export const docRegistryCounters = pgTable('doc_registry_counters', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  typeId: uuid('type_id').notNull().references(() => docTypes.id, { onDelete: 'cascade' }),
  periodKey: text('period_key').notNull(),        // '2026' | '2026-07' — зависит от маски
  lastValue: integer('last_value').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.typeId, t.periodKey] }),
}));

// Справочник контрагентов (M2). Ручной ввод; реквизиты-OOXML и реальный синк — за
// границами первого захода, но фундамент под подтяжку из учётной системы заложен
// (external_id/external_source). Карточка документа ссылается сюда (documents.counterparty_id),
// строковый counterparty_name остаётся для свободного ввода и обратной совместимости.
export const docCounterparties = pgTable('doc_counterparties', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  inn: text('inn'),                          // ИНН/налоговый номер — опционально
  note: text('note'),
  externalId: text('external_id'),           // id в учётной системе (задел под синк)
  externalSource: text('external_source'),   // какая система (задел под синк)
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('doc_counterparties_ws_idx').on(t.workspaceId),
  nameUnique: unique('doc_counterparties_ws_name_unique').on(t.workspaceId, t.name),
}));

// ── Функциональные группы (кто согласует) ────────────────────────────────────

// Юристы, Финансы, СБ, HR… Матрица зовёт ГРУППУ, а не человека: иначе увольнение
// одного юриста ломает все маршруты. Это НЕ права доступа — измерения ортогональны.
export const orgUnits = pgTable('org_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('org_units_ws_idx').on(t.workspaceId),
  codeUnique: unique('org_units_ws_code_unique').on(t.workspaceId, t.code),
}));

// Роль в группе: lead визирует по умолчанию, deputy подставляется при отсутствии.
export const orgUnitRole = pgEnum('org_unit_role', ['lead', 'member', 'deputy']);

export const orgUnitMembers = pgTable('org_unit_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  unitId: uuid('unit_id').notNull().references(() => orgUnits.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: orgUnitRole('role').notNull().default('member'),
  canApprove: boolean('can_approve').notNull().default(false),  // может визировать ЗА группу
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unitIdx: index('org_unit_members_unit_idx').on(t.unitId),
  userIdx: index('org_unit_members_user_idx').on(t.userId),
  memberUnique: unique('org_unit_members_unique').on(t.unitId, t.userId),
}));

// ── Матрица согласований ─────────────────────────────────────────────────────

// Тип документа → обязательные группы. ЭТО ДАННЫЕ, редактируемые в админке:
// требование владельца — «редактировать и не лезть в код». Приёмочный тест —
// собрать матрицу АО «Холдинг» целиком через UI (план, фаза 8).
export const approvalMatrix = pgTable('approval_matrix', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  typeId: uuid('type_id').notNull().references(() => docTypes.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').notNull().references(() => orgUnits.id, { onDelete: 'restrict' }),
  stageNo: integer('stage_no').notNull().default(1),   // шаги одной стадии идут ПАРАЛЛЕЛЬНО
  isRequired: boolean('is_required').notNull().default(true),  // обязательного убрать нельзя
  slaDays: integer('sla_days'),                        // null = берём из типа
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  typeIdx: index('approval_matrix_type_idx').on(t.typeId),
  rowUnique: unique('approval_matrix_unique').on(t.typeId, t.unitId, t.stageNo),
}));

// ── Карточка документа ───────────────────────────────────────────────────────

// Приоритет документа — 4 уровня. У задач трекера своя шкала (low/normal/high):
// это ДРУГАЯ сущность, смешивать нельзя. Критический требует обоснования.
export const docPriority = pgEnum('doc_priority', ['critical', 'urgent', 'important', 'low']);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  // Присваивается ОДИН РАЗ при уходе на согласование и больше не меняется. Не при
  // создании черновика: брошенные черновики выжгли бы дыры в нумерации.
  registryNumber: text('registry_number'),
  title: text('title').notNull(),
  description: text('description'),
  priority: docPriority('priority').notNull().default('important'),
  priorityReason: text('priority_reason'),        // обязателен при critical
  dueAt: timestamp('due_at', { withTimezone: true }),
  typeId: uuid('type_id').notNull().references(() => docTypes.id, { onDelete: 'restrict' }),
  groupId: uuid('group_id').references(() => docGroups.id, { onDelete: 'set null' }),
  status: documentStatus('status').notNull().default('draft'),

  authorId: uuid('author_id').notNull().references(() => users.id),
  ownerId: uuid('owner_id').notNull().references(() => users.id),   // ответственный за карточку

  // Контрагент: ссылка на справочник (M2) + денормализованное имя строкой (свободный
  // ввод и обратная совместимость; при выборе из справочника проставляем оба).
  counterpartyId: uuid('counterparty_id').references(() => docCounterparties.id, { onDelete: 'set null' }),
  counterpartyName: text('counterparty_name'),

  dateSigned: date('date_signed'),
  effectiveFrom: date('effective_from'),
  effectiveTo: date('effective_to'),                               // null = бессрочный
  isPerpetual: boolean('is_perpetual').notNull().default(false),

  amount: numeric('amount', { precision: 18, scale: 2 }),
  currency: text('currency'),

  currentVersionId: uuid('current_version_id'),                    // FK в SQL: циклическая ссылка
  signedVersionId: uuid('signed_version_id'),

  // Трекинг-задача инициатора «провести согласование до конца» (см. lib/doc-tasks.ts):
  // одна на документ, гаснет, когда маршрут пройден (M3 перенесёт закрытие на подписание).
  // FK — только в SQL (миграция 0021): цикл tasks↔documents, как currentVersionId.
  approvalTaskId: uuid('approval_task_id'),

  storageLocation: text('storage_location'),                       // где лежит бумажный оригинал
  attrs: jsonb('attrs').notNull().default({}),                     // доп. атрибуты по attr_schema типа
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),  // связь с задачей трекера

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  wsIdx: index('documents_ws_idx').on(t.workspaceId),
  statusIdx: index('documents_status_idx').on(t.workspaceId, t.status),
  ownerIdx: index('documents_owner_idx').on(t.ownerId),
  typeIdx: index('documents_type_idx').on(t.typeId, t.groupId),
  numberUnique: unique('documents_registry_number_unique').on(t.workspaceId, t.registryNumber),
}));

// Версия = сущность, а не «файл в комментарии». Файл — свойство версии.
export const documentVersions = pgTable('document_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  versionNo: integer('version_no').notNull(),
  objectKey: text('object_key').notNull(),      // ключ в MinIO; НЕИЗМЕНЯЕМ (переименование правит fileName)
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  fileHash: text('file_hash').notNull(),        // sha256
  mimeType: text('mime_type').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
  comment: text('comment'),

  // ── Поля под ONLYOFFICE Document Server ──────────────────────────────────
  // Зарезервированы СРАЗУ, хотя DS ещё не решён (план, вопрос 2). Стоят ноль, а
  // задним числом не восстанавливаются: ТЗ §4.6 — не сохранишь changes с первого
  // дня, подсветки правок не будет НИКОГДА (DS отдаёт их один раз, в callback).
  dsKey: text('ds_key'),                        // d{id}_v{n}_{hash16} — хэш в ключе решает инвалидацию кэша
  changesObjectKey: text('changes_object_key'), // changes.zip от DS
  changesHistory: jsonb('changes_history'),     // объект history из callback
  dsServerVersion: text('ds_server_version'),

  isSignedOriginal: boolean('is_signed_original').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  docIdx: index('document_versions_doc_idx').on(t.documentId),
  versionUnique: unique('document_versions_no_unique').on(t.documentId, t.versionNo),
}));

// ── Маршрут согласования ─────────────────────────────────────────────────────

export const routeStatus = pgEnum('route_status', ['running', 'approved', 'rejected', 'cancelled']);

export const routeInstances = pgTable('route_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  // СНИМОК матрицы на момент запуска: правка матрицы не должна ломать идущие согласования.
  definition: jsonb('definition').notNull(),
  status: routeStatus('status').notNull().default('running'),
  currentStage: integer('current_stage').notNull().default(1),
  iteration: integer('iteration').notNull().default(1),   // номер круга (после корректировки +1)
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({
  docIdx: index('route_instances_doc_idx').on(t.documentId, t.iteration),
}));

export const stepStatus = pgEnum('step_status', ['pending', 'active', 'approved', 'rejected', 'skipped']);

export const routeSteps = pgTable('route_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  routeInstanceId: uuid('route_instance_id').notNull().references(() => routeInstances.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),  // от какой группы шаг
  assigneeId: uuid('assignee_id').references(() => users.id),                       // разрезолвленный человек
  stageNo: integer('stage_no').notNull(),        // шаги одной стадии идут параллельно
  isRequired: boolean('is_required').notNull().default(true),
  status: stepStatus('status').notNull().default('pending'),
  // ★ Ключевое поле: без него нельзя ответить «изменился ли документ ПОСЛЕ того,
  // как Иванов согласовал» → невозможна политика повторного согласования по затронутым.
  decidedVersionId: uuid('decided_version_id').references(() => documentVersions.id, { onDelete: 'set null' }),
  isAdHoc: boolean('is_ad_hoc').notNull().default(false),   // добавлен инициатором сверх матрицы
  addedBy: uuid('added_by').references(() => users.id),
  // Задача-мост согласующего для этого шага (см. lib/doc-tasks.ts): создаётся при
  // активации шага, гаснет, когда шаг решён. tasks определён выше — ссылка обычная.
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => ({
  routeIdx: index('route_steps_route_idx').on(t.routeInstanceId, t.stageNo),
  assigneeIdx: index('route_steps_assignee_idx').on(t.assigneeId, t.status),
}));

// ★ Замечание БЛОКИРУЕТ, комментарий НЕ блокирует и уходит в лист разногласий.
// Разные последствия ⇒ разные сущности и две разные кнопки в UI, а не одно поле «текст».
export const remarkKind = pgEnum('remark_kind', ['blocking', 'comment']);

export const stepRemarks = pgTable('step_remarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  stepId: uuid('step_id').notNull().references(() => routeSteps.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id),
  kind: remarkKind('kind').notNull(),
  text: text('text').notNull(),
  versionId: uuid('version_id').references(() => documentVersions.id, { onDelete: 'set null' }), // к какой версии
  // Ответ инициатора: учтено/не учтено + обоснование → из этого генерится лист разногласий.
  resolution: text('resolution'),
  isAccepted: boolean('is_accepted'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  docIdx: index('step_remarks_doc_idx').on(t.documentId),
  stepIdx: index('step_remarks_step_idx').on(t.stepId),
}));

// ── Пояснительная записка ────────────────────────────────────────────────────

// Профиль = набор полей записки ДЛЯ КОНКРЕТНОГО типа документа. Без профилей в
// 12 полях из 15 будет «н/д»: записка к закупке ИТ и к приёму сотрудника — разные.
export const noteProfiles = pgTable('note_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  fields: jsonb('fields').notNull().default([]),   // [{key,label,type,required,hint}]
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUnique: unique('note_profiles_ws_code_unique').on(t.workspaceId, t.code),
}));

// Записка — СТРУКТУРИРОВАННАЯ ФОРМА, а не приложенный вордовый файл.
export const explanatoryNotes = pgTable('explanatory_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').references(() => noteProfiles.id, { onDelete: 'set null' }),
  values: jsonb('values').notNull().default({}),   // {ключ поля: значение}
  authorId: uuid('author_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  docUnique: unique('explanatory_notes_doc_unique').on(t.documentId),
}));

// ── Аудит ────────────────────────────────────────────────────────────────────

// Единственный источник правды на вопрос «что вообще происходило с документом».
// Пишется на ВСЕ смены статуса, сохранения версий, решения по шагам, правки справочников.
// Записи неизменяемы: не редактировать и не удалять (ТЗ §3.7).
export const documentActivity = pgTable('document_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  entity: text('entity').notNull(),          // document | version | route_step | doc_type | org_unit | matrix
  entityId: uuid('entity_id'),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),          // created | status_changed | version_saved | approved | ...
  payload: jsonb('payload').notNull().default({}),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  docIdx: index('document_activity_doc_idx').on(t.documentId, t.at),
  wsIdx: index('document_activity_ws_idx').on(t.workspaceId, t.at),
}));

// ── Права и фиче-флаги ────────────────────────────────────────────────────────

// Фиче-флаг модуля НА ВОРКСПЕЙС: владелец пространства включает/выключает модули
// (документы, оргструктура…). Нет строки = включено по умолчанию (обратная совместимость).
export const workspaceFeatures = pgTable('workspace_features', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(),          // 'documents' | 'org_structure' | ...
  enabled: boolean('enabled').notNull().default(true),
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.feature] }),
}));

// Возможности пользователя в модуле «Документы». Нет строки = дефолт по роли воркспейса
// (owner/admin — всё; member — только создавать). Строка ПЕРЕОПРЕДЕЛЯЕТ. Должность (кто
// согласует) — это org_units, ОТДЕЛЬНОЕ измерение; здесь именно ПРАВА ДОСТУПА.
export const docMemberPerms = pgTable('doc_member_perms', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  canCreate: boolean('can_create').notNull().default(true),     // заводить документы (инициировать)
  canManage: boolean('can_manage').notNull().default(false),    // «Настройки»: типы, группы, матрица
  canViewAll: boolean('can_view_all').notNull().default(false), // видеть ВСЕ документы (делопроизводитель)
}, (t) => ({
  pk: primaryKey({ columns: [t.workspaceId, t.userId] }),
}));
