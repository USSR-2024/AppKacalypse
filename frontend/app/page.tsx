"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";
import { api } from "@/lib/api";

interface WsRow { id: string; slug: string; name: string; role: string; status: "active" | "pending" }

export default function Home() {
  const router = useRouter();
  const [list, setList] = useState<WsRow[] | null>(null);
  const [pending, setPending] = useState<WsRow[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!useAuth.getState().token) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const all = await api<WsRow[]>("/workspaces/mine");
        if (cancelled) return;
        const active = all.filter((w) => w.status === "active");
        if (active.length === 1) { router.replace(`/${active[0].slug}/today`); return; }
        setList(active);
        setPending(all.filter((w) => w.status === "pending"));
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // Один воркспейс → редирект (рендер ниже не успеет показаться).
  if (list === null && !err) {
    return <main className="flex min-h-dvh items-center justify-center text-muted">Загрузка…</main>;
  }

  if (err) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted">Не удалось загрузить пространства.</p>
        <button onClick={() => location.reload()} className="rounded-xl bg-accent px-4 py-2 font-medium text-white">Повторить</button>
      </main>
    );
  }

  if (list && list.length === 0) {
    // Только заявки на рассмотрении.
    if (pending.length > 0) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-5xl">⏳</div>
          <p className="text-lg font-medium">Заявка на рассмотрении</p>
          <p className="text-muted">Ты подал заявку в «{pending.map((w) => w.name).join("», «")}». Доступ откроется после одобрения администратора — бот пришлёт уведомление.</p>
          <button onClick={() => useAuth.getState().logout()} className="mt-2 text-sm text-muted underline">Выйти</button>
        </main>
      );
    }
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-medium">Нет доступных пространств</p>
        <p className="text-muted">Ты ещё не добавлен ни в одну компанию. Попроси администратора прислать приглашение в пространство.</p>
        <button onClick={() => useAuth.getState().logout()} className="mt-2 text-sm text-muted underline">Выйти</button>
      </main>
    );
  }

  // Несколько пространств → выбор.
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-6 py-12">
      <h1 className="text-xl font-semibold">Выбери пространство</h1>
      <div className="flex flex-col gap-2">
        {list?.map((w) => (
          <button
            key={w.id}
            onClick={() => router.replace(`/${w.slug}/today`)}
            className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left active:bg-surface-2"
          >
            <span className="font-medium">{w.name}</span>
            <span className="text-xs text-muted">{w.role}</span>
          </button>
        ))}
      </div>
      <button onClick={() => useAuth.getState().logout()} className="mt-2 text-sm text-muted underline">Выйти</button>
    </main>
  );
}
