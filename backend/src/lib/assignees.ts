import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";

const ta = schema.taskAssignees;

export interface AssigneeView {
  userId: string | null;
  externalName: string | null;
  displayName: string;
  avatarUrl: string | null;
}

/** Исполнители для набора задач → Map<taskId, AssigneeView[]>. */
export async function loadAssignees(taskIds: string[]): Promise<Map<string, AssigneeView[]>> {
  const map = new Map<string, AssigneeView[]>();
  if (!taskIds.length) return map;
  const rows = await db
    .select({
      taskId: ta.taskId,
      userId: ta.userId,
      externalName: ta.externalName,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(ta)
    .leftJoin(schema.users, eq(schema.users.id, ta.userId))
    .where(inArray(ta.taskId, taskIds));
  for (const r of rows) {
    const arr = map.get(r.taskId) ?? [];
    arr.push({
      userId: r.userId,
      externalName: r.externalName,
      displayName: r.displayName ?? r.externalName ?? "—",
      avatarUrl: r.avatarUrl,
    });
    map.set(r.taskId, arr);
  }
  return map;
}

/** Прикрепить assignees к задачам (для ответов API). */
export async function withAssignees<T extends { id: string }>(tasks: T[]): Promise<(T & { assignees: AssigneeView[] })[]> {
  const map = await loadAssignees(tasks.map((t) => t.id));
  return tasks.map((t) => ({ ...t, assignees: map.get(t.id) ?? [] }));
}

/** Подзапрос id задач, где userId — исполнитель (для фильтров видимости/«мои»). */
export function assignedTaskIds(userId: string) {
  return db.select({ id: ta.taskId }).from(ta).where(eq(ta.userId, userId));
}

/** Является ли userId исполнителем задачи. */
export async function isAssignee(taskId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ta.id })
    .from(ta)
    .where(and(eq(ta.taskId, taskId), eq(ta.userId, userId)))
    .limit(1);
  return !!row;
}

/** Заменить набор исполнителей задачи (внутренние + внешние). */
export async function replaceAssignees(
  tx: { delete: typeof db.delete; insert: typeof db.insert },
  taskId: string,
  userIds: string[],
  externalNames: string[],
): Promise<void> {
  await tx.delete(ta).where(eq(ta.taskId, taskId));
  const rows = [
    ...userIds.map((userId) => ({ taskId, userId })),
    ...externalNames.map((externalName) => ({ taskId, externalName })),
  ];
  if (rows.length) await tx.insert(ta).values(rows);
}
