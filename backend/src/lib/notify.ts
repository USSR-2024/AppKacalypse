import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { sendMessage } from "./telegram-bot.js";

const APP_URL = "https://appkacalypse.baassist.ru";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const text =
    `💬 <b>${esc(authorName)}</b> упомянул вас в задаче «${esc(taskTitle)}»:\n` +
    `${esc(snippet)}\n\nОткрыть: ${APP_URL}/tasks/${taskId}`;

  for (const i of idents) {
    await sendMessage(i.externalId, text);
  }
}
