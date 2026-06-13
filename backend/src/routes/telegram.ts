import { Hono } from "hono";
import { env } from "../lib/env.js";
import { processUpdate } from "../lib/telegram-bot.js";

export const telegramRoutes = new Hono();

/** POST /api/telegram/webhook — приём апдейтов от Telegram. */
telegramRoutes.post("/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ ok: false }, 401);
  }
  const update = await c.req.json().catch(() => null);
  // Отвечаем сразу 200, обработку (вызов Qwen ~5с) делаем в фоне — Telegram не любит долгий ответ.
  if (update) processUpdate(update).catch((e) => console.error("bot error:", e));
  return c.json({ ok: true });
});
