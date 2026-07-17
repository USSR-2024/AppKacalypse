import { isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import { schema } from '../db/index.js';

// Когда встреча считается «идущей». Одно правило на всех: вход участника, вход
// гостя по ссылке, заход агента субтитров в комнату и гейт GPU у расшифровок.
//
// Тонкость, из-за которой это вынесено отдельно: meetings.status='active' значит
// «не завершена», а НЕ «идёт сейчас». Запланированная встреча активна с момента
// создания — то есть за неделю до начала. Кто читает только status, тот считает
// планёрку следующего вторника идущей прямо сейчас.

/** За сколько до начала открывается вход: люди заходят сами, хост может опоздать. */
export const EARLY_JOIN_MS = 15 * 60 * 1000;

export type JoinBlock = 'ended' | 'too_early' | null;

/** Можно ли войти прямо сейчас (для одной встречи). */
export function joinGate(m: { status: string; kind: string; startAt: Date | null }): JoinBlock {
  if (m.status !== 'active') return 'ended';
  if (m.kind === 'scheduled' && m.startAt && Date.now() < m.startAt.getTime() - EARLY_JOIN_MS) return 'too_early';
  return null;
}

/** То же правило как условие SQL — для выборок «какие встречи идут сейчас».
 *  Комбинировать с eq(status,'active') на месте вызова. */
export function liveNow(): SQL | undefined {
  const mt = schema.meetings;
  return or(
    ne(mt.kind, 'scheduled'),
    isNull(mt.startAt),
    lte(mt.startAt, new Date(Date.now() + EARLY_JOIN_MS)),
  );
}
