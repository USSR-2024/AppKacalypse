"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { refreshTasks, useProjects, useProjectDetail, useTeams, useUsers } from "@/lib/hooks";
import { Avatar } from "@/components/Avatar";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import type { ProjectDetail } from "@/lib/types";

const COLORS = ["#4f8cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#64748b"];

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const me = useAuth((s) => s.me);
  const { data: detail } = useProjectDetail(id);
  const isAdminGlobal = me?.role === "admin" || me?.role === "owner";
  const canManage = !!me && !!detail && (detail.ownerId === me.id || isAdminGlobal);

  if (!detail) return <main className="px-4 pt-12 text-muted">Загрузка…</main>;

  return (
    <main className="px-4 pt-12 pb-12">
      <Link href={`/projects/${id}`} className="text-sm text-muted">‹ {detail.name}</Link>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Настройки проекта</h1>

      {canManage && <NameColor id={id} detail={detail} />}
      {canManage && <Sections id={id} detail={detail} />}
      <Team id={id} detail={detail} canManage={canManage} />
      <Danger id={id} detail={detail} isAdminGlobal={!!isAdminGlobal} onGone={() => router.replace("/projects")} />
    </main>
  );
}

// ── имя + цвет ───────────────────────────────────────────────────────────────────
function NameColor({ id, detail }: { id: string; detail: ProjectDetail }) {
  const [name, setName] = useState(detail.name);
  const [color, setColor] = useState(detail.color ?? COLORS[0]);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setName(detail.name); setColor(detail.color ?? COLORS[0]); }, [detail.name, detail.color]);

  async function save(patch: { name?: string; color?: string }) {
    await api(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    mutate("/projects");
    mutate(`/projects/${id}`);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Название и цвет</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== detail.name && save({ name: name.trim() })}
        placeholder="Название проекта"
        className="w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); save({ color: c }); }}
            className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-white ring-offset-2 ring-offset-bg" : ""}`}
            style={{ background: c }}
            aria-label="Цвет"
          />
        ))}
      </div>
      <p className="mt-2 h-4 px-1 text-xs text-ok">{saved ? "Сохранено" : ""}</p>
    </section>
  );
}

// ── разделы ──────────────────────────────────────────────────────────────────────
function Sections({ id, detail }: { id: string; detail: ProjectDetail }) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/projects/${id}/sections`, { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
      mutate(`/projects/${id}`);
    } finally {
      setBusy(false);
    }
  }
  async function rename(sid: string, current: string) {
    const name = prompt("Название раздела", current)?.trim();
    if (!name || name === current) return;
    await api(`/projects/${id}/sections/${sid}`, { method: "PATCH", body: JSON.stringify({ name }) });
    mutate(`/projects/${id}`);
  }
  async function del(sid: string) {
    if (!confirm("Удалить раздел? Задачи останутся, но выйдут из раздела.")) return;
    await api(`/projects/${id}/sections/${sid}`, { method: "DELETE" });
    mutate(`/projects/${id}`);
    refreshTasks();
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Разделы · {detail.sections.length}</h2>
      <div className="flex flex-col gap-2">
        {detail.sections.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-2.5">
            <span className="flex-1 truncate text-sm">{s.name}</span>
            <button onClick={() => rename(s.id, s.name)} className="text-xs text-muted">переименовать</button>
            <button onClick={() => del(s.id)} className="text-xs text-danger">удалить</button>
          </div>
        ))}
        {detail.sections.length === 0 && <p className="px-1 text-xs text-muted">Разделов пока нет.</p>}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="+ Новый раздел"
          className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        {newName.trim() && (
          <button onClick={add} disabled={busy} className="rounded-xl bg-accent px-4 text-sm text-white disabled:opacity-40">
            Добавить
          </button>
        )}
      </div>
    </section>
  );
}

// ── команда проекта ───────────────────────────────────────────────────────────────
function Team({ id, detail, canManage }: { id: string; detail: ProjectDetail; canManage: boolean }) {
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const [addUser, setAddUser] = useState("");
  const [addTeam, setAddTeam] = useState("");

  const memberIds = new Set(detail.members.map((m) => m.userId));
  const userOpts: Opt[] = (users ?? []).filter((u) => !memberIds.has(u.id)).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));
  const teamOpts: Opt[] = (teams ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.members.length})` }));

  async function addMember(userId: string) {
    if (!userId) return;
    await api(`/projects/${id}/members`, { method: "POST", body: JSON.stringify({ userId }) });
    setAddUser("");
    mutate(`/projects/${id}`);
  }
  async function addTeamMembers(teamId: string) {
    if (!teamId) return;
    await api(`/projects/${id}/team`, { method: "POST", body: JSON.stringify({ teamId }) });
    setAddTeam("");
    mutate(`/projects/${id}`);
  }
  async function removeMember(userId: string) {
    await api(`/projects/${id}/members/${userId}`, { method: "DELETE" });
    mutate(`/projects/${id}`);
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Команда · {detail.members.length}</h2>
      <div className="flex flex-col gap-2">
        {detail.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2.5">
            <Avatar src={m.avatarUrl} name={m.displayName} className="h-8 w-8 bg-surface-2 text-sm" />
            <span className="flex-1 truncate text-sm">{m.displayName}</span>
            {m.role === "lead" && <span className="text-xs text-muted">лид</span>}
            {canManage && m.role !== "lead" && (
              <button onClick={() => removeMember(m.userId)} className="text-xs text-danger">убрать</button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="mt-2 flex flex-col gap-2">
          {userOpts.length > 0 && (
            <SheetSelect title="Добавить участника" placeholder="+ Участник" value={addUser} onChange={addMember} options={userOpts} allowClear={false} />
          )}
          {teamOpts.length > 0 && (
            <SheetSelect title="Добавить команду" placeholder="+ Команда целиком" value={addTeam} onChange={addTeamMembers} options={teamOpts} allowClear={false} />
          )}
        </div>
      )}
    </section>
  );
}

// ── опасная зона ──────────────────────────────────────────────────────────────────
function Danger({ id, detail, isAdminGlobal, onGone }: { id: string; detail: ProjectDetail; isAdminGlobal: boolean; onGone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!confirm("Архивировать проект? Он скроется у всех. Вернуть можно из архива.")) return;
    setBusy(true);
    try {
      await api(`/projects/${id}/archive`, { method: "POST", body: JSON.stringify({ archived: true }) });
      mutate("/projects");
      onGone();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Удалить проект «${detail.name}» навсегда? Задачи станут личными у создателей.`)) return;
    setBusy(true);
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      mutate("/projects");
      refreshTasks();
      onGone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Опасная зона</h2>
      <div className="flex flex-col gap-2">
        <button
          onClick={archive}
          disabled={busy}
          className="w-full rounded-2xl bg-surface px-4 py-3.5 text-left text-sm disabled:opacity-40"
        >
          📦 Архивировать проект
        </button>
        {isAdminGlobal && (
          <button
            onClick={remove}
            disabled={busy}
            className="w-full rounded-2xl bg-surface px-4 py-3.5 text-left text-sm text-danger disabled:opacity-40"
          >
            🗑 Удалить проект навсегда
          </button>
        )}
      </div>
    </section>
  );
}
