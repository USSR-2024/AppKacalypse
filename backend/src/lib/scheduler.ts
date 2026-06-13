import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { sendMessage } from "./telegram-bot.js";
import { morningDigest, eveningDigest } from "./digest.js";

// Гард против повторной отправки в ту же минуту/день (key = user:type:date).
const sent = new Set<string>();

function hhmm(tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}
function dayKey(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function startScheduler(): void {
  setInterval(() => {
    tick().catch((e) => console.error("scheduler:", e));
  }, 60_000);
  console.log("планировщик дайджестов запущен");
}

async function tick(): Promise<void> {
  if (sent.size > 2000) sent.clear();
  const users = await db
    .select({
      id: schema.users.id,
      tz: schema.users.timezone,
      morning: schema.users.notifyMorning,
      evening: schema.users.notifyEvening,
      morningTime: schema.users.morningTime,
      eveningTime: schema.users.eveningTime,
      channels: schema.users.notifyChannels,
    })
    .from(schema.users)
    .where(eq(schema.users.isActive, true));

  for (const u of users) {
    const channels = (u.channels as string[]) ?? [];
    if (!channels.includes("telegram")) continue; // v1: дайджесты только в Telegram
    const now = hhmm(u.tz);
    const dk = dayKey(u.tz);
    if (u.morning && u.morningTime === now) await deliver(u.id, u.tz, "morning", dk);
    if (u.evening && u.eveningTime === now) await deliver(u.id, u.tz, "evening", dk);
  }
}

async function deliver(userId: string, tz: string, type: "morning" | "evening", dk: string): Promise<void> {
  const key = `${userId}:${type}:${dk}`;
  if (sent.has(key)) return;
  sent.add(key);

  const [ident] = await db
    .select({ externalId: schema.authIdentities.externalId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, "telegram"), eq(schema.authIdentities.userId, userId)))
    .limit(1);
  if (!ident) return;

  const text = type === "morning" ? await morningDigest(userId, tz) : await eveningDigest(userId, tz);
  if (text) await sendMessage(ident.externalId, text);
}
