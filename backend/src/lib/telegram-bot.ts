import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import { findOrCreateUser } from "./users.js";
import { resolveUserWorkspaceId } from "./workspace-middleware.js";
import { logActivity } from "./activity.js";
import { notifyAssigned } from "./notify.js";
import {
  gatewayExtract,
  loadResolvers,
  runTaskQuery,
  queryAnswer,
  mapPriority,
  type TaskRow,
} from "./assistant-core.js";

const APP_URL = env.PUBLIC_APP_URL;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | Date, tz: string): string {
  return new Date(d).toLocaleString("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Кладёт сообщение в очередь tg_outbox. Сам бэк (РФ) до api.telegram.org не достучится —
 * исходящие забирает и шлёт релей вне РФ (см. /api/telegram/outbox).
 */
export async function sendMessage(chatId: number | string, text: string, markup?: unknown): Promise<void> {
  await db.insert(schema.tgOutbox).values({ chatId: String(chatId), body: text, markup: markup ?? null }).catch(() => {});
}

export function formatTaskList(tasks: TaskRow[], tz: string): string {
  return tasks
    .map((t) => {
      const star = t.isImportant ? "★ " : "";
      const due = t.dueAt ? ` — 🕑 ${fmtDate(t.dueAt, tz)}` : "";
      return `• ${star}${esc(t.title)}${due}`;
    })
    .join("\n");
}

interface TgFrom {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgUpdate {
  message?: {
    text?: string;
    chat: { id: number };
    from?: TgFrom;
  };
}

// ── Кнопки меню ───────────────────────────────────────────────────────────────
const BTN = {
  newTask: "📝 Новая задача",
  today: "📋 Дела на сегодня",
  open: "🔓 Открыть приложение",
  settings: "⚙️ Настройки",
  back: "⬅️ Назад",
};

const mainKeyboard = {
  keyboard: [
    [{ text: BTN.newTask }, { text: BTN.today }],
    [{ text: BTN.open }, { text: BTN.settings }],
  ],
  resize_keyboard: true,
};

function settingsKeyboard(morning: boolean, evening: boolean) {
  const s = (b: boolean) => (b ? "вкл ✅" : "выкл ❌");
  return {
    keyboard: [
      [{ text: `🌅 Утренний дайджест: ${s(morning)}` }],
      [{ text: `🌙 Вечерний дайджест: ${s(evening)}` }],
      [{ text: BTN.back }],
    ],
    resize_keyboard: true,
  };
}

function tgName(from: TgFrom): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "User";
}

/** Создаёт уже подтверждённый код входа и возвращает ссылку для кнопки «Открыть приложение». */
async function createLoginLink(userId: string): Promise<string> {
  const code = randomBytes(18).toString("base64url");
  await db.insert(schema.botLoginCodes).values({
    code, userId, status: "claimed", expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  return `${APP_URL}/auth?code=${code}`;
}

/** Подтверждает код входа со страницы (status pending → claimed). */
async function claimLoginCode(code: string, userId: string): Promise<boolean> {
  const [row] = await db.select().from(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, code)).limit(1);
  if (!row || row.status !== "pending" || row.expiresAt.getTime() < Date.now()) return false;
  await db.update(schema.botLoginCodes).set({ status: "claimed", userId }).where(eq(schema.botLoginCodes.code, code));
  return true;
}

async function sendSettings(chatId: number, userId: string): Promise<void> {
  const [u] = await db
    .select({
      notifyMorning: schema.users.notifyMorning,
      notifyEvening: schema.users.notifyEvening,
      morningTime: schema.users.morningTime,
      eveningTime: schema.users.eveningTime,
      timezone: schema.users.timezone,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!u) return;
  const txt =
    `⚙️ <b>Настройки</b>\n\n` +
    `🌅 Утренний дайджест в ${u.morningTime} — ${u.notifyMorning ? "вкл" : "выкл"}\n` +
    `🌙 Вечерний дайджест в ${u.eveningTime} — ${u.notifyEvening ? "вкл" : "выкл"}\n` +
    `🌍 Часовой пояс: ${esc(u.timezone)}\n\n` +
    `Жми кнопки, чтобы включить/выключить. Время и пояс меняются в приложении (Профиль).`;
  await sendMessage(chatId, txt, settingsKeyboard(u.notifyMorning, u.notifyEvening));
}

/** Главный обработчик входящего апдейта от Telegram. */
export async function processUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = msg.text.trim();

  // ── /start [payload] — регистрация (открытая) + подтверждение входа ──────────
  if (text === "/start" || text.startsWith("/start ")) {
    const payload = text.slice("/start".length).trim();
    const u = await findOrCreateUser("telegram", tgId, tgName(msg.from), undefined, {
      username: msg.from.username ?? null,
    });
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));

    if (payload.startsWith("login_")) {
      const ok = await claimLoginCode(payload.slice("login_".length), u.id);
      await sendMessage(
        chatId,
        ok
          ? "✅ Вход подтверждён! Возвращайся в приложение — оно откроется само."
          : "Ссылка для входа устарела. Открой приложение и нажми «Войти через бота» заново.",
        mainKeyboard,
      );
      return;
    }

    // ── Инвайт в пространство → членство status=pending (ждёт одобрения админа) ──
    if (payload.startsWith("invite_")) {
      const code = payload.slice("invite_".length);
      const [inv] = await db
        .select({ workspaceId: schema.workspaceInvites.workspaceId, role: schema.workspaceInvites.role, expiresAt: schema.workspaceInvites.expiresAt, wsName: schema.workspaces.name })
        .from(schema.workspaceInvites)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceInvites.workspaceId))
        .where(eq(schema.workspaceInvites.code, code))
        .limit(1);
      if (!inv || (inv.expiresAt && inv.expiresAt < new Date())) {
        await sendMessage(chatId, "Ссылка-приглашение недействительна или истекла. Попроси администратора прислать новую.", mainKeyboard);
        return;
      }
      const [existing] = await db
        .select({ status: schema.workspaceMembers.status })
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.workspaceId, inv.workspaceId), eq(schema.workspaceMembers.userId, u.id)))
        .limit(1);
      if (existing) {
        await sendMessage(chatId, existing.status === "active"
          ? `Ты уже в пространстве «${esc(inv.wsName)}». Открой приложение.`
          : `Заявка в «${esc(inv.wsName)}» уже отправлена — ждём одобрения администратора.`, mainKeyboard);
        return;
      }
      await db.insert(schema.workspaceMembers)
        .values({ workspaceId: inv.workspaceId, userId: u.id, role: inv.role, status: "pending" })
        .onConflictDoNothing();
      await sendMessage(chatId, `📨 Заявка на вступление в «${esc(inv.wsName)}» отправлена. Дождись одобрения администратора — я сообщу, когда откроют доступ.`, mainKeyboard);
      // Уведомить админов пространства о новой заявке.
      const admins = await db
        .select({ externalId: schema.authIdentities.externalId })
        .from(schema.workspaceMembers)
        .innerJoin(schema.authIdentities, eq(schema.authIdentities.userId, schema.workspaceMembers.userId))
        .where(and(
          eq(schema.workspaceMembers.workspaceId, inv.workspaceId),
          inArray(schema.workspaceMembers.role, ["admin", "owner"]),
          eq(schema.workspaceMembers.status, "active"),
          eq(schema.authIdentities.provider, "telegram"),
        ));
      for (const a of admins) {
        await sendMessage(a.externalId, `🔔 Новая заявка на вступление в «${esc(inv.wsName)}» от ${esc(tgName(msg.from))}. Одобри в приложении → Управление участниками.`);
      }
      return;
    }

    const [info] = await db.select({ displayName: schema.users.displayName, isActive: schema.users.isActive }).from(schema.users).where(eq(schema.users.id, u.id)).limit(1);
    if (info && !info.isActive) {
      await sendMessage(chatId, "Доступ приостановлен администратором.");
      return;
    }
    await sendMessage(
      chatId,
      `Привет, ${esc(info?.displayName ?? "")}! 👋\n\nЯ AI-диспетчер задач. Пиши задачи обычным языком — «завтра Ивану проверить VPN к 15:00» — или жми кнопки ниже.`,
      mainKeyboard,
    );
    return;
  }

  // Идентификация пользователя по Telegram-identity
  const [ident] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), eq(schema.authIdentities.externalId, tgId)))
    .limit(1);

  if (!ident) {
    await sendMessage(chatId, "Нажми /start, чтобы начать.");
    return;
  }
  const [user] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, timezone: schema.users.timezone, isActive: schema.users.isActive })
    .from(schema.users)
    .where(eq(schema.users.id, ident.userId))
    .limit(1);
  if (!user) return;
  if (!user.isActive) { await sendMessage(chatId, "Доступ приостановлен администратором."); return; }
  const tz = user.timezone;

  const workspaceId = await resolveUserWorkspaceId(user.id);
  if (!workspaceId) {
    await sendMessage(chatId, "Ты ещё не в пространстве. Открой приложение и зайди в своё пространство, затем вернись в бота.");
    return;
  }

  // ── Кнопки меню (перехват до отправки в модель) ──────────────────────────────
  if (text === BTN.newTask) {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    await sendMessage(chatId, "Опиши задачу одним сообщением 👇 — например «завтра в 15:00 позвонить Ивану».");
    return;
  }
  if (text === BTN.today) {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    const resolvers = await loadResolvers(workspaceId, user.id, user.displayName);
    const tasks = await runTaskQuery(user.id, { scope: "today" }, resolvers, workspaceId);
    const head = queryAnswer("today", tasks.length);
    await sendMessage(chatId, tasks.length ? `${head}\n${formatTaskList(tasks, tz)}` : head);
    return;
  }
  if (text === BTN.open) {
    const link = await createLoginLink(user.id);
    await sendMessage(chatId, "Открой приложение — вход уже подтверждён 👇", {
      inline_keyboard: [[{ text: "Открыть AppKacalypse", url: link }]],
    });
    return;
  }
  if (text === BTN.settings) {
    await sendSettings(chatId, user.id);
    return;
  }
  if (text === BTN.back) {
    await sendMessage(chatId, "Главное меню 👇", mainKeyboard);
    return;
  }
  if (text.startsWith("🌅 Утренний") || text.startsWith("🌙 Вечерний")) {
    const morning = text.startsWith("🌅");
    const [cur] = await db
      .select({ m: schema.users.notifyMorning, e: schema.users.notifyEvening })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    if (cur) {
      await db
        .update(schema.users)
        .set(morning ? { notifyMorning: !cur.m } : { notifyEvening: !cur.e })
        .where(eq(schema.users.id, user.id));
    }
    await sendSettings(chatId, user.id);
    return;
  }

  // Накопленный текст доспроса
  const [pending] = await db.select().from(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId)).limit(1);
  const combined = pending ? `${pending.text}\n${text}` : text;
  const rounds = pending?.rounds ?? 0;

  let result;
  try {
    result = await gatewayExtract(combined, user.displayName);
  } catch {
    await sendMessage(chatId, "Модель сейчас недоступна — попробуй ещё раз через минуту.");
    return;
  }

  const resolvers = await loadResolvers(workspaceId, user.id, user.displayName);

  // ── Вопрос ────────────────────────────────────────────────────────────────
  if (result.intent === "query_tasks") {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    const tasks = await runTaskQuery(user.id, result.query ?? {}, resolvers, workspaceId);
    const head = queryAnswer(result.query?.scope, tasks.length);
    await sendMessage(chatId, tasks.length ? `${head}\n${formatTaskList(tasks, tz)}` : head);
    return;
  }

  const gTasks = result.tasks ?? [];

  // ── Не задача ───────────────────────────────────────────────────────────────
  if (gTasks.length === 0) {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    await sendMessage(chatId, "Не похоже на задачу. Опиши, что нужно сделать — например «завтра проверить сервер».");
    return;
  }

  // ── Доспрос (первый раунд, если данных не хватает) ────────────────────────────
  if (result.needs_confirmation && rounds < 1) {
    await db
      .insert(schema.botSessions)
      .values({ telegramId: tgId, text: combined, rounds: rounds + 1, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.botSessions.telegramId, set: { text: combined, rounds: rounds + 1, updatedAt: new Date() } });
    const q = result.questions?.length ? result.questions.join(" ") : "Уточни срок, исполнителя или проект — или просто ответь «создай как есть».";
    await sendMessage(chatId, `❓ ${q}`);
    return;
  }

  // ── Создание ─────────────────────────────────────────────────────────────────
  await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
  const lines: string[] = [];
  for (const gt of gTasks) {
    const projectId = resolvers.resolveProject(gt.project as string | null);
    const assigneeName = (gt.assignee as string | null) ?? null;
    const assigneeId = resolvers.resolveAssignee(assigneeName);
    const [task] = await db
      .insert(schema.tasks)
      .values({
        workspaceId,
        title: String(gt.title ?? "Задача"),
        description: String(gt.description ?? ""),
        projectId,
        creatorId: user.id,
        controllerId: user.id,   // контролёр = постановщик из телеги
        priority: mapPriority(gt.priority as string | undefined),
        dueAt: gt.due_iso ? new Date(gt.due_iso as string) : null,
        isTriaged: !!projectId,
        source: "telegram",
      })
      .returning();
    // Исполнитель: распознанный участник → userId; нераспознанное имя → внешний (как в вебе);
    // никого не указали → ставим на постановщика.
    if (assigneeId) {
      await db.insert(schema.taskAssignees).values({ taskId: task!.id, userId: assigneeId });
    } else if (assigneeName) {
      await db.insert(schema.taskAssignees).values({ taskId: task!.id, externalName: assigneeName });
    } else {
      await db.insert(schema.taskAssignees).values({ taskId: task!.id, userId: user.id });
    }
    await logActivity({ taskId: task!.id, actorId: user.id, type: "created" });
    if (assigneeId && assigneeId !== user.id) {
      await notifyAssigned(task!.id, task!.title, user.displayName, [assigneeId], user.id);
    }
    const due = task!.dueAt ? ` — 🕑 ${fmtDate(task!.dueAt, tz)}` : "";
    lines.push(`✅ <b>${esc(task!.title)}</b>${due}${projectId ? "" : "  📥 во Входящих"}`);
  }
  await sendMessage(chatId, `${lines.join("\n")}\n\nОткрыть: ${APP_URL}`);
}
