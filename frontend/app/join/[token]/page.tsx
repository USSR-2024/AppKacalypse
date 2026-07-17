"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MeetingRoom } from "@/components/MeetingRoom";
import { meetStr, type MeetLang } from "@/lib/meetStrings";

interface JoinInfo { url: string; token: string; title: string; captions: boolean }
interface Preview { title: string; captions: boolean; kind: string; startAt: string | null; canJoin: boolean }

// Публичный вход для внешних гостей по инвайт-ссылке. Без аккаунта.
// UI и субтитры — на выбранном языке (по умолчанию из языка браузера).
export default function GuestJoinPage() {
  const { token: invite } = useParams<{ token: string }>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<MeetLang>("ru");
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = meetStr[lang];
  const title = preview?.title ?? null;

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es")) setLang("es");
  }, []);

  // Перепроверяем раз в 30 с: пришедший заранее увидит форму входа, как только
  // окно откроется (за 15 мин до начала), — перезагружать страницу не нужно.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/join/preview", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite }),
      })
        .then(async (r) => {
          if (!alive) return;
          if (r.ok) { setPreview((await r.json()) as Preview); setValid(true); }
          else setValid(false);
        })
        .catch(() => alive && setValid(false));
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [invite]);

  async function join() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/join/token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite, name: name.trim(), lang }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "error");
      setInfo((await r.json()) as JoinInfo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
      setBusy(false);
    }
  }

  if (info) {
    return (
      <MeetingRoom
        url={info.url} token={info.token} title={info.title}
        viewerLang={lang} initialCaptions={info.captions}
        onLeave={() => { setInfo(null); setBusy(false); }}
      />
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6">
        {valid === false ? (
          <div className="text-center">
            <div className="text-4xl">🔗</div>
            <p className="mt-2 font-medium">{t.invalidLink}</p>
            <p className="mt-1 text-sm text-muted">{t.askNew}</p>
          </div>
        ) : preview && !preview.canJoin ? (
          <div className="text-center">
            <div className="text-4xl">🕒</div>
            <p className="mt-2 font-medium">{preview.title}</p>
            <p className="mt-1 text-sm">{t.tooEarlyTitle}</p>
            {preview.startAt && (
              <p className="mt-2 text-lg font-semibold text-accent">
                {new Date(preview.startAt).toLocaleString(lang === "es" ? "es-ES" : "ru-RU", {
                  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
                })}
              </p>
            )}
            <p className="mt-3 text-sm text-muted">{t.tooEarlyHint}</p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{title ?? t.connectTitle}</h1>
            <p className="mt-1 text-sm text-muted">{t.enterName}</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder={t.yourName}
              className="mt-4 w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none"
            />
            <div className="mt-3">
              <label className="text-xs text-muted">{t.subLang}</label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as MeetLang)}
                className="mt-1 w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none"
              >
                <option value="ru">Русский</option>
                <option value="es">Español</option>
              </select>
            </div>
            <button
              onClick={join}
              disabled={busy || !name.trim()}
              className="mt-4 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? t.connecting : t.join}
            </button>
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          </>
        )}
      </div>
    </main>
  );
}
