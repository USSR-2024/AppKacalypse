/**
 * Общая механика беспарольного входа по коду на почту (OTP).
 * Одним примитивом закрыты три сценария: вход, регистрация по приглашению и
 * привязка почты в профиле — различаются только тем, что лежит в строке кода.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { createHmac, randomInt } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { env } from './env.js';

export const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;          // шестизначный код: без лимита перебирается за минуты
const MAX_CODES_PER_HOUR = 5;    // и чтобы форма не превратилась в рассыльщик спама

export const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * HMAC, а не голый хеш: код — шесть цифр, то есть миллион вариантов, и обычный
 * sha256 из дампа базы разворачивается перебором за доли секунды. С секретом
 * сервера дамп сам по себе кодов не выдаёт.
 */
export const hashCode = (c: string) => createHmac('sha256', env.JWT_SECRET).update(c).digest('hex');

/** Имя по адресу: «ivan.petrov@x.ru» → «Ivan Petrov». Человек поправит в профиле. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  const words = local.split(/[._\-+]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ').slice(0, 100) || 'User';
}

/** Не слишком ли часто просят код на этот адрес. */
export async function tooManyCodes(email: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.emailLoginCodes)
    .where(and(
      eq(schema.emailLoginCodes.email, email),
      gt(schema.emailLoginCodes.createdAt, new Date(Date.now() - 3600_000)),
    ));
  return (row?.n ?? 0) >= MAX_CODES_PER_HOUR;
}

/** Создать код. Возвращает сам код — его надо отправить письмом и забыть. */
export async function issueCode(email: string, opts: { inviteCode?: string; linkUserId?: string } = {}) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.insert(schema.emailLoginCodes).values({
    email,
    codeHash: hashCode(code),
    inviteCode: opts.inviteCode ?? null,
    linkUserId: opts.linkUserId ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000),
  });
  return code;
}

export type CodeRow = typeof schema.emailLoginCodes.$inferSelect;

/**
 * Проверить код. Возвращает строку кода или причину отказа.
 * Промахи считаем на строке: после MAX_ATTEMPTS она мертва, даже если код угадают.
 */
export async function consumeCode(email: string, code: string): Promise<
  { ok: true; row: CodeRow } | { ok: false; reason: 'expired' | 'invalid' }
> {
  const [row] = await db
    .select()
    .from(schema.emailLoginCodes)
    .where(eq(schema.emailLoginCodes.email, email))
    .orderBy(desc(schema.emailLoginCodes.createdAt))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'expired' };

  if (row.codeHash !== hashCode(code.trim())) {
    await db.update(schema.emailLoginCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(schema.emailLoginCodes.id, row.id));
    return { ok: false, reason: 'invalid' };
  }

  // Код одноразовый: гасим строку сразу, повторно тем же кодом не войти.
  await db.delete(schema.emailLoginCodes).where(eq(schema.emailLoginCodes.id, row.id));
  return { ok: true, row };
}

export interface InviteInfo {
  workspaceId: string;
  wsName: string;
  wsSlug: string;
  role: 'owner' | 'admin' | 'member';
  autoApprove: boolean;
  usesLeft: number | null;
}

/** Живое приглашение по коду (не истекло, не исчерпано) или null. */
export async function findInvite(code: string): Promise<InviteInfo | null> {
  const [inv] = await db
    .select({
      workspaceId: schema.workspaceInvites.workspaceId,
      role: schema.workspaceInvites.role,
      autoApprove: schema.workspaceInvites.autoApprove,
      usesLeft: schema.workspaceInvites.usesLeft,
      expiresAt: schema.workspaceInvites.expiresAt,
      wsName: schema.workspaces.name,
      wsSlug: schema.workspaces.slug,
    })
    .from(schema.workspaceInvites)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceInvites.workspaceId))
    .where(eq(schema.workspaceInvites.code, code))
    .limit(1);

  if (!inv) return null;
  if (inv.expiresAt && inv.expiresAt < new Date()) return null;
  if (inv.usesLeft !== null && inv.usesLeft <= 0) return null;
  return {
    workspaceId: inv.workspaceId, wsName: inv.wsName, wsSlug: inv.wsSlug,
    role: inv.role, autoApprove: inv.autoApprove, usesLeft: inv.usesLeft,
  };
}

/**
 * Принять приглашение: членство + списание одноразового использования.
 * Уже состоящего в пространстве не трогаем — повторный переход по ссылке не
 * должен понижать роль или сбрасывать в pending.
 */
export async function acceptInvite(userId: string, code: string, inv: InviteInfo) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(and(
        eq(schema.workspaceMembers.workspaceId, inv.workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ))
      .limit(1);

    if (!existing) {
      await tx.insert(schema.workspaceMembers).values({
        workspaceId: inv.workspaceId,
        userId,
        role: inv.role,
        status: inv.autoApprove ? 'active' : 'pending',
      });
    }
    if (inv.usesLeft !== null) {
      await tx.update(schema.workspaceInvites)
        .set({ usesLeft: sql`greatest(${schema.workspaceInvites.usesLeft} - 1, 0)` })
        .where(eq(schema.workspaceInvites.code, code));
    }
  });
}
