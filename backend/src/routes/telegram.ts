import { Hono } from "hono";
import { env } from "../lib/env.js";
import { db, schema } from "../db/index.js";
import { processUpdate } from "../lib/telegram-bot.js";

export const telegramRoutes = new Hono();

function authed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  if (!env.TELEGRAM_WEBHOOK_SECRET) return true;
  return c.req.header("X-Telegram-Bot-Api-Secret-Token") === env.TELEGRAM_WEBHOOK_SECRET;
}

/** POST /api/telegram/webhook — приём апдейта (релей вне РФ форвардит сюда апдейты Telegram). */
telegramRoutes.post("/webhook", async (c) => {
  if (!authed(c)) return c.json({ ok: false }, 401);
  const update = await c.req.json().catch(() => null);
  // Отвечаем сразу 200, обработку (вызов Qwen ~5с) делаем в фоне.
  if (update) processUpdate(update).catch((e) => console.error("bot error:", e));
  return c.json({ ok: true });
});

/**
 * GET /api/telegram/outbox — релей забирает исходящие. Zero-retention: строки сразу
 * удаляются (delete-returning), тела ответов не хранятся в БД дольше доставки.
 */
telegramRoutes.get("/outbox", async (c) => {
  if (!authed(c)) return c.json({ ok: false }, 401);
  const rows = await db
    .delete(schema.tgOutbox)
    .returning({ chatId: schema.tgOutbox.chatId, body: schema.tgOutbox.body, createdAt: schema.tgOutbox.createdAt });
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const messages = rows.map(({ chatId, body }) => ({ chatId, body }));
  return c.json({ messages });
});
