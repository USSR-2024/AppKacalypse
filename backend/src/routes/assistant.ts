import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../lib/auth-middleware.js";
import { gatewayExtract, loadResolvers, runTaskQuery, queryAnswer, draftFromTask } from "../lib/assistant-core.js";

export const assistantRoutes = new Hono();
assistantRoutes.use("*", requireAuth);

assistantRoutes.post("/extract", async (c) => {
  const u = c.get("user");
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "bad_request" }, 400);

  const [me] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, u.sub))
    .limit(1);

  let result;
  try {
    result = await gatewayExtract(parsed.data.text, me?.displayName);
  } catch {
    return c.json({ intent: "error", drafts: [], tasks: [], questions: [], note: null, reply: "Модель сейчас недоступна — попробуй ещё раз через минуту." });
  }

  const resolvers = await loadResolvers(me?.id, me?.displayName);

  if (result.intent === "query_tasks" && me) {
    const tasks = await runTaskQuery(me.id, result.query ?? {}, resolvers);
    return c.json({ intent: "query_tasks", answer: queryAnswer(result.query?.scope, tasks.length), tasks, drafts: [], questions: [] });
  }

  const drafts = (result.tasks ?? []).map((task) => draftFromTask(task, resolvers));

  // Доспрос по незаполненным полям карточки (детерминированно, не полагаясь на LLM).
  const questions: string[] = [];
  if (drafts.length) {
    const need = { assignee: false, due: false, project: false };
    for (const d of drafts) {
      if (!d.assigneeId && !d.assigneeName) need.assignee = true;
      if (!d.dueAt && !d.dueText) need.due = true;
      if (!d.projectId && !d.projectName) need.project = true;
    }
    if (need.assignee) questions.push("кто исполнитель?");
    if (need.due) questions.push("к какому сроку?");
    if (need.project) questions.push("в какой проект (или это личная задача)?");
  }
  questions.push(...(result.questions ?? []));

  return c.json({
    intent: result.intent ?? "no_action",
    note: result.note ?? null,
    questions,
    needsConfirmation: result.needs_confirmation ?? true,
    drafts,
    tasks: [],
  });
});
