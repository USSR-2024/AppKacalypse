"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";
import { TelegramLogin } from "@/components/TelegramLogin";

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowDev = process.env.NEXT_PUBLIC_ALLOW_DEV === "1";

  async function finish(token: string) {
    setToken(token);
    router.replace("/today");
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
      await finish(token);
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
      await finish(token);
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

      <div className="flex flex-col items-center gap-3">
        {busy ? (
          <p className="text-muted">Входим…</p>
        ) : (
          <TelegramLogin onAuth={onTelegram} />
        )}
        {allowDev && !busy && (
          <button
            onClick={onDev}
            className="rounded-xl border border-border px-4 py-2 text-sm text-muted active:bg-surface-2"
          >
            dev-вход (локально)
          </button>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
      </div>
    </main>
  );
}
