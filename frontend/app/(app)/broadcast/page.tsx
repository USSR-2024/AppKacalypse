"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useUsers, useBroadcasts, useChangelog } from "@/lib/hooks";

export default function BroadcastPage() {
  const me = useAuth((s) => s.me);
  const { data: users } = useUsers();
  const { data: history, mutate } = useBroadcasts();
  const { data: changes, mutate: mutateChanges } = useChangelog();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tg, setTg] = useState(true);
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [newChange, setNewChange] = useState("");
  const [note, setNote] = useState("");

  const isPriv = me?.role === "owner" || me?.role === "admin";
  const total = users?.length ?? 0;
  const channels = [tg && "telegram", push && "push"].filter(Boolean) as string[];
  const changeCount = changes?.length ?? 0;

  if (me && !isPriv) {
    return <main className="px-4 pt-12 text-muted">Доступно только администраторам.</main>;
  }

  async function generateDraft() {
    if (drafting) return;
    setDrafting(true);
    setNote("");
    try {
      const r = await api<{ title: string; body: string }>("/broadcast/draft", { method: "POST", body: JSON.stringify({}) });
      setTitle(r.title);
      setBody(r.body);
      setNote("Черновик готов — проверьте и при необходимости поправьте.");
    } catch {
      setNote("Не удалось сгенерировать черновик (модель недоступна?). Можно написать вручную.");
    } finally {
      setDrafting(false);
    }
  }

  async function addChange() {
    if (!newChange.trim()) return;
    await api("/broadcast/changelog", { method: "POST", body: JSON.stringify({ text: newChange.trim() }) });
    setNewChange("");
    mutateChanges();
  }
  async function removeChange(id: string) {
    await api(`/broadcast/changelog/${id}`, { method: "DELETE" });
    mutateChanges();
  }

  async function send(selfOnly: boolean) {
    if (!title.trim() || !body.trim()) {
      setNote("Заполните заголовок и текст");
      return;
    }
    if (!channels.length) {
      setNote("Выберите хотя бы один канал");
      return;
    }
    if (!selfOnly && !confirm(`Разослать обновление всем пользователям (${total})? Отменить отправку будет нельзя.`)) return;

    setBusy(true);
    setNote("");
    try {
      const r = await api<{ recipients: number; telegram: number }>("/broadcast", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), channels, selfOnly }),
      });
      if (selfOnly) {
        setNote("Отправлено вам — проверьте Telegram/Push.");
      } else {
        setNote(`Разослано: ${r.recipients} получателей (Telegram: ${r.telegram}).`);
        mutate();
        mutateChanges();
      }
    } catch {
      setNote("Не удалось отправить. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 pt-12">
      <Link href="/profile" className="text-sm text-muted">‹ Профиль</Link>
      <header className="mb-5 mt-2">
        <h1 className="text-2xl font-semibold">📣 Уведомить об обновлении</h1>
        <p className="mt-1 text-sm text-muted">Ручная рассылка всем пользователям. Только для крупных апдейтов.</p>
      </header>

      {/* Неуведомлённые изменения + автогенерация черновика */}
      <section className="mb-5 rounded-2xl bg-surface-2/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Новые изменения · {changeCount}</span>
          <button
            onClick={generateDraft}
            disabled={drafting || changeCount === 0}
            className="rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {drafting ? "Готовлю…" : "✨ Сгенерировать черновик"}
          </button>
        </div>
        {changeCount > 0 ? (
          <div className="mb-2 flex flex-col gap-1">
            {changes!.map((ch) => (
              <div key={ch.id} className="flex items-start gap-2 text-xs text-muted">
                <span className="flex-1">• {ch.text}</span>
                <button onClick={() => removeChange(ch.id)} className="shrink-0">✕</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mb-2 text-xs text-muted">Пунктов с прошлой рассылки нет. Можно добавить вручную ниже или написать текст сам.</p>
        )}
        <div className="flex gap-2">
          <input
            value={newChange}
            onChange={(e) => setNewChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChange()}
            placeholder="+ добавить пункт изменения"
            className="flex-1 rounded-lg bg-surface px-2.5 py-2 text-xs outline-none placeholder:text-muted"
          />
          {newChange.trim() && <button onClick={addChange} className="rounded-lg bg-surface px-3 text-xs">Добавить</button>}
        </div>
      </section>

      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Заголовок — напр. 🚀 Большое обновление"
          className="w-full rounded-xl bg-surface px-3 py-3 font-medium outline-none placeholder:text-muted"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Что нового (по пунктам)…"
          rows={8}
          className="w-full resize-none rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
        />

        <div className="flex gap-2">
          <button onClick={() => setTg(!tg)} className={`flex-1 rounded-xl px-3 py-2.5 text-sm ${tg ? "bg-accent/15 text-accent" : "bg-surface text-muted"}`}>
            {tg ? "✓ " : ""}Telegram
          </button>
          <button onClick={() => setPush(!push)} className={`flex-1 rounded-xl px-3 py-2.5 text-sm ${push ? "bg-accent/15 text-accent" : "bg-surface text-muted"}`}>
            {push ? "✓ " : ""}Push
          </button>
        </div>

        {note && <p className="text-sm text-ok">{note}</p>}

        <button onClick={() => send(true)} disabled={busy} className="rounded-xl bg-surface py-3 text-sm font-medium disabled:opacity-40">
          Прислать себе для проверки
        </button>
        <button onClick={() => send(false)} disabled={busy} className="rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40">
          {busy ? "…" : `📣 Разослать всем (${total})`}
        </button>
      </div>

      {history && history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">История рассылок</h2>
          <div className="flex flex-col gap-2">
            {history.map((b) => (
              <div key={b.id} className="rounded-2xl bg-surface px-4 py-3">
                <div className="text-sm font-medium">{b.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {new Date(b.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{b.recipientCount} получателей · {b.senderName}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
