import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { env } from "../lib/env.js";

export const assistantRoutes = new Hono();
assistantRoutes.use("*", requireAuth);

const t = schema.tasks;
const SELF = ["я", "мне", "себе", "меня", "me", "self"];

function mapPriority(p?: string): "low" | "normal" | "high" {
  if (p === "high" || p === "critical") return "high";
  if (p === "low") return "low";
  return "normal";
}

interface GatewayResult {
  intent?: string;
  tasks?: Array<Record<string, unknown>>;
  query?: {
    scope?: string;
    assignee?: string | null;
    project?: string | null;
    important_only?: boolean;
    include_done?: boolean;
  } | null;
  note?: string | null;
  questions?: string[];
  needs_confirmation?: boolean;
}

assistantRoutes.post("/extract", async (c) => {
  const u = c.get("user");
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_request" }, 400);

  const [me] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, u.sub))
    .limit(1);

  let result: GatewayResult;
  try {
    const res = await fetch(`${env.GATEWAY_URL}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: parsed.data.text, source: "app", author: me?.displayName, now_iso: new Date().toISOString() }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`gateway ${res.status}`);
    result = (await res.json()) as GatewayResult;
  } catch {
    return c.json({
      intent: "error",
      drafts: [],
      tasks: [],
      questions: [],
      note: null,
      reply: "Модель сейчас недоступна — попробуй ещё раз через минуту.",
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
    const p = projects.find((x) => x.name.toLowerCase() === n) || projects.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
    return p?.id ?? null;
  };
  const resolveAssignee = (name?: string | null): string | null => {
    if (!name) return null;
    const n = name.toLowerCase().trim();
    if (SELF.includes(n) || (me && n === me.displayName.toLowerCase())) return me?.id ?? null;
    const usr = users.find((x) => x.displayName.toLowerCase() === n) || users.find((x) => x.displayName.toLowerCase().includes(n) || n.includes(x.displayName.toLowerCase()));
    return usr?.id ?? null;
  };

  // ── ВОПРОС о задачах ───────────────────────────────────────────────────────
  if (result.intent === "query_tasks") {
    const q = result.query ?? {};
    const conds = [];
    const assigneeFilter = q.assignee ? resolveAssignee(q.assignee) : null;
    const projectFilter = q.project ? resolveProject(q.project) : null;

    if (assigneeFilter) conds.push(eq(t.assigneeId, assigneeFilter));
    else if (!projectFilter && me) conds.push(eq(t.assigneeId, me.id)); // по умолчанию — мои

    if (projectFilter) conds.push(eq(t.projectId, projectFilter));
    if (q.important_only || q.scope === "important") conds.push(eq(t.isImportant, true));
    if (!q.include_done) conds.push(inArray(t.status, ["queued", "in_progress"]));

    const now = new Date();
    if (q.scope === "today") {
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      conds.push(isNotNull(t.dueAt), lte(t.dueAt, end));
    } else if (q.scope === "overdue") {
      conds.push(isNotNull(t.dueAt), lte(t.dueAt, now));
    } else if (q.scope === "week") {
      conds.push(isNotNull(t.dueAt), lte(t.dueAt, new Date(now.getTime() + 7 * 86400000)));
    }

    const rows = await db
      .select()
      .from(t)
      .where(and(...conds))
      .orderBy(desc(t.isImportant), asc(t.dueAt), desc(t.priority))
      .limit(50);

    const labels: Record<string, string> = { today: "на сегодня", overdue: "просроченных", week: "на неделю", important: "важных" };
    const flavor = labels[q.scope ?? "all"] ? ` ${labels[q.scope ?? "all"]}` : "";
    const answer = rows.length === 0 ? "Ничего не нашёл по этому запросу." : `Нашёл ${rows.length}${flavor}:`;

    return c.json({ intent: "query_tasks", answer, tasks: rows, drafts: [], questions: [] });
  }

  // ── СОЗДАНИЕ задач ──────────────────────────────────────────────────────────
  const drafts = (result.tasks ?? []).map((task) => ({
    title: String(task.title ?? ""),
    description: String(task.description ?? ""),
    projectId: resolveProject(task.project as string | null),
    projectName: (task.project as string | null) ?? null,
    assigneeId: resolveAssignee(task.assignee as string | null),
    assigneeName: (task.assignee as string | null) ?? null,
    dueAt: (task.due_iso as string | null) ?? null,
    dueText: (task.due_text as string | null) ?? null,
    priority: mapPriority(task.priority as string | undefined),
    needsConfirmation: (task.needs_confirmation as boolean) ?? true,
  }));

  return c.json({
    intent: result.intent ?? "no_action",
    note: result.note ?? null,
    questions: result.questions ?? [],
    needsConfirmation: result.needs_confirmation ?? true,
    drafts,
    tasks: [],
  });
});
