import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logDoc } from './dms.js';

/** db или транзакция — движок зовётся и так, и так. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Движок маршрута согласования. Намеренно небогатый (ТЗ, план фаза 3): пока
// ЛИНЕЙНАЯ цепочка КОНКРЕТНЫХ людей, назначенных вручную при отправке. Автосборку
// из матрицы по типу подключит фаза 2/3 — она заменит только источник списка
// согласующих, а модель шагов/решений остаётся этой же.
//
// Один активный шаг на документ (следующий активируется, когда предыдущий согласовал).
// Экземпляр маршрута = СНИМОК: список согласующих кладём в definition, чтобы правка
// справочников не ломала идущее согласование (план, решение 7).

const ri = schema.routeInstances;
const rs = schema.routeSteps;

export interface ApproverInput {
  userId: string;
  name: string;
}

/**
 * Запустить маршрут: снимок definition + последовательные шаги, первый активен.
 * Зовётся внутри транзакции перехода на согласование. Итерация растёт с каждым
 * новым кругом (после возврата на корректировку и повторной отправки).
 */
export async function startRoute(
  tx: Db,
  a: { workspaceId: string; documentId: string; approvers: ApproverInput[]; actorId: string },
): Promise<{ routeId: string; firstAssignee: ApproverInput }> {
  const [prev] = await tx
    .select({ it: ri.iteration })
    .from(ri)
    .where(eq(ri.documentId, a.documentId))
    .orderBy(desc(ri.iteration))
    .limit(1);
  const iteration = (prev?.it ?? 0) + 1;

  const [inst] = await tx
    .insert(ri)
    .values({
      documentId: a.documentId,
      definition: { mode: 'manual', approvers: a.approvers },
      status: 'running',
      currentStage: 1,
      iteration,
    })
    .returning({ id: ri.id });

  await tx.insert(rs).values(
    a.approvers.map((ap, i) => ({
      routeInstanceId: inst!.id,
      assigneeId: ap.userId,
      stageNo: i + 1,
      isRequired: true,
      status: (i === 0 ? 'active' : 'pending') as 'active' | 'pending',
      activatedAt: i === 0 ? new Date() : null,
    })),
  );

  await logDoc(tx, {
    workspaceId: a.workspaceId,
    documentId: a.documentId,
    entity: 'route_step',
    entityId: inst!.id,
    actorId: a.actorId,
    action: 'route_started',
    payload: { iteration, approvers: a.approvers.map((x) => x.name) },
  });

  return { routeId: inst!.id, firstAssignee: a.approvers[0]! };
}

/** Активный шаг документа с данными его маршрута (для проверки прав и решения). */
export async function activeStepFor(documentId: string): Promise<{
  stepId: string;
  routeId: string;
  stageNo: number;
  assigneeId: string | null;
} | null> {
  const [row] = await db
    .select({ stepId: rs.id, routeId: ri.id, stageNo: rs.stageNo, assigneeId: rs.assigneeId })
    .from(rs)
    .innerJoin(ri, eq(ri.id, rs.routeInstanceId))
    .where(and(eq(ri.documentId, documentId), eq(ri.status, 'running'), eq(rs.status, 'active')))
    .limit(1);
  return row ?? null;
}

/**
 * Согласовать текущий шаг. Фиксируем, на КАКОЙ версии согласовано (decided_version_id) —
 * без этого нельзя ответить «изменился ли документ после согласования Иванова» и
 * невозможна политика повторного согласования. Дальше активируем следующий шаг, а
 * если шагов больше нет — весь маршрут согласован, документ переходит в approved.
 */
export async function approveStep(
  tx: Db,
  a: {
    workspaceId: string;
    documentId: string;
    routeId: string;
    stepId: string;
    stageNo: number;
    currentVersionId: string | null;
    actorId: string;
    comment?: string | null;
  },
): Promise<{ finished: boolean }> {
  await tx
    .update(rs)
    .set({ status: 'approved', decidedVersionId: a.currentVersionId, decidedAt: new Date() })
    .where(eq(rs.id, a.stepId));

  // Комментарий (не блокирует) — уходит в лист разногласий (фаза 4). Кладём сразу,
  // чтобы «согласовано с комментариями» не терялось.
  if (a.comment?.trim()) {
    await tx.insert(schema.stepRemarks).values({
      stepId: a.stepId,
      documentId: a.documentId,
      authorId: a.actorId,
      kind: 'comment',
      text: a.comment.trim(),
      versionId: a.currentVersionId,
    });
  }

  const [next] = await tx
    .select({ id: rs.id })
    .from(rs)
    .where(and(eq(rs.routeInstanceId, a.routeId), eq(rs.status, 'pending')))
    .orderBy(asc(rs.stageNo))
    .limit(1);

  if (next) {
    await tx.update(rs).set({ status: 'active', activatedAt: new Date() }).where(eq(rs.id, next.id));
    await tx.update(ri).set({ currentStage: a.stageNo + 1 }).where(eq(ri.id, a.routeId));
  } else {
    await tx.update(ri).set({ status: 'approved', finishedAt: new Date() }).where(eq(ri.id, a.routeId));
    await tx.update(schema.documents).set({ status: 'approved', updatedAt: new Date() }).where(eq(schema.documents.id, a.documentId));
  }

  await logDoc(tx, {
    workspaceId: a.workspaceId,
    documentId: a.documentId,
    entity: 'route_step',
    entityId: a.stepId,
    actorId: a.actorId,
    action: 'approved',
    payload: { stageNo: a.stageNo, finished: !next, hasComment: !!a.comment?.trim() },
  });

  return { finished: !next };
}

/**
 * Вернуть на корректировку: блокирующее замечание. Один отказ обязательного согласующего
 * рушит круг — маршрут закрывается rejected, документ уходит инициатору в rework.
 * Оставшиеся шаги остаются pending (маршрут мёртв). После правки инициатор отправит
 * заново — стартует новый круг (iteration+1) с тем же списком.
 */
export async function rejectStep(
  tx: Db,
  a: {
    workspaceId: string;
    documentId: string;
    routeId: string;
    stepId: string;
    stageNo: number;
    currentVersionId: string | null;
    actorId: string;
    remark: string;
  },
): Promise<void> {
  await tx.update(rs).set({ status: 'rejected', decidedVersionId: a.currentVersionId, decidedAt: new Date() }).where(eq(rs.id, a.stepId));

  await tx.insert(schema.stepRemarks).values({
    stepId: a.stepId,
    documentId: a.documentId,
    authorId: a.actorId,
    kind: 'blocking',
    text: a.remark.trim(),
    versionId: a.currentVersionId,
  });

  await tx.update(ri).set({ status: 'rejected', finishedAt: new Date() }).where(eq(ri.id, a.routeId));
  await tx.update(schema.documents).set({ status: 'rework', updatedAt: new Date() }).where(eq(schema.documents.id, a.documentId));

  await logDoc(tx, {
    workspaceId: a.workspaceId,
    documentId: a.documentId,
    entity: 'route_step',
    entityId: a.stepId,
    actorId: a.actorId,
    action: 'rejected',
    payload: { stageNo: a.stageNo },
  });
}
