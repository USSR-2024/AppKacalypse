import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { env } from "../lib/env.js";

export const assistantRoutes = new Hono();
assistantRoutes.use("*", requireAuth);

const SELF = ["я", "мне", "себе", "меня", "me", "self"];

function mapPriority(p?: string): "low" | "normal" | "high" {
  if (p === "high" || p === "critical") return "high";
  if (p === "low") return "low";
  return "normal";
}

/** POST /api/assistant/extract — разбор сообщения через Qwen → черновики задач. */
assistantRoutes.post("/extract", async (c) => {
  const u = c.get("user");
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_request" }, 400);

  const [me] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, u.sub))
    .limit(1);

  let result: {
    intent?: string;
    tasks?: Array<Record<string, unknown>>;
    note?: string | null;
    questions?: string[];
    needs_confirmation?: boolean;
  };
  try {
    const res = await fetch(`${env.GATEWAY_URL}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: parsed.data.text,
        source: "app",
        author: me?.displayName,
        now_iso: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    result = (await res.json()) as typeof result;
  } catch {
    return c.json({
      intent: "error",
      drafts: [],
      questions: [],
      note: null,
      reply: "Модель сейчас недоступна — не смог разобрать. Попробуй ещё раз через минуту.",
    });
  }

  const users = await db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users);
  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.isArchived, false));

  const resolveProject = (name?: string | null): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    const p =
      projects.find((x) => x.name.toLowerCase() === n) ||
      projects.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
    return p?.id ?? null;
  };
  const resolveAssignee = (name?: string | null): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    if (SELF.includes(n) || (me && n === me.displayName.toLowerCase())) return me?.id ?? null;
    const usr =
      users.find((x) => x.displayName.toLowerCase() === n) ||
      users.find((x) => x.displayName.toLowerCase().includes(n) || n.includes(x.displayName.toLowerCase()));
    return usr?.id ?? null;
  };

  const drafts = (result.tasks ?? []).map((t) => ({
    title: String(t.title ?? ""),
    description: String(t.description ?? ""),
    projectId: resolveProject(t.project as string | null),
    projectName: (t.project as string | null) ?? null,
    assigneeId: resolveAssignee(t.assignee as string | null),
    assigneeName: (t.assignee as string | null) ?? null,
    dueAt: (t.due_iso as string | null) ?? null,
    dueText: (t.due_text as string | null) ?? null,
    priority: mapPriority(t.priority as string | undefined),
    needsConfirmation: (t.needs_confirmation as boolean) ?? true,
  }));

  return c.json({
    intent: result.intent ?? "no_action",
    note: result.note ?? null,
    questions: result.questions ?? [],
    needsConfirmation: result.needs_confirmation ?? true,
    drafts,
  });
});
