import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { env } from "../lib/env.js";

export const pushRoutes = new Hono();

// Публичный VAPID-ключ для подписки во фронте (публичное значение, без авторизации).
pushRoutes.get("/key", (c) => c.json({ key: env.VAPID_PUBLIC_KEY }));

pushRoutes.use("*", requireAuth);

pushRoutes.post("/subscribe", async (c) => {
  const u = c.get("user");
  const p = z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "bad_request" }, 400);

  await db.insert(schema.pushSubscriptions).values({
    userId: u.sub,
    endpoint: p.data.endpoint,
    p256dh: p.data.keys.p256dh,
    auth: p.data.keys.auth,
  }).onConflictDoUpdate({
    target: schema.pushSubscriptions.endpoint,
    set: { userId: u.sub, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth },
  });
  return c.json({ ok: true }, 201);
});

pushRoutes.post("/unsubscribe", async (c) => {
  const u = c.get("user");
  const p = z.object({ endpoint: z.string().url() }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "bad_request" }, 400);
  await db.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.endpoint, p.data.endpoint), eq(schema.pushSubscriptions.userId, u.sub)));
  return c.json({ ok: true });
});
