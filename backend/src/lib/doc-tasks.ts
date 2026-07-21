import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

// Мост «Документы → Задачи» (M2). Согласование не должно жить только в модуле на
// десктопе: как только документ падает на человека, ему создаётся ЛИЧНАЯ задача во
// «Входящих» (isTriaged=false). Задача СИСТЕМНАЯ (document_id != null) — руками её не
// закрыть (гейт в routes/tasks.ts), гасит только сам движок согласования отсюда.
//
// Три вида:
//  • трекинг-задача инициатора — «провести согласование до конца» (documents.approval_task_id);
//  • задача согласующего на активный шаг (route_steps.task_id);
// Закрытие: шаг решён → его задача done; маршрут пройден → трекинг done; возврат на
// корректировку → незакрытые задачи-шаги cancelled, трекинг остаётся (инициатор правит).

/** db или транзакция — мост зовётся только внутри транзакции движка. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const T = schema.tasks;
const TA = schema.taskAssignees;
const RS = schema.routeSteps;
const RI = schema.routeInstances;
const DOC = schema.documents;

export interface DocMeta {
  workspaceId: string;
  documentId: string;
  docTitle: string;
  registryNumber: string | null;
  authorId: string;
  dueAt: Date | null;
}

const OPEN = ['queued', 'in_progress'] as const;

/** Создать личную задачу-мост во «Входящие». Возвращает id. */
async function createBridge(
  tx: Db,
  a: { workspaceId: string; documentId: string; title: string; description: string; assigneeId: string; controllerId: string; creatorId: string; dueAt: Date | null },
): Promise<string> {
  const [task] = await tx.insert(T).values({
    workspaceId: a.workspaceId,
    title: a.title,
    description: a.description,
    creatorId: a.creatorId,      // системная задача от имени инициатора
    controllerId: a.controllerId,
    documentId: a.documentId,
    status: 'queued',
    isTriaged: false,           // ← падает во «Входящие»
    dueAt: a.dueAt,
  }).returning({ id: T.id });
  await tx.insert(TA).values({ taskId: task!.id, userId: a.assigneeId });
  return task!.id;
}

/** Завершить задачу (только если ещё открыта). isTriaged=true — уходит из «Входящих». */
async function complete(tx: Db, taskId: string): Promise<void> {
  await tx.update(T)
    .set({ status: 'done', completedAt: new Date(), isTriaged: true, updatedAt: new Date() })
    .where(and(eq(T.id, taskId), inArray(T.status, [...OPEN])));
}

/**
 * Открыть трекинг-задачу инициатора при отправке на согласование. При повторной
 * отправке (после rework) прежняя трекинг-задача ещё открыта — переиспользуем её,
 * второй не плодим.
 */
export async function openTrackingTask(tx: Db, m: DocMeta): Promise<void> {
  const [d] = await tx.select({ taskId: DOC.approvalTaskId }).from(DOC).where(eq(DOC.id, m.documentId)).limit(1);
  if (d?.taskId) {
    const [old] = await tx.select({ status: T.status }).from(T).where(eq(T.id, d.taskId)).limit(1);
    if (old && (OPEN as readonly string[]).includes(old.status)) return;   // уже висит — не дублируем
  }
  const num = m.registryNumber ? `${m.registryNumber} · ` : '';
  const taskId = await createBridge(tx, {
    workspaceId: m.workspaceId,
    documentId: m.documentId,
    title: `Провести согласование: ${m.docTitle}`,
    description: `${num}Документ на согласовании. Задача закроется, когда маршрут будет пройден.`,
    assigneeId: m.authorId,
    controllerId: m.authorId,    // трекингом владеет инициатор
    creatorId: m.authorId,
    dueAt: m.dueAt,
  });
  await tx.update(DOC).set({ approvalTaskId: taskId }).where(eq(DOC.id, m.documentId));
}

/**
 * Создать задачи согласующим для всех активных шагов текущего маршрута, у которых
 * задачи ещё нет. Идемпотентно (isNull(task_id)) — безопасно звать после каждой
 * активации стадии. Инициатору задачу-шаг не создаём: у него уже трекинг-задача.
 */
export async function openStepTasks(tx: Db, m: DocMeta): Promise<void> {
  const steps = await tx
    .select({ id: RS.id, assigneeId: RS.assigneeId })
    .from(RS).innerJoin(RI, eq(RI.id, RS.routeInstanceId))
    .where(and(eq(RI.documentId, m.documentId), eq(RI.status, 'running'), eq(RS.status, 'active'), isNull(RS.taskId)));
  const num = m.registryNumber ? `${m.registryNumber} · ` : '';
  for (const s of steps) {
    if (!s.assigneeId || s.assigneeId === m.authorId) continue;
    const taskId = await createBridge(tx, {
      workspaceId: m.workspaceId,
      documentId: m.documentId,
      title: `Согласовать: ${m.docTitle}`,
      description: `${num}Вас назначили согласующим. Задача закроется сама, когда вы согласуете или вернёте документ.`,
      assigneeId: s.assigneeId,
      controllerId: m.authorId,    // контролирует инициатор (оверсайт хода согласования)
      creatorId: m.authorId,
      dueAt: m.dueAt,
    });
    await tx.update(RS).set({ taskId }).where(eq(RS.id, s.id));
  }
}

/** Шаг решён (согласовал/вернул) → его задача-мост done. */
export async function closeStepTask(tx: Db, stepId: string): Promise<void> {
  const [s] = await tx.select({ taskId: RS.taskId }).from(RS).where(eq(RS.id, stepId)).limit(1);
  if (s?.taskId) await complete(tx, s.taskId);
}

/** Незакрытые задачи-шаги маршрута → cancelled (круг оборвался возвратом). */
export async function cancelOpenStepTasks(tx: Db, routeId: string): Promise<void> {
  const steps = await tx.select({ taskId: RS.taskId }).from(RS).where(eq(RS.routeInstanceId, routeId));
  const ids = steps.map((s) => s.taskId).filter((x): x is string => !!x);
  if (ids.length) {
    await tx.update(T)
      .set({ status: 'cancelled', isTriaged: true, updatedAt: new Date() })   // уходит из «Входящих»
      .where(and(inArray(T.id, ids), inArray(T.status, [...OPEN])));
  }
}

/** Маршрут пройден → трекинг-задача инициатора done. (M3: перенести на «подписан».) */
export async function closeTrackingTask(tx: Db, documentId: string): Promise<void> {
  const [d] = await tx.select({ taskId: DOC.approvalTaskId }).from(DOC).where(eq(DOC.id, documentId)).limit(1);
  if (d?.taskId) await complete(tx, d.taskId);
}

/** Удаление карточки → удалить ВСЕ задачи-мосты документа целиком (иначе повиснут во
 * «Входящих» и будут указывать на несуществующий документ). Звать ДО delete карточки:
 * пока route_steps ещё живы, их FK task_id занулится без конфликта с каскадом. */
export async function purgeDocTasks(tx: Db, documentId: string): Promise<void> {
  await tx.delete(T).where(eq(T.documentId, documentId));   // task_assignees уйдут каскадом
}
