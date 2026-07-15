"use client";
import { useState } from "react";
import { useAuth } from "@/lib/store";

/**
 * Привязка почты к своему аккаунту в профиле. Адрес подтверждается кодом и
 * становится вторым способом входа — рядом с Telegram, не вместо него.
 */
export function EmailLink({ email, onLinked }: { email: string | null; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hdr = () => ({
    "content-type": "application/json",
    authorization: `Bearer ${useAuth.getState().token}`,
  });

  async function request() {
    if (busy || !value.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/users/me/email/request", {
        method: "POST", headers: hdr(), body: JSON.stringify({ email: value.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(
        d.error === "email_taken" ? "Эта почта уже привязана к другому аккаунту"
        : d.error === "too_many" ? "Слишком много запросов — попробуйте позже"
        : "Не удалось отправить код",
      );
      setStep("code");
    } catch (e) { setErr(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (busy || code.trim().length < 4) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/users/me/email/verify", {
        method: "POST", headers: hdr(), body: JSON.stringify({ email: value.trim(), code: code.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error === "expired" ? "Код истёк — запросите новый" : "Неверный код");
      setOpen(false); setStep("email"); setValue(""); setCode("");
      onLinked();
    } catch (e) { setErr(e instanceof Error ? e.message : "Ошибка"); }
    finally { setBusy(false); }
  }

  const input = "w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted";

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{email ?? "Не привязана"}</div>
          <div className="text-xs text-muted">
            {email ? "Можно входить по коду на эту почту" : "Второй способ входа — код на почту"}
          </div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="shrink-0 text-sm text-accent">
          {open ? "Отмена" : email ? "Изменить" : "Добавить"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {step === "email" ? (
            <>
              <input
                type="email" inputMode="email" value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="you@company.com" className={input}
              />
              <button onClick={request} disabled={busy}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Отправляем…" : "Прислать код"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">Код отправлен на {value}</p>
              <input
                inputMode="numeric" maxLength={6} autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" className={`${input} text-center text-lg tracking-[0.3em]`}
              />
              <button onClick={verify} disabled={busy}
                className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Проверяем…" : "Подтвердить"}
              </button>
            </>
          )}
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}
