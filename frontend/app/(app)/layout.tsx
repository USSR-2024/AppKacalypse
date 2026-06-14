"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { useAuth } from "@/lib/store";
import { fetcher } from "@/lib/api";
import { registerSW } from "@/lib/push";
import { Avatar } from "@/components/Avatar";
import { BottomNav } from "@/components/BottomNav";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TaskComposer } from "@/components/TaskComposer";
import type { Me } from "@/lib/types";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useAuth((s) => s.token);
  const setMe = useAuth((s) => s.setMe);
  const [ready, setReady] = useState(false);
  const [composer, setComposer] = useState(false);
  const hideFab = pathname.startsWith("/assistant");

  useEffect(() => {
    if (!token) router.replace("/login");
    else setReady(true);
  }, [token, router]);

  useEffect(() => {
    registerSW();
  }, []);

  const { data: me } = useSWR<Me>(token ? "/me" : null, fetcher);
  useEffect(() => {
    if (me) setMe(me);
  }, [me, setMe]);

  if (!ready) return null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <Link href="/profile" className="fixed right-4 top-4 z-30" aria-label="Профиль">
        <Avatar src={me?.avatarUrl} name={me?.displayName} className="h-9 w-9 bg-surface text-sm" />
      </Link>

      <div className="flex-1 pb-24">
        <PullToRefresh>{children}</PullToRefresh>
      </div>

      {!hideFab && (
        <button
          onClick={() => setComposer(true)}
          className="fixed bottom-20 right-1/2 z-40 flex h-14 w-14 translate-x-[calc(min(50vw,28rem/2)-1rem)] items-center justify-center rounded-full bg-accent text-3xl text-white shadow-lg shadow-accent/30 active:scale-95"
          aria-label="Новая задача"
        >
          +
        </button>
      )}

      {composer && <TaskComposer onClose={() => setComposer(false)} />}
      <BottomNav />
    </div>
  );
}
