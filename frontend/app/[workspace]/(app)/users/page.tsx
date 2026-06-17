"use client";
import { useState } from "react";
import useSWR from "swr";
import { WsLink } from "@/components/WsLink";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { wsRoleLabel } from "@/lib/roles";
import { Avatar } from "@/components/Avatar";

interface Member {
  userId: string;
  role: "owner" | "admin" | "member";
  status: "active" | "pending";
  displayName: string;
  avatarUrl: string | null;
}

const bot = process.env.NEXT_PUBLIC_TG_BOT;

export default function MembersPage() {
  const me = useAuth((s) => s.me);
  const { data, error, mutate, isLoading } = useSWR<Member[]>("/members", fetcher);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // /members отдаёт 403 не-админам → показываем заглушку.
  if (error) {
    return (
      <main className="px-4 pt-12">
        <WsLink href="/profile" className="text-sm text-muted">‹ Профиль</WsLink>
        <p className="mt-6 text-muted">Управление участниками доступно только администратору пространства.</p>
      </main>
    );
  }

  const members = data ?? [];
  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  async function createInvite() {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>("/members/invite", { method: "POST", body: JSON.stringify({}) });
      setInvite(`https://t.me/${bot}?start=invite_${code}`);
      setCopied(false);
    } finally {
      setBusy(false);
    }
  }
  async function copyInvite() {
    if (!invite) return;
    try { await navigator.clipboard.writeText(invite); setCopied(true); } catch {}
  }
  async function approve(id: string) { await api(`/members/${id}/approve`, { method: "POST" }); mutate(); }
  async function reject(id: string) { await api(`/members/${id}/reject`, { method: "POST" }); mutate(); }
  async function setRole(id: string, role: "admin" | "member") { await api(`/members/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }); mutate(); }
  async function remove(id: string) {
    if (!confirm("Убрать участника из пространства?")) return;
    await api(`/members/${id}`, { method: "DELETE" }); mutate();
  }

  return (
    <main className="px-4 pt-12 pb-12 lg:pt-2">
      <WsLink href="/profile" className="text-sm text-muted lg:hidden">‹ Профиль</WsLink>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Участники пространства</h1>

      {/* Пригласить */}
      <section className="mb-6 rounded-2xl bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium">Пригласить в пространство</h2>
        <p className="mb-3 text-xs text-muted">Отправь ссылку человеку — он зайдёт через бота и подаст заявку, а ты её одобришь ниже.</p>
        {invite ? (
          <div className="flex flex-col gap-2">
            <input readOnly value={invite} className="w-full rounded-xl bg-bg px-3 py-2 text-xs outline-none" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <button onClick={copyInvite} className="flex-1 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">{copied ? "Скопировано ✓" : "Копировать ссылку"}</button>
              <button onClick={() => setInvite(null)} className="rounded-xl bg-surface-2 px-4 py-2 text-sm text-muted">Новая</button>
            </div>
          </div>
        ) : (
          <button onClick={createInvite} disabled={busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            🔗 Создать ссылку-приглашение
          </button>
        )}
      </section>

      {isLoading && <p className="text-muted">Загрузка…</p>}

      {/* Заявки на рассмотрении */}
      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-warn">Заявки · {pending.length}</h2>
          <div className="flex flex-col gap-2">
            {pending.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 rounded-2xl border border-warn/40 bg-surface p-3">
                <Avatar src={m.avatarUrl} name={m.displayName} className="h-10 w-10 shrink-0 bg-surface-2 text-sm" />
                <div className="min-w-0 flex-1 truncate text-sm font-medium">{m.displayName}</div>
                <button onClick={() => approve(m.userId)} className="rounded-lg bg-ok px-3 py-1.5 text-xs font-medium text-white">Одобрить</button>
                <button onClick={() => reject(m.userId)} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-danger">Отклонить</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Активные участники */}
      <section>
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Участники · {active.length}</h2>
        <div className="flex flex-col gap-2">
          {active.map((m) => {
            const isOwner = m.role === "owner";
            const isSelf = m.userId === me?.id;
            return (
              <div key={m.userId} className="flex items-center gap-3 rounded-2xl bg-surface p-3">
                <Avatar src={m.avatarUrl} name={m.displayName} className="h-10 w-10 shrink-0 bg-accent text-white" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.displayName}{isSelf ? " · вы" : ""}</div>
                  <div className="text-xs text-muted">{wsRoleLabel(m.role)}</div>
                </div>
                {!isOwner && !isSelf && (
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => setRole(m.userId, m.role === "admin" ? "member" : "admin")} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
                      {m.role === "admin" ? "→ участник" : "→ глава"}
                    </button>
                    <button onClick={() => remove(m.userId)} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-danger">Убрать</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
