"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { enablePush, disablePush, pushSupported } from "@/lib/push";
import { Avatar } from "@/components/Avatar";
import type { Me } from "@/lib/types";

const CHANNELS = [
  { key: "telegram", label: "Telegram" },
  { key: "push", label: "Push в приложении" },
];

export default function ProfilePage() {
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const logout = useAuth((s) => s.logout);
  const [draft, setDraft] = useState<Me | null>(me);
  const [saved, setSaved] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");

  useEffect(() => setDraft(me), [me]);
  useEffect(() => {
    if (!me) return;
    const parts = me.displayName.trim().split(/\s+/);
    setFirst(parts[0] ?? "");
    setLast(parts.slice(1).join(" "));
  }, [me?.displayName]);
  if (!draft) return <main className="px-4 pt-12 text-muted">Загрузка…</main>;

  function saveName() {
    const name = `${first.trim()} ${last.trim()}`.trim();
    if (name && name !== draft!.displayName) patch({ displayName: name });
  }

  async function patch(p: Partial<Me>) {
    const next = { ...draft!, ...p };
    setDraft(next);
    const updated = await api<Me>("/users/me", { method: "PATCH", body: JSON.stringify(p) });
    setMe(updated);
    mutate("/me", updated, false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  async function toggleChannel(key: string) {
    const has = draft!.notifyChannels.includes(key);

    // Push требует разрешения браузера + подписки.
    if (key === "push") {
      if (!has) {
        if (!pushSupported()) {
          alert("Браузер не поддерживает пуш. На iPhone добавьте приложение на экран «Домой» и откройте оттуда.");
          return;
        }
        const ok = await enablePush();
        if (!ok) {
          alert("Не удалось включить пуш — проверьте разрешение на уведомления в браузере.");
          return;
        }
        patch({ notifyChannels: [...draft!.notifyChannels, "push"] });
      } else {
        await disablePush();
        patch({ notifyChannels: draft!.notifyChannels.filter((c) => c !== "push") });
      }
      return;
    }

    const channels = has ? draft!.notifyChannels.filter((c) => c !== key) : [...draft!.notifyChannels, key];
    patch({ notifyChannels: channels });
  }

  return (
    <main className="px-4 pt-12">
      <header className="mb-6 flex items-center gap-3">
        <Avatar src={draft.avatarUrl} name={draft.displayName} className="h-14 w-14 bg-accent text-xl text-white" />
        <div>
          <h1 className="text-xl font-semibold">{draft.displayName}</h1>
          <p className="text-sm text-muted">{draft.role === "owner" ? "Владелец" : draft.role === "admin" ? "Админ" : "Участник"}</p>
        </div>
      </header>

      <section className="mb-5">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Имя и фамилия</h2>
        <div className="flex flex-col gap-2">
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            onBlur={saveName}
            placeholder="Имя"
            className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
          />
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            onBlur={saveName}
            placeholder="Фамилия"
            className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
          />
        </div>
        <p className="mt-1 px-1 text-xs text-muted">Так вас видят в задачах и при назначении.</p>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Напоминания</h2>
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-1">
          <Row label="Утренний дайджест">
            <Toggle on={draft.notifyMorning} onChange={(v) => patch({ notifyMorning: v })} />
          </Row>
          {draft.notifyMorning && (
            <Row label="Время утром">
              <input type="time" value={draft.morningTime} onChange={(e) => patch({ morningTime: e.target.value })} className="rounded-lg bg-surface-2 px-2 py-1 text-sm" />
            </Row>
          )}
          <Row label="Вечерний итог">
            <Toggle on={draft.notifyEvening} onChange={(v) => patch({ notifyEvening: v })} />
          </Row>
          {draft.notifyEvening && (
            <Row label="Время вечером">
              <input type="time" value={draft.eveningTime} onChange={(e) => patch({ eveningTime: e.target.value })} className="rounded-lg bg-surface-2 px-2 py-1 text-sm" />
            </Row>
          )}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Вид в проекте</h2>
        <div className="flex rounded-2xl bg-surface p-1 text-sm">
          {([["list", "Список"], ["board", "Доска"], ["table", "Таблица"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => patch({ projectView: v })}
              className={`flex-1 rounded-xl px-3 py-2 ${draft.projectView === v ? "bg-surface-2 font-medium" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Куда присылать</h2>
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-1">
          {CHANNELS.map((ch) => (
            <Row key={ch.key} label={ch.label}>
              <Toggle on={draft.notifyChannels.includes(ch.key)} onChange={() => toggleChannel(ch.key)} />
            </Row>
          ))}
        </div>
      </section>

      <Link href="/done" className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3.5">
        <span>✓ Выполненные задачи</span>
        <span className="text-muted">›</span>
      </Link>

      <Link href="/team" className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3.5">
        <span>👥 Команда</span>
        <span className="text-muted">›</span>
      </Link>

      {(draft.role === "owner" || draft.role === "admin") && (
        <>
          <Link href="/broadcast" className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3.5">
            <span>📣 Уведомить об обновлении</span>
            <span className="text-muted">›</span>
          </Link>
          <Link href="/users" className="mb-3 flex items-center justify-between rounded-2xl bg-surface px-4 py-3.5">
            <span>⚙️ Управление пользователями</span>
            <span className="text-muted">›</span>
          </Link>
        </>
      )}

      <button onClick={logout} className="w-full rounded-2xl bg-surface px-4 py-3.5 text-left text-danger">
        Выйти
      </button>

      <p className="mt-3 h-4 text-center text-xs text-ok">{saved ? "Сохранено" : ""}</p>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition ${on ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
