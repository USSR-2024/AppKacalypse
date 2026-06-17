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

interface WsRow { slug: string; name: string; status: "active" | "pending" }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ws = useWs();
  const token = useAuth((s) => s.token);
  const setMe = useAuth((s) => s.setMe);
  const logout = useAuth((s) => s.logout);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<string | null>(null);  // имя ws, куда подана заявка
  const [composer, setComposer] = useState(false);
  // Прячем FAB на ассистенте (свой ввод) и в карточке задачи (перекрывал кнопку отправки коммента).
  const hideFab = pathname.includes("/assistant") || pathname.includes("/tasks/");

  // Гейт: нет токена → /login; членство active → внутрь; pending → экран ожидания; иначе → лендинг.
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
        const cur = mine.find((w) => w.slug === ws);
        if (cur?.status === "active") setReady(true);
        else if (cur?.status === "pending") setPending(cur.name);
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

  if (pending) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-5xl">⏳</div>
        <p className="text-lg font-medium">Заявка на рассмотрении</p>
        <p className="text-muted">Ты подал заявку на вступление в «{pending}». Доступ откроется, когда администратор её одобрит — бот пришлёт уведомление.</p>
        <button onClick={() => logout()} className="mt-2 text-sm text-muted underline">Выйти</button>
      </main>
    );
  }

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
