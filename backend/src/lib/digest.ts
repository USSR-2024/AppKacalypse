import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { formatTaskList } from "./telegram-bot.js";
import type { TaskRow } from "./assistant-core.js";

const t = schema.tasks;

function dayBounds(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function activeTasks(userId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(t)
    .where(and(eq(t.assigneeId, userId), inArray(t.status, ["queued", "in_progress"])))
    .limit(300);
}

/** Утренний дайджест: просрочено + сегодня + важное. null если пусто. */
export async function morningDigest(userId: string, tz: string): Promise<string | null> {
  const now = new Date();
  const { start, end } = dayBounds(now);
  const tasks = await activeTasks(userId);
  const due = (x: TaskRow) => (x.dueAt ? new Date(x.dueAt) : null);

  const overdue = tasks.filter((x) => { const d = due(x); return d && d < start; });
  const today = tasks.filter((x) => { const d = due(x); return d && d >= start && d <= end; });
  const important = tasks.filter((x) => x.isImportant && !overdue.includes(x) && !today.includes(x));

  if (!overdue.length && !today.length && !important.length) return null;

  const parts = ["🌅 <b>Доброе утро!</b>"];
  if (overdue.length) parts.push(`\n🔴 Просрочено (${overdue.length}):\n${formatTaskList(overdue, tz)}`);
  if (today.length) parts.push(`\n📅 Сегодня (${today.length}):\n${formatTaskList(today, tz)}`);
  if (important.length) parts.push(`\n⭐ Важное (${important.length}):\n${formatTaskList(important, tz)}`);
  return parts.join("\n");
}

/** Вечерний итог: сделано сегодня + осталось + завтра + просрочено. */
export async function eveningDigest(userId: string, tz: string): Promise<string | null> {
  const now = new Date();
  const { start, end } = dayBounds(now);
  const tomorrowEnd = new Date(end.getTime() + 86400000);

  const tasks = await activeTasks(userId);
  const due = (x: TaskRow) => (x.dueAt ? new Date(x.dueAt) : null);
  const overdue = tasks.filter((x) => { const d = due(x); return d && d < start; });
  const tomorrow = tasks.filter((x) => { const d = due(x); return d && d > end && d <= tomorrowEnd; });

  // выполненные сегодня
  const doneToday = await db
    .select()
    .from(t)
    .where(and(eq(t.assigneeId, userId), eq(t.status, "done")))
    .limit(300)
    .then((rows) => rows.filter((x) => x.completedAt && new Date(x.completedAt) >= start && new Date(x.completedAt) <= end));

  const parts = ["🌙 <b>Итоги дня</b>", `✅ Выполнено сегодня: ${doneToday.length}`, `📋 Осталось активных: ${tasks.length}`];
  if (tomorrow.length) parts.push(`\n📅 На завтра (${tomorrow.length}):\n${formatTaskList(tomorrow, tz)}`);
  if (overdue.length) parts.push(`\n🔴 Просрочено (${overdue.length}):\n${formatTaskList(overdue, tz)}`);
  return parts.join("\n");
}
