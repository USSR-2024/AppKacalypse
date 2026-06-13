"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/today", label: "Сегодня", icon: "☀️" },
  { href: "/inbox", label: "Входящие", icon: "📥" },
  { href: "/assistant", label: "Ассистент", icon: "🤖" },
  { href: "/projects", label: "Проекты", icon: "📁" },
  { href: "/calendar", label: "Календарь", icon: "🗓" },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-border bg-surface/95 backdrop-blur">
      <div className="flex" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {items.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
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
