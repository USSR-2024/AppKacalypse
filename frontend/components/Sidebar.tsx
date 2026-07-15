"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "@/lib/store";
import { fetcher } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { useTheme } from "@/lib/theme";
import { Avatar } from "@/components/Avatar";

interface WsRow { id: string; slug: string; name: string; role: string }

const NAV = [
  { href: "/today", label: "Сегодня", icon: "☀️" },
  { href: "/inbox", label: "Входящие", icon: "📥" },
  { href: "/assistant", label: "Ассистент", icon: "🤖" },
  { href: "/projects", label: "Проекты", icon: "📁" },
  { href: "/calendar", label: "Календарь", icon: "🗓" },
  { href: "/meet", label: "Встречи", icon: "📹" },
  { href: "/team", label: "Команда", icon: "👥" },
];

const ROLE_LABEL: Record<string, string> = { owner: "Владелец", admin: "Глава", member: "Участник" };

/** Десктопный сайдбар (≥lg). На мобиле скрыт — там нижний таб-бар. */
export function Sidebar({ onNewTask }: { onNewTask: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const ws = useWs();
  const me = useAuth((s) => s.me);
  const { data: mine } = useSWR<WsRow[]>("/workspaces/mine", fetcher);
  const { theme, toggle } = useTheme();
  const [switcher, setSwitcher] = useState(false);

  const current = mine?.find((w) => w.slug === ws);
  const isOwner = me?.role === "owner";

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
      {/* Шапка: переключатель пространства */}
      <div className="relative border-b border-border p-3">
        <button
          onClick={() => setSwitcher((v) => !v)}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-surface-2"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            {(current?.name ?? ws).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{current?.name ?? ws}</div>
            <div className="truncate text-xs text-muted">Пространство</div>
          </div>
          <span className="text-muted">⌄</span>
        </button>

        {switcher && (
          <div className="absolute inset-x-3 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-strong)]">
            {(mine ?? []).map((w) => (
              <button
                key={w.id}
                onClick={() => { setSwitcher(false); if (w.slug !== ws) router.push(`/${w.slug}/today`); }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2 ${w.slug === ws ? "text-accent" : ""}`}
              >
                <span className="truncate">{w.name}</span>
                {w.slug === ws && <span className="text-xs">✓</span>}
              </button>
            ))}
            {isOwner && (
              <Link
                href="/owner"
                onClick={() => setSwitcher(false)}
                className="block border-t border-border px-3 py-2 text-sm text-accent hover:bg-surface-2"
              >
                🛠 Owner-консоль
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Новая задача */}
      <div className="p-3">
        <button
          onClick={onNewTask}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-[var(--shadow)] active:opacity-90"
        >
          ＋ Новая задача
        </button>
      </div>

      {/* Навигация */}
      <nav className="flex-1 overflow-y-auto px-3">
        {NAV.map((it) => {
          const href = wsHref(ws, it.href);
          const active = path.startsWith(href);
          return (
            <Link
              key={it.href}
              href={href}
              className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                active ? "bg-surface-2 font-medium text-accent shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <span className="text-base">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
        {(current?.role === "admin" || current?.role === "owner") && (() => {
          const href = wsHref(ws, "/users");
          const active = path.startsWith(href);
          return (
            <Link href={href} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-surface-2 font-medium text-accent shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
              <span className="text-base">🧑‍🤝‍🧑</span>
              Участники
            </Link>
          );
        })()}
        {(current?.role === "admin" || current?.role === "owner") && (() => {
          const href = wsHref(ws, "/protocol");
          const active = path.startsWith(href);
          return (
            <Link href={href} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-surface-2 font-medium text-accent shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
              <span className="text-base">🎙</span>
              Расшифровки
            </Link>
          );
        })()}
      </nav>

      {/* Низ: тема + профиль */}
      <div className="border-t border-border p-3">
        <button
          onClick={toggle}
          className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
        >
          <span className="text-base">{theme === "dark" ? "🌙" : "☀️"}</span>
          {theme === "dark" ? "Тёмная тема" : "Светлая тема"}
        </button>
        <Link href={wsHref(ws, "/profile")} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface-2">
          <Avatar src={me?.avatarUrl} name={me?.displayName} className="h-9 w-9 bg-surface-2 text-sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{me?.displayName ?? "—"}</div>
            <div className="truncate text-xs text-muted">{current ? ROLE_LABEL[current.role] ?? current.role : ""}</div>
          </div>
          <span className="text-muted">⚙</span>
        </Link>
      </div>
    </aside>
  );
}
