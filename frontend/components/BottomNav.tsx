"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWs, wsHref } from "@/lib/ws";

// Встречи — полноценная вкладка: планёрки идут через них каждый день, а с телефона
// до раздела было НЕ добраться (жил только в десктопном сайдбаре).
const items = [
  { href: "/today", label: "Сегодня", icon: "☀️" },
  { href: "/inbox", label: "Входящие", icon: "📥" },
  { href: "/assistant", label: "Ассистент", icon: "🤖" },
  { href: "/projects", label: "Проекты", icon: "📁" },
  { href: "/calendar", label: "Календарь", icon: "🗓" },
  { href: "/meet", label: "Встречи", icon: "📹" },
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
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 pt-2 pb-1 text-[10px] max-[359px]:px-0 max-[359px]:text-[9px] ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-lg">{it.icon}</span>
              {/* Шесть вкладок: на узком экране подпись обрезаем, а не ломаем строку. */}
              <span className="w-full truncate text-center">{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
