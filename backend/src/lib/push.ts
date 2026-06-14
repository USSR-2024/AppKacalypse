import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";

let configured: boolean | null = null;

function ensure(): boolean {
  if (configured !== null) return configured;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Web Push всем устройствам пользователей, у которых включён канал push. Мёртвые подписки чистит. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<void> {
  if (!ensure() || !userIds.length) return;

  const users = await db
    .select({ id: schema.users.id, channels: schema.users.notifyChannels })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  const enabled = users
    .filter((u) => Array.isArray(u.channels) && (u.channels as string[]).includes("push"))
    .map((u) => u.id);
  if (!enabled.length) return;

  const subs = await db.select().from(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.userId, enabled));
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).catch(() => {});
        }
      }
    }),
  );
}
