"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWs, wsHref } from "@/lib/ws";

const items = [
  { href: "/today", label: "Сегодня", icon: "☀️" },
  { href: "/inbox", label: "Входящие", icon: "📥" },
  { href: "/assistant", label: "Ассистент", icon: "🤖" },
  { href: "/projects", label: "Проекты", icon: "📁" },
  { href: "/calendar", label: "Календарь", icon: "🗓" },
];

export function BottomNav() {
  const path = usePathname();
  const ws = useWs();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <div className="flex" style={{ paddingBottom: "max(calc(env(safe-area-inset-bottom) - 0.5rem), 0px)" }}>
        {items.map((it) => {
          const href = wsHref(ws, it.href);
          const active = path.startsWith(href);
          return (
            <Link
              key={it.href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-lg">{it.icon}</span>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
