import type { Metadata } from "next";
import { GuestJoin } from "./GuestJoin";

// Серверная обёртка страницы приглашения. Нужна ровно ради карточки-превью в
// мессенджере: её рисует бот, который JS не выполняет, поэтому og-теги должны
// быть в HTML. Раньше их не было вовсе — Telegram брал <title> и показывал
// старое имя проекта вместо названия встречи.
//
// Сам вход — в клиентском GuestJoin (микрофон, камера, LiveKit).

interface Preview {
  title: string;
  kind: string;
  startAt: string | null;
  timezone: string | null;
}

const BACKEND = process.env.BACKEND_URL || "http://localhost:8081";

async function fetchPreview(code: string): Promise<Preview | null> {
  try {
    const r = await fetch(`${BACKEND}/api/join/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: code }),
      cache: "no-store",
    });
    return r.ok ? ((await r.json()) as Preview) : null;
  } catch {
    return null;   // бэк недоступен — отдадим нейтральную карточку, страница всё равно откроется
  }
}

// «24 июля, 10:00 (GMT+3)» в часовом поясе организатора. Пояс подписан явно:
// карточку мессенджер рисует один раз на всех, и читать её может участник из
// другого пояса — без метки время выглядело бы уверенно и неверно.
function formatStart(startAt: string, timezone: string | null): string {
  const tz = timezone || "Europe/Moscow";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      timeZone: tz, timeZoneName: "shortOffset",
    }).format(new Date(startAt));
  } catch {
    return new Date(startAt).toLocaleString("ru-RU");
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const m = await fetchPreview(token);

  if (!m) {
    return {
      title: "Приглашение недействительно",
      description: "Ссылка на встречу истекла или встреча уже завершена.",
      robots: { index: false, follow: false },
    };
  }

  const when =
    m.kind === "scheduled" && m.startAt ? `${formatStart(m.startAt, m.timezone)} · ` :
    m.kind === "permanent" ? "Постоянная комната · " : "";
  const description = `Видеовстреча · ${when}appka.space`;

  return {
    title: m.title,
    description,
    // Ссылку на встречу не должны индексировать: она сама по себе пропуск внутрь.
    robots: { index: false, follow: false },
    openGraph: {
      title: m.title,
      description,
      siteName: "appka.space",
      type: "website",
      images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "appka.space" }],
    },
    twitter: { card: "summary", title: m.title, description },
  };
}

export default function GuestJoinPage() {
  return <GuestJoin />;
}
