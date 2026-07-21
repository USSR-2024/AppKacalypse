"use client";
import { useEffect, useState } from "react";
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
  { href: "/docs", label: "Делопроизводство", icon: "🗂" },
  { href: "/team", label: "Команда", icon: "👥" },
];

const ROLE_LABEL: Record<string, string> = { owner: "Владелец", admin: "Глава", member: "Участник" };

/** Десктопный сайдбар (≥lg). На мобиле скрыт — там нижний таб-бар.
 *
 *  ★ Высота — РОВНО экран (h-dvh) + sticky. Без этого панель — flex-item в строке с
 *  контентом и растягивается на высоту ДОКУМЕНТА: на длинной странице низ (тема,
 *  карточка профиля) уезжает вниз, и до него надо доскроллить. Список пунктов
 *  прокручивается внутри себя (nav flex-1 overflow-y-auto), низ приколот к экрану. */
export function Sidebar({ onNewTask }: { onNewTask: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const ws = useWs();
  const me = useAuth((s) => s.me);
  const { data: mine } = useSWR<WsRow[]>("/workspaces/mine", fetcher);
  const { theme, toggle } = useTheme();
  const [switcher, setSwitcher] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem("sidebar-collapsed") === "1"); }, []);
  function toggleCollapse() {
    setCollapsed((v) => { localStorage.setItem("sidebar-collapsed", v ? "0" : "1"); return !v; });
  }

  const current = mine?.find((w) => w.slug === ws);
  const isOwner = me?.role === "owner";

  // Свёрнут — узкий рельс с ИКОНКАМИ (больше места под рабочую область, но навигация под рукой).
  if (collapsed) {
    const isAdmin = current?.role === "admin" || current?.role === "owner";
    const iconLink = (href: string, icon: string, label: string) => {
      const full = wsHref(ws, href);
      const active = path.startsWith(full);
      return (
        <Link key={href} href={full} title={label}
          className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg transition ${active ? "bg-gold-soft text-gold" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
          {icon}
        </Link>
      );
    };
    return (
      <aside className="sticky top-0 hidden h-dvh w-14 shrink-0 flex-col items-center border-r border-border bg-surface py-3 lg:flex">
        <button onClick={toggleCollapse} title="Развернуть меню" className="mb-2 rounded-lg px-2 py-1.5 text-muted transition hover:bg-surface-2 hover:text-text">»</button>
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {NAV.map((it) => iconLink(it.href, it.icon, it.label))}
          {isAdmin && iconLink("/users", "🧑‍🤝‍🧑", "Участники")}
          {isAdmin && iconLink("/protocol", "🎙", "Расшифровки")}
        </nav>
        <Link href={wsHref(ws, "/profile")} title="Профиль" className="mt-2">
          <Avatar src={me?.avatarUrl} name={me?.displayName} className="h-9 w-9 bg-surface-2 text-sm" />
        </Link>
      </aside>
    );
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-[260px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
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

      {/* Новая задача + свернуть меню */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={onNewTask}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-[var(--shadow)] active:opacity-90"
        >
          ＋ Новая задача
        </button>
        <button
          onClick={toggleCollapse}
          title="Свернуть меню"
          className="shrink-0 rounded-xl px-2.5 py-2.5 text-muted transition hover:bg-surface-2 hover:text-text"
        >
          «
        </button>
      </div>

      {/* Навигация */}
      <nav className="flex-1 overflow-y-auto px-3">
        {NAV.map((it) => {
          const href = wsHref(ws, it.href);
          const active = path.startsWith(href);
          // «Делопроизводство» — раскрывающийся раздел (десктоп-only модуль).
          if (it.href === "/docs") {
            const inDocs = path.startsWith(href);
            const canManage = current?.role === "admin" || current?.role === "owner";
            const isRegistry = path.startsWith(wsHref(ws, "/docs/registry"));
            const isCps = path.startsWith(wsHref(ws, "/docs/counterparties"));
            const isSettings = path.startsWith(wsHref(ws, "/docs/settings"));
            const isInWork = inDocs && !isRegistry && !isCps && !isSettings;
            const sub = [
              { href: "/docs", label: "В работе", on: isInWork },
              { href: "/docs/registry", label: "Реестр документов", on: isRegistry },
              { href: "/docs/counterparties", label: "Реестр контрагентов", on: isCps },
              ...(canManage ? [{ href: "/docs/settings", label: "Настройки", on: isSettings }] : []),
            ];
            return (
              <div key={it.href} className="mb-0.5">
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                    inDocs ? "font-medium text-gold" : "text-muted hover:bg-surface-2 hover:text-text"
                  }`}
                >
                  <span className="text-base">{it.icon}</span>
                  {it.label}
                </Link>
                {inDocs && (
                  <div className="mb-1 ml-5 mt-0.5 flex flex-col border-l border-border pl-3">
                    {sub.map((s) => (
                      <Link
                        key={s.href}
                        href={wsHref(ws, s.href)}
                        className={`rounded-lg px-3 py-1.5 text-sm transition ${
                          s.on ? "font-medium text-gold" : "text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        {s.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <Link
              key={it.href}
              href={href}
              className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                active ? "bg-gold-soft font-medium text-gold shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"
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
            <Link href={href} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-gold-soft font-medium text-gold shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
              <span className="text-base">🧑‍🤝‍🧑</span>
              Участники
            </Link>
          );
        })()}
        {(current?.role === "admin" || current?.role === "owner") && (() => {
          const href = wsHref(ws, "/protocol");
          const active = path.startsWith(href);
          return (
            <Link href={href} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-gold-soft font-medium text-gold shadow-[var(--shadow)]" : "text-muted hover:bg-surface-2 hover:text-text"}`}>
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
