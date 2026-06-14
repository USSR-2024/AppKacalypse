import { and, asc, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import { assignedTaskIds } from "./assignees.js";
import type { InferSelectModel } from "drizzle-orm";

const t = schema.tasks;
export const SELF = ["я", "мне", "себе", "меня", "me", "self"];

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, "е").trim();
const nameTokens = (s: string): string[] => norm(s).split(/\s+/).filter(Boolean);

// Совпадение слов с учётом русских падежных окончаний: общий префикс
// покрывает почти всё более короткое слово (хвост ≤ окончание). «бондарев»~«бондареву».
function wordSim(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 3) return false;
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i >= min - 2 && i >= 3;
}

export type TaskRow = InferSelectModel<typeof schema.tasks>;

export interface GatewayQuery {
  scope?: string;
  assignee?: string | null;
  project?: string | null;
  important_only?: boolean;
  include_done?: boolean;
}

export interface GatewayResult {
  intent?: string;
  tasks?: Array<Record<string, unknown>>;
  query?: GatewayQuery | null;
  note?: string | null;
  questions?: string[];
  needs_confirmation?: boolean;
}

export function mapPriority(p?: string): "low" | "normal" | "high" {
  if (p === "high" || p === "critical") return "high";
  if (p === "low") return "low";
  return "normal";
}

/** Вызов LLM Gateway. Бросает при недоступности. */
export async function gatewayExtract(text: string, author?: string): Promise<GatewayResult> {
  const res = await fetch(`${env.GATEWAY_URL}/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, source: "app", author, now_iso: new Date().toISOString() }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`gateway ${res.status}`);
  return (await res.json()) as GatewayResult;
}

export interface Resolvers {
  resolveProject: (name?: string | null) => string | null;
  resolveAssignee: (name?: string | null) => string | null;
}

/** Загружает справочники юзеров/проектов и резолверы имён → id. */
export async function loadResolvers(meId?: string, meName?: string): Promise<Resolvers> {
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
    const n = norm(name);
    if (SELF.includes(n) || (meName && n === norm(meName))) return meId ?? null;
    const exact = users.find((x) => norm(x.displayName) === n);
    if (exact) return exact.id;
    // Падежи: «поставь Александру Бондареву» → ищем «Александр Бондарев».
    // Каждый токен запроса должен совпасть (с учётом окончаний) с токеном имени.
    const qt = nameTokens(name);
    if (!qt.length) return null;
    let best: { id: string; score: number } | null = null;
    for (const u of users) {
      const ut = nameTokens(u.displayName);
      const score = qt.reduce((s, q) => s + (ut.some((w) => wordSim(q, w)) ? 1 : 0), 0);
      if (score === qt.length && (!best || score > best.score)) best = { id: u.id, score };
    }
    return best?.id ?? null;
  };
  return { resolveProject, resolveAssignee };
}

/** Выполняет запрос query_tasks → список задач. */
export async function runTaskQuery(meId: string, q: GatewayQuery, r: Resolvers): Promise<TaskRow[]> {
  const conds = [];
  const assigneeFilter = q.assignee ? r.resolveAssignee(q.assignee) : null;
  const projectFilter = q.project ? r.resolveProject(q.project) : null;

  if (assigneeFilter) conds.push(inArray(t.id, assignedTaskIds(assigneeFilter)));
  else if (!projectFilter) conds.push(or(eq(t.controllerId, meId), inArray(t.id, assignedTaskIds(meId)))!);

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

  return db
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(desc(t.isImportant), asc(t.dueAt), desc(t.priority))
    .limit(50);
}

export function queryAnswer(scope: string | undefined, n: number): string {
  const labels: Record<string, string> = { today: "на сегодня", overdue: "просроченных", week: "на неделю", important: "важных" };
  const flavor = scope && labels[scope] ? ` ${labels[scope]}` : "";
  return n === 0 ? "Ничего не нашёл по этому запросу." : `Нашёл ${n}${flavor}:`;
}

/** Черновик задачи из gateway-таска (для веб-чата). */
export function draftFromTask(task: Record<string, unknown>, r: Resolvers) {
  return {
    title: String(task.title ?? ""),
    description: String(task.description ?? ""),
    projectId: r.resolveProject(task.project as string | null),
    projectName: (task.project as string | null) ?? null,
    assigneeId: r.resolveAssignee(task.assignee as string | null),
    assigneeName: (task.assignee as string | null) ?? null,
    dueAt: (task.due_iso as string | null) ?? null,
    dueText: (task.due_text as string | null) ?? null,
    priority: mapPriority(task.priority as string | undefined),
    needsConfirmation: (task.needs_confirmation as boolean) ?? true,
  };
}
