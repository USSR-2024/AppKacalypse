import { db, schema } from '../db/index.js';

type ActivityType = 'created' | 'status_changed' | 'assigned' | 'edited' | 'commented' | 'triaged';

/** Запись в лог активности задачи. actorId null = система/AI. */
export async function logActivity(v: {
  taskId: string;
  actorId: string | null;
  type: ActivityType;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.taskActivity).values({
    taskId: v.taskId,
    actorId: v.actorId,
    type: v.type,
    payload: v.payload ?? {},
  });
}
