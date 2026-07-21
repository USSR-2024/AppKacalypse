"use client";
import { useState } from "react";
import { WsLink } from "@/components/WsLink";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useTeams, useUsers } from "@/lib/hooks";
import { wsRoleLabel } from "@/lib/roles";
import { Avatar } from "@/components/Avatar";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import type { Team } from "@/lib/types";

export default function TeamPage() {
  const me = useAuth((s) => s.me);
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  // Моя роль В ПРОСТРАНСТВЕ (из списка участников), а не платформенная.
  const myWsRole = users?.find((u) => u.id === me?.id)?.role;
  const isWsAdmin = myWsRole === "owner" || myWsRole === "admin";

  const userOpts: Opt[] = (users ?? []).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));

  async function createTeam() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await api("/teams", { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
      mutate("/teams");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 pt-12">
      <WsLink href="/profile" className="text-sm text-muted">‹ Профиль</WsLink>
      <header className="mb-5 mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Команда</h1>
          <p className="mt-1 text-sm text-muted">Коллеги и команды для проектов</p>
        </div>
        {isWsAdmin && (
          <WsLink href="/users" className="shrink-0 rounded-lg bg-surface px-3 py-1.5 text-xs text-muted transition hover:text-text">
            ⚙ Участники пространства
          </WsLink>
        )}
      </header>

      {/* Команды */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Команды</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            placeholder="Новая команда"
            className="flex-1 rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
          />
          <button onClick={createTeam} disabled={busy || !newName.trim()} className="rounded-xl bg-accent px-4 text-white disabled:opacity-40">+</button>
        </div>
        <div className="flex flex-col gap-2">
          {teams?.map((team) => (
            <TeamCard key={team.id} team={team} userOpts={userOpts} canManage={isWsAdmin || team.ownerId === me?.id} />
          ))}
          {teams && teams.length === 0 && <p className="text-sm text-muted">Команд пока нет. Создайте первую.</p>}
        </div>
      </section>

      {/* Коллеги */}
      <section>
        <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Коллеги · {users?.length ?? 0}</h2>
        <div className="flex flex-col gap-2">
          {users?.map((u) => (
            <div key={u.id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
              <Avatar src={u.avatarUrl} name={u.displayName} className="h-9 w-9 bg-surface-2 text-sm" />
              <span className="flex-1 truncate">{u.displayName}</span>
              <span className="text-xs text-muted">{wsRoleLabel(u.role)}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function TeamCard({ team, userOpts, canManage }: { team: Team; userOpts: Opt[]; canManage: boolean }) {
  const [adding, setAdding] = useState("");

  const memberIds = new Set(team.members.map((m) => m.userId));
  const addable = userOpts.filter((o) => !memberIds.has(o.value));

  async function addMember(userId: string) {
    if (!userId) return;
    await api(`/teams/${team.id}/members`, { method: "POST", body: JSON.stringify({ userId }) });
    setAdding("");
    mutate("/teams");
  }
  async function removeMember(userId: string) {
    await api(`/teams/${team.id}/members/${userId}`, { method: "DELETE" });
    mutate("/teams");
  }
  async function remove() {
    if (!confirm(`Удалить команду «${team.name}»?`)) return;
    await api(`/teams/${team.id}`, { method: "DELETE" });
    mutate("/teams");
  }

  return (
    <div className="rounded-2xl bg-surface px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="font-medium">{team.name}</span>
        {canManage && <button onClick={remove} className="text-xs text-danger">Удалить</button>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {team.members.map((m) => (
          <span key={m.userId} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
            {m.displayName}
            {canManage && <button onClick={() => removeMember(m.userId)} className="text-muted" aria-label="Убрать">✕</button>}
          </span>
        ))}
        {team.members.length === 0 && <span className="text-xs text-muted">Нет участников</span>}
      </div>
      {canManage && addable.length > 0 && (
        <div className="mt-2">
          <SheetSelect title="Добавить в команду" placeholder="+ Добавить участника" value={adding} onChange={addMember} options={addable} allowClear={false} />
        </div>
      )}
    </div>
  );
}
