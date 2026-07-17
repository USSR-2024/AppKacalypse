"use client";
import { useState } from "react";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useComments } from "@/lib/hooks";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import type { User } from "@/lib/types";

// Обсуждение под задачей + @упоминания (упомянутым уходит уведомление).
export function TaskComments({ taskId, users }: { taskId: string; users: User[] }) {
  const { data: comments } = useComments(taskId);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string) => users.find((u) => u.id === id)?.displayName ?? "—";

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api(`/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ body: text, mentions }) });
      setBody("");
      setMentions([]);
      mutate(`/tasks/${taskId}/comments`);
    } finally {
      setBusy(false);
    }
  }

  function toggleMention(id: string) {
    setMentions((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-muted">Обсуждение</h2>

      <div className="flex flex-col gap-3">
        {comments?.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Avatar src={c.authorAvatar} name={c.authorName} className="h-7 w-7 shrink-0 bg-surface text-xs" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">
                {c.authorName} · {new Date(c.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
              <div className="whitespace-pre-line text-sm">{c.body}</div>
              {c.mentions.length > 0 && (
                <div className="mt-0.5 text-xs text-accent">@ {c.mentions.map(nameOf).join(", ")}</div>
              )}
            </div>
          </div>
        ))}
        {comments && comments.length === 0 && (
          <p className="text-sm text-muted">Пока пусто. Напишите, что сделано или что уточнить по задаче.</p>
        )}
      </div>

      {mentions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mentions.map((id) => (
            <button key={id} onClick={() => toggleMention(id)} className="rounded-full bg-accent/15 px-2.5 py-1 text-xs text-accent">
              @ {nameOf(id)} ✕
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-end gap-2">
        <button onClick={() => setPick(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted" aria-label="Упомянуть">
          @
        </button>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Комментарий…"
          className="max-h-32 flex-1 resize-none rounded-2xl bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted"
        />
        <button onClick={send} disabled={busy || !body.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40">
          ↑
        </button>
      </div>

      {pick && (
        <Sheet onClose={() => setPick(false)} z="z-[60]" scroll="max-h-[70vh] lg:max-h-[60vh]">
          <p className="mb-2 px-1 text-sm font-medium text-muted">Упомянуть (уведомление)</p>
          <div className="flex flex-col">
            {users.map((u) => {
              const on = mentions.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggleMention(u.id)}
                  className={`flex items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-surface lg:hover:bg-surface ${on ? "text-accent" : ""}`}
                >
                  <Avatar src={u.avatarUrl} name={u.displayName} className="h-7 w-7 shrink-0 bg-surface text-xs" />
                  <span className="flex-1 truncate">{u.displayName}</span>
                  {on && <span>✓</span>}
                </button>
              );
            })}
          </div>
          <button onClick={() => setPick(false)} className="mt-3 w-full rounded-xl bg-surface py-2.5 text-sm text-muted">Готово</button>
        </Sheet>
      )}
    </section>
  );
}
