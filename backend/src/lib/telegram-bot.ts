import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import { logActivity } from "./activity.js";
import {
  gatewayExtract,
  loadResolvers,
  runTaskQuery,
  queryAnswer,
  mapPriority,
  type TaskRow,
} from "./assistant-core.js";

const APP_URL = "https://appkacalypse.baassist.ru";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDate(d: string | Date, tz: string): string {
  return new Date(d).toLocaleString("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
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

interface TgUpdate {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number };
  };
}

/** Главный обработчик входящего апдейта от Telegram. */
export async function processUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  const chatId = msg.chat.id;
  const tgId = String(msg.from.id);
  const text = msg.text.trim();

  // Идентификация пользователя по Telegram-identity
  const [ident] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), eq(schema.authIdentities.externalId, tgId)))
    .limit(1);

  if (!ident) {
    await sendMessage(chatId, `Я тебя пока не знаю. Зайди в приложение ${APP_URL} и войди через Telegram — тогда смогу ставить твои задачи.`);
    return;
  }
  const [user] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, timezone: schema.users.timezone })
    .from(schema.users)
    .where(eq(schema.users.id, ident.userId))
    .limit(1);
  if (!user) return;
  const tz = user.timezone;

  if (text === "/start") {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    await sendMessage(chatId, `Привет, ${esc(user.displayName)}! 👋\nПиши задачи обычным языком — «завтра Ивану проверить VPN к 15:00». Я создам задачу.\nИли спроси: «какие у меня задачи на сегодня».`);
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

  const resolvers = await loadResolvers(user.id, user.displayName);

  // ── Вопрос ────────────────────────────────────────────────────────────────
  if (result.intent === "query_tasks") {
    await db.delete(schema.botSessions).where(eq(schema.botSessions.telegramId, tgId));
    const tasks = await runTaskQuery(user.id, result.query ?? {}, resolvers);
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
    const assigneeId = resolvers.resolveAssignee(gt.assignee as string | null) ?? user.id;
    const [task] = await db
      .insert(schema.tasks)
      .values({
        title: String(gt.title ?? "Задача"),
        description: String(gt.description ?? ""),
        projectId,
        creatorId: user.id,
        assigneeId,
        priority: mapPriority(gt.priority as string | undefined),
        dueAt: gt.due_iso ? new Date(gt.due_iso as string) : null,
        isTriaged: !!projectId,
        source: "telegram",
      })
      .returning();
    await logActivity({ taskId: task!.id, actorId: user.id, type: "created" });
    const due = task!.dueAt ? ` — 🕑 ${fmtDate(task!.dueAt, tz)}` : "";
    lines.push(`✅ <b>${esc(task!.title)}</b>${due}${projectId ? "" : "  📥 во Входящих"}`);
  }
  await sendMessage(chatId, `${lines.join("\n")}\n\nОткрыть: ${APP_URL}`);
}
