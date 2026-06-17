"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useAuth } from "@/lib/store";
import { fetcher, api } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { registerSW } from "@/lib/push";
import { Avatar } from "@/components/Avatar";
import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TaskComposer } from "@/components/TaskComposer";
import type { Me } from "@/lib/types";

interface WsRow { slug: string }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ws = useWs();
  const token = useAuth((s) => s.token);
  const setMe = useAuth((s) => s.setMe);
  const [ready, setReady] = useState(false);
  const [composer, setComposer] = useState(false);
  // Прячем FAB на ассистенте (свой ввод) и в карточке задачи (перекрывал кнопку отправки коммента).
  const hideFab = pathname.includes("/assistant") || pathname.includes("/tasks/");

  // Гейт: нет токена → /login; есть, но юзер не член этого воркспейса → лендинг (выбор/сообщение).
  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mine = await api<WsRow[]>("/workspaces/mine");
        if (cancelled) return;
        if (mine.some((w) => w.slug === ws)) setReady(true);
        else router.replace("/");
      } catch {
        if (!cancelled) router.replace("/");
      }
    })();
    return () => { cancelled = true; };
  }, [token, ws, router]);

  useEffect(() => {
    registerSW();
  }, []);

  const { data: me } = useSWR<Me>(token ? "/me" : null, fetcher);
  useEffect(() => {
    if (me) setMe(me);
  }, [me, setMe]);

  if (!ready) return null;

  return (
    <div className="flex min-h-dvh">
      {/* Десктопный сайдбар (≥lg). На мобиле скрыт. */}
      <Sidebar onNewTask={() => setComposer(true)} />

      <div className="relative flex min-h-dvh flex-1 flex-col">
        {/* Плавающая кнопка профиля — только на мобиле (на десктопе профиль в сайдбаре). */}
        <Link
          href={wsHref(ws, "/profile")}
          className="fixed right-2 z-30 p-2 lg:hidden"
          style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
          aria-label="Профиль"
        >
          <Avatar src={me?.avatarUrl} name={me?.displayName} className="h-9 w-9 bg-surface text-sm" />
        </Link>

        {/* На мобиле узкая колонка (как было), на десктопе — шире и без верхнего отступа под плавающую кнопку. */}
        <div
          className="mx-auto w-full max-w-md flex-1 pb-24 lg:max-w-3xl lg:px-6 lg:pb-10 lg:pt-8"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
        >
          <PullToRefresh>{children}</PullToRefresh>
        </div>

        {/* FAB — только на мобиле (на десктопе «Новая задача» в сайдбаре). */}
        {!hideFab && (
          <button
            onClick={() => setComposer(true)}
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}
            className="fixed right-1/2 z-40 flex h-14 w-14 translate-x-[calc(min(50vw,28rem/2)-1rem)] items-center justify-center rounded-full bg-accent text-3xl text-white shadow-lg shadow-accent/30 active:scale-95 lg:hidden"
            aria-label="Новая задача"
          >
            +
          </button>
        )}

        {composer && <TaskComposer onClose={() => setComposer(false)} />}
        <BottomNav />
      </div>
    </div>
  );
}
