"use client";
import Link from "next/link";
import { useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";

export default function DonePage() {
  const { data, isLoading } = useTasks("?mine=1&status=done,cancelled,archived");
  const tasks = data ?? [];

  return (
    <main className="px-4 pt-12">
      <Link href="/profile" className="text-sm text-muted">‹ Профиль</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold">Выполненные</h1>
        <p className="mt-1 text-sm text-muted">Готовые, отменённые и архив</p>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-10 text-center text-muted">Пока пусто</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tasks.map((t) => <TaskItem key={t.id} task={t} />)}
        </div>
      )}
    </main>
  );
}
