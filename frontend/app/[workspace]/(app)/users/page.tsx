"use client";
import useSWR from "swr";
import { WsLink } from "@/components/WsLink";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import type { AdminUser } from "@/lib/types";

const ROLE_LABEL: Record<string, string> = { owner: "Владелец", admin: "Админ", member: "Участник" };

export default function UsersPage() {
  const me = useAuth((s) => s.me);
  const { data, mutate, isLoading } = useSWR<AdminUser[]>("/users/admin", fetcher);

  if (me && me.role !== "owner" && me.role !== "admin") {
    return (
      <main className="px-4 pt-12">
        <WsLink href="/profile" className="text-sm text-muted">‹ Профиль</WsLink>
        <p className="mt-6 text-muted">Доступ только для владельца.</p>
      </main>
    );
  }

  async function patch(id: string, body: Partial<Pick<AdminUser, "isActive" | "role">>) {
    await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    mutate();
  }

  return (
    <main className="px-4 pt-12">
      <WsLink href="/profile" className="text-sm text-muted">‹ Профиль</WsLink>
      <h1 className="mb-4 mt-2 text-2xl font-semibold">Пользователи</h1>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data?.map((u) => {
            const isOwner = u.role === "owner";
            const isSelf = u.id === me?.id;
            return (
              <div key={u.id} className={`flex items-center gap-3 rounded-2xl bg-surface p-3 ${u.isActive ? "" : "opacity-60"}`}>
                <Avatar src={u.avatarUrl} name={u.displayName} className="h-10 w-10 shrink-0 bg-accent text-white" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.displayName}{isSelf ? " · вы" : ""}</div>
                  <div className="text-xs text-muted">{ROLE_LABEL[u.role] ?? u.role}{u.isActive ? "" : " · заблокирован"}</div>
                </div>
                {!isOwner && !isSelf && (
                  <div className="flex shrink-0 gap-1.5">
                    {me?.role === "owner" && (
                      <button
                        onClick={() => patch(u.id, { role: u.role === "admin" ? "member" : "admin" })}
                        className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-muted"
                      >
                        {u.role === "admin" ? "→ участник" : "→ админ"}
                      </button>
                    )}
                    <button
                      onClick={() => patch(u.id, { isActive: !u.isActive })}
                      className={`rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs ${u.isActive ? "text-danger" : "text-ok"}`}
                    >
                      {u.isActive ? "Блок" : "Разблок"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
