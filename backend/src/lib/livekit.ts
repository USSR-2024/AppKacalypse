import { SignJWT } from 'jose';
import { env } from './env.js';

// LiveKit access-token — это обычный JWT (HS256), подписанный API-секретом:
//   iss = apiKey, sub = identity, + грант `video` (право войти/публиковать).
// Генерим сами, чтобы не тащить пакет livekit-server-sdk (у нас уже есть jose).
const secret = () => new TextEncoder().encode(env.LIVEKIT_API_SECRET);

export interface GrantOpts {
  room: string;
  identity: string;       // уникальный id участника (userId или guest_*)
  name: string;           // отображаемое имя
  metadata?: string;      // JSON-строка: { lang, role, guest }
  canPublish?: boolean;   // может ли слать своё аудио/видео (по умолчанию да)
  ttlSeconds?: number;
}

export async function livekitToken(o: GrantOpts): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = o.ttlSeconds ?? 60 * 60 * 6; // 6 часов на встречу
  const video = {
    room: o.room,
    roomJoin: true,
    canPublish: o.canPublish ?? true,
    canSubscribe: true,
    canPublishData: true,
  };
  return new SignJWT({ video, name: o.name, ...(o.metadata ? { metadata: o.metadata } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.LIVEKIT_API_KEY)
    .setSubject(o.identity)
    .setJti(o.identity)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ttl)
    .sign(secret());
}
