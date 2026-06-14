import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { sendPush } from "../lib/push.js";

export const broadcastRoutes = new Hono();
broadcastRoutes.use("*", requireAuth);

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
  }
  return c.json({ ok: true, recipients: recipientIds.length, telegram }, selfOnly ? 200 : 201);
});
