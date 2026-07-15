"use client";
import { useState } from "react";

/**
 * Вход/регистрация по коду на почту. Два шага: адрес → код из письма.
 * Используется и на /login (вход), и на /invite/<code> (регистрация по приглашению) —
 * разница только в пропе invite.
 */
export function EmailLogin({
  invite,
  onToken,
}: {
  invite?: string;
  onToken: (token: string, workspace?: { slug: string; pending: boolean }) => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [ttl, setTtl] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function request(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), invite }),
      });
      if (!r.ok) throw new Error("Не удалось отправить код");
      const d = await r.json().catch(() => ({}));
      setTtl(d.ttlMinutes ?? 10);
      setStep("code");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || code.trim().length < 4) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          d.error === "expired" ? "Код истёк — запросите новый"
          : d.error === "no_access" ? "Нет доступа: нужна ссылка-приглашение"
          : "Неверный код",
        );
      }
      onToken(d.token, d.workspace);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl bg-surface-2 px-4 py-3 text-center outline-none placeholder:text-muted";

  if (step === "email") {
    return (
      <form onSubmit={request} className="flex w-full flex-col gap-2">
        <input
          type="email" inputMode="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com" className={input}
        />
        <button disabled={busy} className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white disabled:opacity-40">
          {busy ? "Отправляем…" : "Получить код"}
        </button>
        {err && <p className="text-center text-sm text-danger">{err}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex w-full flex-col gap-2">
      <p className="text-center text-sm text-muted">
        Код отправлен на <span className="text-text">{email}</span>. Действует {ttl} минут.
      </p>
      <input
        inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="000000" className={`${input} text-2xl tracking-[0.4em]`}
      />
      <button disabled={busy} className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white disabled:opacity-40">
        {busy ? "Проверяем…" : "Войти"}
      </button>
      {err && <p className="text-center text-sm text-danger">{err}</p>}
      <button type="button" onClick={() => { setStep("email"); setCode(""); setErr(null); }} className="text-sm text-muted underline">
        Изменить адрес
      </button>
    </form>
  );
}
