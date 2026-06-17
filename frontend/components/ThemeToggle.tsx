"use client";
import { useTheme } from "@/lib/theme";

const OPTS: { v: "dark" | "light"; label: string }[] = [
  { v: "dark", label: "🌙 Тёмная" },
  { v: "light", label: "☀️ Светлая" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex rounded-xl bg-surface-2 p-0.5">
      {OPTS.map((o) => (
        <button
          key={o.v}
          onClick={() => setTheme(o.v)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition ${
            theme === o.v ? "bg-accent text-white" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
