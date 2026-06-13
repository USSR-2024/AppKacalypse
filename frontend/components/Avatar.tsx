"use client";
import { useState } from "react";

// Аватар с фолбэком на первую букву имени, если картинки нет или она не загрузилась
// (напр. Telegram-аватары с t.me — заблокированы в РФ). Размер/фон задаёт className.
export function Avatar({ src, name, className }: { src?: string | null; name?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`flex items-center justify-center overflow-hidden rounded-full ${className ?? ""}`}>
      {src && !broken ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span>{name ? name.slice(0, 1).toUpperCase() : "·"}</span>
      )}
    </span>
  );
}
