import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import { sendMessage } from "./telegram-bot.js";
import { sendPush } from "./push.js";

const APP_URL = env.PUBLIC_APP_URL;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Уведомить юзера, что его назначили главой (admin) пространства. Канал — Telegram
 * (доходит, если сделал /start боту). Вызывать только при ПОВЫШЕНии до admin.
 */
export async function notifyAdminGranted(userId: string, workspaceId: string): Promise<void> {
  const [w] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!w) return;
  const [ident] = await db
    .select({ externalId: schema.authIdentities.externalId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), eq(schema.authIdentities.userId, userId)))
    .limit(1);
  if (!ident) return;
  await sendMessage(
    ident.externalId,
    `🎖 Тебя назначили <b>главой</b> пространства «${esc(w.name)}».\n\n` +
      `Теперь можешь приглашать людей и одобрять заявки:\n` +
      `• в приложении → «Участники пространства»\n` +
      `• в боте → /invite (ссылка-приглашение) и /pending (заявки)`,
  );
}

/** Путь к задаче внутри её воркспейса: /<slug>/tasks/<id>. Slug берём из задачи. */
async function taskPath(taskId: string): Promise<string> {
  const [row] = await db
    .select({ slug: schema.workspaces.slug })
    .from(schema.tasks)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.tasks.workspaceId))
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  return row ? `/${row.slug}/tasks/${taskId}` : `/tasks/${taskId}`;
}

/**
 * Уведомить упомянутых в комментарии (@упоминание). Канал — Telegram (push отложен).
 * Доходит только тем, кто сделал /start боту (ограничение Telegram).
 */
export async function notifyMentions(
  taskId: string,
  taskTitle: string,
  authorName: string,
  body: string,
  mentionUserIds: string[],
  authorId: string,
): Promise<void> {
  const targets = mentionUserIds.filter((id) => id !== authorId);
  if (!targets.length) return;

  const idents = await db
    .select({ externalId: schema.authIdentities.externalId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), inArray(schema.authIdentities.userId, targets)));

  const snippet = body.length > 200 ? body.slice(0, 200) + "…" : body;
  const path = await taskPath(taskId);
  const text =
    `💬 <b>${esc(authorName)}</b> упомянул вас в задаче «${esc(taskTitle)}»:\n` +
    `${esc(snippet)}\n\nОткрыть: ${APP_URL}${path}`;

  for (const i of idents) {
    await sendMessage(i.externalId, text);
  }

  // Push в приложение (для тех, у кого включён канал push).
  await sendPush(targets, {
    title: `💬 ${authorName}`,
    body: `${taskTitle}: ${snippet}`,
    url: path,
  });
}

/**
 * Уведомить исполнителей о поставленной задаче. Каналы — Telegram + push.
 * assignerId исключается (не уведомляем того, кто сам назначил/создал).
 */
export async function notifyAssigned(
  taskId: string,
  taskTitle: string,
  assignerName: string,
  assigneeUserIds: string[],
  assignerId: string,
): Promise<void> {
  const targets = [...new Set(assigneeUserIds)].filter((id) => id && id !== assignerId);
  if (!targets.length) return;

  const idents = await db
    .select({ externalId: schema.authIdentities.externalId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), inArray(schema.authIdentities.userId, targets)));

  const path = await taskPath(taskId);
  const text =
    `📌 <b>${esc(assignerName)}</b> поставил вам задачу:\n` +
    `«${esc(taskTitle)}»\n\nОзнакомьтесь: ${APP_URL}${path}`;

  for (const i of idents) {
    await sendMessage(i.externalId, text);
  }

  await sendPush(targets, {
    title: "📌 Новая задача",
    body: `${assignerName}: ${taskTitle}`,
    url: path,
  });
}
