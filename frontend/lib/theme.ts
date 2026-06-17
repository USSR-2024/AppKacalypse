"use client";
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "akc_theme";

/** Тема приложения. Применяется через data-theme на <html> (см. globals.css + layout.tsx). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (typeof window !== "undefined" ? localStorage.getItem(KEY) : null) as Theme | null;
    setTheme(saved === "light" ? "light" : "dark");
  }, []);

  function update(t: Theme) {
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
      document.documentElement.dataset.theme = t;
    } catch {}
  }

  return { theme, setTheme: update, toggle: () => update(theme === "dark" ? "light" : "dark") };
}
