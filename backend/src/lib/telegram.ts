import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

export interface TelegramLoginData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Проверка подписи Telegram Login Widget.
 * secret = SHA256(bot_token); HMAC-SHA256(data_check_string, secret) === hash.
 * Возвращает true только если подпись валидна и не протухла.
 */
export function verifyTelegramLogin(data: TelegramLoginData): boolean {
  const { hash, ...rest } = data as unknown as Record<string, string | number>;
  if (typeof hash !== 'string') return false;

  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');

  const secret = createHash('sha256').update(env.TELEGRAM_BOT_TOKEN).digest();
  const computed = createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const authDate = Number(rest.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > env.TELEGRAM_AUTH_MAX_AGE) return false;

  return true;
}
