import { Hono } from "hono";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { sendPush } from "../lib/push.js";
import { env } from "../lib/env.js";

export const broadcastRoutes = new Hono();
broadcastRoutes.use("*", requireAuth);

const cl = schema.changelog;
const isPriv = (role: string) => role === "owner" || role === "admin";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── история рассылок ────────────────────────────────────────────────────────────
broadcastRoutes.get("/", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);
  const rows = await db
    .select({
      id: schema.broadcasts.id,
      title: schema.broadcasts.title,
      body: schema.broadcasts.body,
      channels: schema.broadcasts.channels,
      recipientCount: schema.broadcasts.recipientCount,
      createdAt: schema.broadcasts.createdAt,
      senderName: schema.users.displayName,
    })
    .from(schema.broadcasts)
    .innerJoin(schema.users, eq(schema.users.id, schema.broadcasts.senderId))
    .orderBy(desc(schema.broadcasts.createdAt))
    .limit(50);
  return c.json(rows);
});

// ── журнал изменений (неуведомлённые) ───────────────────────────────────────────
broadcastRoutes.get("/changelog", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);
  const rows = await db.select().from(cl).where(isNull(cl.announcedAt)).orderBy(desc(cl.createdAt));
  return c.json(rows);
});

broadcastRoutes.post("/changelog", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);
  const p = z.object({ text: z.string().min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "bad_request" }, 400);
  const [row] = await db.insert(cl).values({ text: p.data.text }).returning();
  return c.json(row, 201);
});

broadcastRoutes.delete("/changelog/:id", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);
  await db.delete(cl).where(eq(cl.id, c.req.param("id")));
  return c.json({ ok: true });
});

// ── черновик уведомления из неуведомлённых изменений (через LLM-шлюз) ─────────────
broadcastRoutes.post("/draft", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);

  const entries = await db.select({ text: cl.text }).from(cl).where(isNull(cl.announcedAt)).orderBy(cl.createdAt);
  const body = await c.req.json().catch(() => ({}));
  const extra: string[] = Array.isArray(body?.changes) ? body.changes.filter((x: unknown) => typeof x === "string") : [];
  const changes = [...entries.map((e) => e.text), ...extra];
  if (!changes.length) return c.json({ error: "no_changes" }, 400);

  try {
    const res = await fetch(`${env.GATEWAY_URL}/announce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return c.json({ error: "llm_unavailable" }, 502);
    const draft = (await res.json()) as { title?: string; body?: string };
    return c.json({ title: draft.title ?? "🚀 Обновление", body: draft.body ?? "", changeCount: changes.length });
  } catch {
    return c.json({ error: "llm_unavailable" }, 502);
  }
});

// ── рассылка (selfOnly=превью себе; иначе всем активным) ─────────────────────────
broadcastRoutes.post("/", async (c) => {
  const me = c.get("user");
  if (!isPriv(me.role)) return c.json({ error: "forbidden" }, 403);

  const p = z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
    channels: z.array(z.enum(["telegram", "push"])).min(1),
    selfOnly: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "bad_request" }, 400);
  const { title, body, channels, selfOnly } = p.data;

  let recipientIds: string[];
  if (selfOnly) {
    recipientIds = [me.sub];
  } else {
    const active = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isActive, true));
    recipientIds = active.map((u) => u.id);
  }
  if (!recipientIds.length) return c.json({ ok: true, recipients: 0, telegram: 0 });

  const html = `<b>${esc(title)}</b>\n\n${esc(body)}`;
  let telegram = 0;

  if (channels.includes("telegram")) {
    const idents = await db
      .select({ externalId: schema.authIdentities.externalId })
      .from(schema.authIdentities)
      .where(and(eq(schema.authIdentities.provider, "telegram"), inArray(schema.authIdentities.userId, recipientIds)));
    if (idents.length) {
      await db.insert(schema.tgOutbox).values(idents.map((i) => ({ chatId: i.externalId, body: html })));
      telegram = idents.length;
    }
  }
  if (channels.includes("push")) {
    await sendPush(recipientIds, { title, body: body.slice(0, 180), url: "/today" });
  }

  if (!selfOnly) {
    await db.insert(schema.broadcasts).values({ title, body, senderId: me.sub, channels, recipientCount: recipientIds.length });
    // Все неуведомлённые изменения теперь считаются объявленными.
    await db.update(cl).set({ announcedAt: new Date() }).where(isNull(cl.announcedAt));
  }
  return c.json({ ok: true, recipients: recipientIds.length, telegram }, selfOnly ? 200 : 201);
});
