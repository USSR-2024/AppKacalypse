"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { wsRoleLabel } from "@/lib/roles";
import { Avatar } from "@/components/Avatar";
import type { Me } from "@/lib/types";

interface OwnerWs { id: string; slug: string; name: string; isActive: boolean; memberCount: number }
interface OwnerUser { id: string; displayName: string; avatarUrl: string | null; role: string; isActive: boolean }
interface WsMember { userId: string; role: string; displayName: string; avatarUrl: string | null }

export default function OwnerPage() {
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const { data: me } = useSWR<Me>(token ? "/me" : null, fetcher);

  useEffect(() => {
    if (!token) router.replace("/login");
  }, [token, router]);

  if (!token) return null;
  if (me && me.role !== "owner") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium">Доступ только для владельца платформы</p>
        <button onClick={() => router.replace("/")} className="rounded-xl bg-accent px-4 py-2 font-medium text-white">В приложение</button>
      </main>
    );
  }

  return <OwnerConsole />;
}

function OwnerConsole() {
  const { data: workspaces, mutate } = useSWR<OwnerWs[]>("/owner/workspaces", fetcher);
  const { data: users } = useSWR<OwnerUser[]>("/owner/users", fetcher);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // slug-кандидат из имени (латиница/цифры/дефис).
  function suggestSlug(v: string) {
    setName(v);
    if (!slug) return;
  }

  async function create() {
    if (!name.trim() || !/^[a-z0-9-]{2,32}$/.test(slug)) {
      setErr("Имя обязательно, slug — 2–32 символа a-z 0-9 -");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api("/owner/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug, ...(adminUserId ? { adminUserId } : {}) }),
      });
      setName(""); setSlug(""); setAdminUserId("");
      mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Owner-консоль</h1>
        <a href="/" className="text-sm text-muted underline">В приложение</a>
      </header>

      {/* Создание пространства */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium">Новое пространство (компания)</h2>
        <div className="flex flex-col gap-2">
          <input value={name} onChange={(e) => suggestSlug(e.target.value)} placeholder="Название (напр. ООО Ромашка)"
            className="rounded-xl bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted" />
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="slug для URL: appka.space/<slug>"
            className="rounded-xl bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted" />
          <select value={adminUserId} onChange={(e) => setAdminUserId(e.target.value)}
            className="rounded-xl bg-bg px-3 py-2 text-sm outline-none">
            <option value="">Глава компании — назначить позже</option>
            {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} (глава)</option>)}
          </select>
          {err && <p className="text-sm text-danger">{err}</p>}
          <button onClick={create} disabled={busy} className="rounded-xl bg-accent px-4 py-2 font-medium text-white disabled:opacity-40">
            Создать пространство
          </button>
        </div>
      </section>

      {/* Список пространств */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs uppercase tracking-wide text-muted">Пространства · {workspaces?.length ?? 0}</h2>
        {(workspaces ?? []).map((w) => (
          <div key={w.id} className="rounded-2xl border border-border bg-surface">
            <button onClick={() => setOpenId(openId === w.id ? null : w.id)} className="flex w-full items-center justify-between px-4 py-3 text-left">
              <div>
                <span className="font-medium">{w.name}</span>
                <span className="ml-2 text-xs text-muted">/{w.slug}{w.isActive ? "" : " · выкл"}</span>
              </div>
              <span className="text-xs text-muted">{w.memberCount} чел.</span>
            </button>
            {openId === w.id && <Members ws={w} users={users ?? []} />}
          </div>
        ))}
        {workspaces && workspaces.length === 0 && <p className="px-1 text-sm text-muted">Пространств пока нет.</p>}
      </section>
    </main>
  );
}

function Members({ ws, users }: { ws: OwnerWs; users: OwnerUser[] }) {
  const { data: members, mutate } = useSWR<WsMember[]>(`/owner/workspaces/${ws.id}/members`, fetcher);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("member");

  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const candidates = users.filter((u) => !memberIds.has(u.id));

  async function add() {
    if (!addUser) return;
    await api(`/owner/workspaces/${ws.id}/members`, { method: "POST", body: JSON.stringify({ userId: addUser, role: addRole }) });
    setAddUser("");
    mutate();
  }
  async function setRole(userId: string, role: string) {
    await api(`/owner/workspaces/${ws.id}/members`, { method: "POST", body: JSON.stringify({ userId, role }) });
    mutate();
  }
  async function remove(userId: string) {
    await api(`/owner/workspaces/${ws.id}/members/${userId}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex flex-col gap-2">
        {(members ?? []).map((m) => (
          <div key={m.userId} className="flex items-center gap-3">
            <Avatar src={m.avatarUrl} name={m.displayName} className="h-7 w-7 bg-surface-2 text-xs" />
            <span className="flex-1 truncate text-sm">{m.displayName}</span>
            {m.role === "owner" ? (
              <span className="px-2 py-1 text-xs text-muted">{wsRoleLabel("owner")}</span>
            ) : (
              <>
                <select value={m.role} onChange={(e) => setRole(m.userId, e.target.value)} className="rounded-lg bg-bg px-2 py-1 text-xs">
                  <option value="admin">{wsRoleLabel("admin")}</option>
                  <option value="member">{wsRoleLabel("member")}</option>
                </select>
                <button onClick={() => remove(m.userId)} className="text-xs text-danger">убрать</button>
              </>
            )}
          </div>
        ))}
        {members && members.length === 0 && <p className="text-xs text-muted">Участников нет.</p>}
      </div>
      {candidates.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <select value={addUser} onChange={(e) => setAddUser(e.target.value)} className="flex-1 rounded-lg bg-bg px-2 py-1.5 text-sm">
            <option value="">+ Добавить участника…</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
          <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="rounded-lg bg-bg px-2 py-1.5 text-sm">
            <option value="member">{wsRoleLabel("member")}</option>
            <option value="admin">{wsRoleLabel("admin")}</option>
          </select>
          <button onClick={add} disabled={!addUser} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">ОК</button>
        </div>
      )}
    </div>
  );
}
