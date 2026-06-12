"use client";
import { useEffect, useRef } from "react";

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TgUser) => void;
  }
}

export function TelegramLogin({ onAuth }: { onAuth: (user: TgUser) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bot = process.env.NEXT_PUBLIC_TG_BOT;

  useEffect(() => {
    window.onTelegramAuth = onAuth;
    const el = ref.current;
    if (!el || !bot) return;
    el.innerHTML = "";
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    el.appendChild(s);
  }, [bot, onAuth]);

  if (!bot) return null;
  return <div ref={ref} />;
}
