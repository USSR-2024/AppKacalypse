"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";
import { TelegramLogin } from "@/components/TelegramLogin";
import { EmailLogin } from "@/components/EmailLogin";

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [botLink, setBotLink] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const allowDev = process.env.NEXT_PUBLIC_ALLOW_DEV === "1";
  const bot = process.env.NEXT_PUBLIC_TG_BOT;
  const polling = useRef(false);

  useEffect(() => () => { polling.current = false; }, []);

  function finish(token: string) {
    polling.current = false;
    setToken(token);
    router.replace("/");
  }

  // Вход через бота: получаем код, открываем бота, поллим обмен код→JWT.
  async function onBot() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/bot/start", { method: "POST" });
      if (!res.ok) throw new Error("Не удалось начать вход");
      const { code } = await res.json();
      const link = `https://t.me/${bot}?start=login_${code}`;
      setBotLink(link);
      window.open(link, "_blank");

      polling.current = true;
      const started = Date.now();
      while (polling.current && Date.now() - started < 5 * 60_000) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!polling.current) return;
        const ex = await fetch("/api/auth/bot/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (ex.status === 410) throw new Error("Время вышло — начни вход заново");
        if (!ex.ok) continue;
        const data = await ex.json();
        if (data.token) return finish(data.token);
      }
      throw new Error("Время вышло — начни вход заново");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
      setBotLink(null);
    }
  }

  async function onTelegram(user: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(user),
      });
      if (!res.ok) throw new Error("Не удалось войти через Telegram");
      const { token } = await res.json();
      finish(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  async function onDev() {
    setBusy(true);
    setErr(null);
    try {
      const name = prompt("Имя для dev-входа", "Виталий") || "Dev User";
      const res = await fetch("/api/auth/dev", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("dev-вход выключен");
      const { token } = await res.json();
      finish(token);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-3xl font-bold text-white">
          A
        </div>
        <h1 className="text-2xl font-semibold">AppKacalypse</h1>
        <p className="mt-1 text-muted">AI-диспетчер задач</p>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-3">
        {busy ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-muted">{botLink ? "Подтверди вход в Telegram…" : "Входим…"}</p>
            {botLink && (
              <a href={botLink} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
                Telegram не открылся? Нажми здесь
              </a>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={onBot}
              className="w-full rounded-xl bg-accent px-4 py-3 text-center font-medium text-white active:opacity-90"
            >
              Войти через Telegram-бота
            </button>

            <div className="flex w-full items-center gap-3 py-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted">или по почте</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <EmailLogin onToken={(t) => finish(t)} />

            <button
              onClick={() => setShowOther((v) => !v)}
              className="text-sm text-muted underline"
            >
              Другой способ
            </button>

            {showOther && (
              <div className="flex flex-col items-center gap-3 pt-1">
                <p className="text-center text-xs text-muted">
                  Веб-вход через Telegram. Может не работать в РФ без VPN.
                </p>
                <TelegramLogin onAuth={onTelegram} />
                {allowDev && (
                  <button
                    onClick={onDev}
                    className="rounded-xl border border-border px-4 py-2 text-sm text-muted active:bg-surface-2"
                  >
                    dev-вход (локально)
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {err && <p className="text-center text-sm text-danger">{err}</p>}
      </div>
    </main>
  );
}
