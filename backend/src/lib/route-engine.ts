import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logDoc } from './dms.js';

/** db или транзакция — движок зовётся и так, и так. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Движок маршрута согласования — СТАДИЙНЫЙ. В одной стадии шаги идут ПАРАЛЛЕЛЬНО;
// стадия пройдена, когда согласованы все ОБЯЗАТЕЛЬНЫЕ шаги (необязательные не держат).
// Ручная цепочка (фаза 3) — частный случай: один шаг на стадию = последовательно.
// Экземпляр маршрута = СНИМОК (definition): правка матрицы не ломает идущий круг.
// Спека: ТЗ §5, план M1.

const ri = schema.routeInstances;
const rs = schema.routeSteps;
const oum = schema.orgUnitMembers;
const am = schema.approvalMatrix;
const ou = schema.orgUnits;

export interface RouteStepInput {
  unitId: string | null;   // от какой группы (null = ручной ad-hoc человек)
  assigneeId: string;
  stageNo: number;
  isRequired: boolean;
}

// ── Сборка маршрута из матрицы ────────────────────────────────────────────────

/** Разрезолвить группу в КОНКРЕТНОГО визирующего: лид → заместитель → любой, у кого canApprove. */
async function resolveUnitApprover(unitId: string): Promise<{ userId: string; name: string } | null> {
  const members = await db
    .select({ userId: oum.userId, role: oum.role, canApprove: oum.canApprove, name: schema.users.displayName })
    .from(oum).innerJoin(schema.users, eq(schema.users.id, oum.userId))
    .where(eq(oum.unitId, unitId));
  const approvers = members.filter((m) => m.canApprove);
  const pick = approvers.find((m) => m.role === 'lead') ?? approvers.find((m) => m.role === 'deputy') ?? approvers[0];
  return pick ? { userId: pick.userId, name: pick.name } : null;
}

export interface AssembledRow {
  unitId: string;
  unitName: string;
  stageNo: number;
  isRequired: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
}

/** Собрать маршрут по матрице типа. hasMatrix=false → матрицы нет, работаем вручную. */
export async function assembleMatrix(workspaceId: string, typeId: string): Promise<{ hasMatrix: boolean; rows: AssembledRow[] }> {
  const matrix = await db
    .select({ unitId: am.unitId, stageNo: am.stageNo, isRequired: am.isRequired, unitName: ou.name })
    .from(am).innerJoin(ou, eq(ou.id, am.unitId))
    .where(and(eq(am.workspaceId, workspaceId), eq(am.typeId, typeId)))
    .orderBy(asc(am.stageNo), asc(ou.name));
  if (matrix.length === 0) return { hasMatrix: false, rows: [] };

  const rows: AssembledRow[] = [];
  for (const m of matrix) {
    const person = await resolveUnitApprover(m.unitId);
    rows.push({ unitId: m.unitId, unitName: m.unitName, stageNo: m.stageNo, isRequired: m.isRequired, assigneeId: person?.userId ?? null, assigneeName: person?.name ?? null });
  }
  return { hasMatrix: true, rows };
}

// ── Запуск маршрута ───────────────────────────────────────────────────────────

/**
 * Создать круг согласования: снимок definition + шаги. Активируем ВСЕ шаги
 * минимальной стадии (они пойдут параллельно). Итерация растёт с каждым кругом.
 */
export async function startRoute(
  tx: Db,
  a: { workspaceId: string; documentId: string; steps: RouteStepInput[]; definition: Record<string, unknown>; actorId: string },
): Promise<{ firstAssignees: string[] }> {
  const [prev] = await tx.select({ it: ri.iteration }).from(ri).where(eq(ri.documentId, a.documentId)).orderBy(desc(ri.iteration)).limit(1);
  const iteration = (prev?.it ?? 0) + 1;
  const minStage = Math.min(...a.steps.map((s) => s.stageNo));

  const [inst] = await tx.insert(ri).values({
    documentId: a.documentId, definition: a.definition, status: 'running', currentStage: minStage, iteration,
  }).returning({ id: ri.id });

  await tx.insert(rs).values(a.steps.map((s) => ({
    routeInstanceId: inst!.id, unitId: s.unitId, assigneeId: s.assigneeId, stageNo: s.stageNo,
    isRequired: s.isRequired,
    status: (s.stageNo === minStage ? 'active' : 'pending') as 'active' | 'pending',
    activatedAt: s.stageNo === minStage ? new Date() : null,
  })));

  await logDoc(tx, {
    workspaceId: a.workspaceId, documentId: a.documentId, entity: 'route_step', entityId: inst!.id,
    actorId: a.actorId, action: 'route_started', payload: { iteration, steps: a.steps.length, mode: a.definition.mode },
  });

  return { firstAssignees: a.steps.filter((s) => s.stageNo === minStage).map((s) => s.assigneeId) };
}

/** Активный шаг документа, назначенный ИМЕННО этому юзеру (в параллельной стадии их несколько — берём свой). */
export async function activeStepForUser(documentId: string, userId: string): Promise<{ stepId: string; routeId: string; stageNo: number } | null> {
  const [row] = await db
    .select({ stepId: rs.id, routeId: ri.id, stageNo: rs.stageNo })
    .from(rs).innerJoin(ri, eq(ri.id, rs.routeInstanceId))
    .where(and(eq(ri.documentId, documentId), eq(ri.status, 'running'), eq(rs.assigneeId, userId), eq(rs.status, 'active')))
    .limit(1);
  return row ?? null;
}

// ── Решения ───────────────────────────────────────────────────────────────────

async function assigneesOfStage(tx: Db, routeId: string, stageNo: number): Promise<string[]> {
  const rows = await tx.select({ a: rs.assigneeId }).from(rs).where(and(eq(rs.routeInstanceId, routeId), eq(rs.stageNo, stageNo)));
  return rows.map((r) => r.a).filter((x): x is string => !!x);
}

/**
 * Согласовать шаг. Фиксируем версию (decided_version_id). Стадия закрывается, когда
 * все ОБЯЗАТЕЛЬНЫЕ её шаги согласованы; тогда незакрытые необязательные пропускаются,
 * активируется следующая стадия. Стадий больше нет → весь маршрут approved.
 */
export async function approveStep(
  tx: Db,
  a: { workspaceId: string; documentId: string; routeId: string; stepId: string; stageNo: number; currentVersionId: string | null; actorId: string; comment?: string | null },
): Promise<{ finished: boolean; nextAssignees: string[] }> {
  await tx.update(rs).set({ status: 'approved', decidedVersionId: a.currentVersionId, decidedAt: new Date() }).where(eq(rs.id, a.stepId));

  if (a.comment?.trim()) {
    await tx.insert(schema.stepRemarks).values({ stepId: a.stepId, documentId: a.documentId, authorId: a.actorId, kind: 'comment', text: a.comment.trim(), versionId: a.currentVersionId });
  }

  const all = await tx.select({ id: rs.id, stageNo: rs.stageNo, status: rs.status, isRequired: rs.isRequired }).from(rs).where(eq(rs.routeInstanceId, a.routeId));
  const requiredPendingInStage = all.some((s) => s.stageNo === a.stageNo && s.isRequired && s.status !== 'approved');

  if (requiredPendingInStage) {
    // Стадия ещё не пройдена — ждём остальных обязательных.
    await logDoc(tx, { workspaceId: a.workspaceId, documentId: a.documentId, entity: 'route_step', entityId: a.stepId, actorId: a.actorId, action: 'approved', payload: { stageNo: a.stageNo, stageDone: false } });
    return { finished: false, nextAssignees: [] };
  }

  // Стадия пройдена: гасим незакрытые необязательные шаги этой стадии.
  await tx.update(rs).set({ status: 'skipped' }).where(and(eq(rs.routeInstanceId, a.routeId), eq(rs.stageNo, a.stageNo), inArray(rs.status, ['pending', 'active'])));

  const nextStages = all.filter((s) => s.stageNo > a.stageNo && s.status === 'pending').map((s) => s.stageNo);
  if (nextStages.length) {
    const ns = Math.min(...nextStages);
    await tx.update(rs).set({ status: 'active', activatedAt: new Date() }).where(and(eq(rs.routeInstanceId, a.routeId), eq(rs.stageNo, ns)));
    await tx.update(ri).set({ currentStage: ns }).where(eq(ri.id, a.routeId));
    await logDoc(tx, { workspaceId: a.workspaceId, documentId: a.documentId, entity: 'route_step', entityId: a.stepId, actorId: a.actorId, action: 'approved', payload: { stageNo: a.stageNo, advancedTo: ns } });
    return { finished: false, nextAssignees: await assigneesOfStage(tx, a.routeId, ns) };
  }

  // Стадий больше нет — согласование пройдено. Документ уходит НА УТВЕРЖДЕНИЕ (ГД),
  // а не сразу в финал: утверждающий (по умолчанию глава) утвердит отдельно (см.
  // /approve-final). Маршрут согласования закрыт (approved), документ → on_signing.
  await tx.update(ri).set({ status: 'approved', finishedAt: new Date() }).where(eq(ri.id, a.routeId));
  await tx.update(schema.documents).set({ status: 'on_signing', updatedAt: new Date() }).where(eq(schema.documents.id, a.documentId));
  await logDoc(tx, { workspaceId: a.workspaceId, documentId: a.documentId, entity: 'route_step', entityId: a.stepId, actorId: a.actorId, action: 'approved', payload: { stageNo: a.stageNo, finished: true, toApproval: true } });
  return { finished: true, nextAssignees: [] };
}

/**
 * Вернуть на корректировку: блокирующее замечание. Отказ ЛЮБОГО обязательного рушит
 * круг — маршрут rejected, документ уходит инициатору в rework.
 */
export async function rejectStep(
  tx: Db,
  a: { workspaceId: string; documentId: string; routeId: string; stepId: string; stageNo: number; currentVersionId: string | null; actorId: string; remark: string },
): Promise<void> {
  await tx.update(rs).set({ status: 'rejected', decidedVersionId: a.currentVersionId, decidedAt: new Date() }).where(eq(rs.id, a.stepId));
  await tx.insert(schema.stepRemarks).values({ stepId: a.stepId, documentId: a.documentId, authorId: a.actorId, kind: 'blocking', text: a.remark.trim(), versionId: a.currentVersionId });
  await tx.update(ri).set({ status: 'rejected', finishedAt: new Date() }).where(eq(ri.id, a.routeId));
  await tx.update(schema.documents).set({ status: 'rework', updatedAt: new Date() }).where(eq(schema.documents.id, a.documentId));
  await logDoc(tx, { workspaceId: a.workspaceId, documentId: a.documentId, entity: 'route_step', entityId: a.stepId, actorId: a.actorId, action: 'rejected', payload: { stageNo: a.stageNo } });
}
