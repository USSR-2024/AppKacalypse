import { and, eq, or, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { SessionClaims } from './jwt.js';

/** db или транзакция: помощники ниже зовутся и так, и так. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Общие правила модуля «Документы»: номер, доступ, аудит. Держим в одном месте —
// правило, размазанное по роутам, разъезжается (это уже проходили со встречами).

const doc = schema.documents;

// ─────────────────────────────────────────────────────────────────────────────
// Реестровый номер
// ─────────────────────────────────────────────────────────────────────────────

/** Плейсхолдеры маски (ТЗ §3.2): {YYYY} {YY} {MM} {NNNN} {GROUP} {TYPE}. */
function renderMask(mask: string, parts: { seq: number; typeCode: string; groupCode: string; now: Date }): string {
  const { seq, typeCode, groupCode, now } = parts;
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return mask
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(2))
    .replace(/\{MM\}/g, mm)
    .replace(/\{GROUP\}/g, groupCode)
    .replace(/\{TYPE\}/g, typeCode)
    // Ширина берётся из самой маски: {NNNN} → 4 знака, {NN} → 2.
    .replace(/\{(N+)\}/g, (_m, ns: string) => String(seq).padStart(ns.length, '0'));
}

/** Ключ периода счётчика: помесячный, только если в маске есть {MM}. */
function periodKey(mask: string, now: Date): string {
  const yyyy = String(now.getUTCFullYear());
  return /\{MM\}/.test(mask) ? `${yyyy}-${String(now.getUTCMonth() + 1).padStart(2, '0')}` : yyyy;
}

/**
 * Выдать следующий реестровый номер. Зовётся ВНУТРИ транзакции перехода на согласование.
 *
 * ★ Счётчик инкрементируется одним атомарным INSERT ... ON CONFLICT DO UPDATE.
 * Через SELECT MAX()+1 два одновременных документа получили бы один номер — у
 * бухгалтерии к таким совпадениям вопросы. Проверено тестом на 20 параллельных выдачах.
 */
export async function nextRegistryNumber(
  tx: Db,
  workspaceId: string,
  type: { id: string; code: string; registryMask: string },
  groupCode: string,
): Promise<string> {
  const now = new Date();
  const key = periodKey(type.registryMask, now);
  const [row] = await tx
    .insert(schema.docRegistryCounters)
    .values({ workspaceId, typeId: type.id, periodKey: key, lastValue: 1 })
    .onConflictDoUpdate({
      target: [schema.docRegistryCounters.workspaceId, schema.docRegistryCounters.typeId, schema.docRegistryCounters.periodKey],
      set: { lastValue: sql`${schema.docRegistryCounters.lastValue} + 1` },
    })
    .returning({ seq: schema.docRegistryCounters.lastValue });
  return renderMask(type.registryMask, { seq: row!.seq, typeCode: type.code, groupCode, now });
}

// ─────────────────────────────────────────────────────────────────────────────
// Доступ
// ─────────────────────────────────────────────────────────────────────────────

/** Админ модуля = глава пространства. Видит и правит всё в своём ws. */
export const isDocsAdmin = (wsRole: string) => wsRole === 'owner' || wsRole === 'admin';

/** id документов, где юзер — согласующий (шаг маршрута любой итерации). */
function approverDocIds(userId: string) {
  return db
    .select({ id: schema.routeInstances.documentId })
    .from(schema.routeSteps)
    .innerJoin(schema.routeInstances, eq(schema.routeInstances.id, schema.routeSteps.routeInstanceId))
    .where(eq(schema.routeSteps.assigneeId, userId));
}

/**
 * Кто видит документ: инициатор (автор), ответственный, согласующий. Админ модуля — всё.
 * Возвращает условие для WHERE или null, если ограничивать не надо.
 */
export function visibilityCond(u: SessionClaims, wsRole: string): SQL | null {
  if (isDocsAdmin(wsRole)) return null;
  return or(
    eq(doc.authorId, u.sub),
    eq(doc.ownerId, u.sub),
    inArray(doc.id, approverDocIds(u.sub)),
  )!;
}

/** Правило доступа для одной карточки (когда условие в WHERE неудобно). */
export async function canView(u: SessionClaims, wsRole: string, documentId: string): Promise<boolean> {
  if (isDocsAdmin(wsRole)) return true;
  const [row] = await db.select({ id: doc.id }).from(doc)
    .where(and(eq(doc.id, documentId), visibilityCond(u, wsRole)!)).limit(1);
  return !!row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Аудит
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Запись в журнал. Пишется на ВСЕ смены статуса, сохранения версий, решения по
 * шагам, правки справочников — это единственный источник правды на вопрос
 * «что вообще происходило с документом» (ТЗ §3.7). Записи неизменяемы.
 */
export async function logDoc(
  tx: Db,
  e: {
    workspaceId: string;
    documentId?: string | null;
    entity: 'document' | 'version' | 'route_step' | 'doc_type' | 'org_unit' | 'matrix';
    entityId?: string | null;
    actorId?: string | null;
    action: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.documentActivity).values({
    workspaceId: e.workspaceId,
    documentId: e.documentId ?? null,
    entity: e.entity,
    entityId: e.entityId ?? null,
    actorId: e.actorId ?? null,
    action: e.action,
    payload: e.payload ?? {},
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ключи объектов в MinIO (ТЗ §6.1). Ключ НЕИЗМЕНЯЕМ: переименование файла в UI
// правит file_name, а не object_key.
// ─────────────────────────────────────────────────────────────────────────────

export const versionKey = (documentId: string, versionNo: number, ext: string) =>
  `documents/${documentId}/v${versionNo}${ext}`;

/**
 * Ключ документа для ONLYOFFICE DS: d{id}_v{n}_{hash16}.
 * ★ Хэш в ключе решает инвалидацию кэша: изменилось содержимое → сменился ключ →
 * DS не отдаст старую копию. ТЗ верно зовёт это «источником половины багов».
 */
export const dsKey = (documentId: string, versionNo: number, fileHash: string) =>
  `d${documentId.replace(/-/g, '').slice(0, 12)}_v${versionNo}_${fileHash.slice(0, 16)}`;
