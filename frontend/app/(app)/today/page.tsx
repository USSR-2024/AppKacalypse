"use client";
import Link from "next/link";
import { isPast, isToday } from "date-fns";
import { useAuth } from "@/lib/store";
import { useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import type { Task } from "@/lib/types";

function Section({ title, tasks, tone }: { title: string; tasks: Task[]; tone?: string }) {
  if (!tasks.length) return null;
  return (
    <section className="mb-5">
      <h2 className={`mb-2 px-1 text-xs font-medium uppercase tracking-wide ${tone ?? "text-muted"}`}>
        {title} · {tasks.length}
      </h2>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => <TaskItem key={t.id} task={t} />)}
      </div>
    </section>
  );
}

export default function TodayPage() {
  const me = useAuth((s) => s.me);
  const { data, isLoading } = useTasks("?mine=1&status=queued,in_progress");
  const tasks = data ?? [];

  const due = (t: Task) => (t.dueAt ? new Date(t.dueAt) : null);
  const overdue = tasks.filter((t) => { const d = due(t); return d && isPast(d) && !isToday(d); });
  const today = tasks.filter((t) => { const d = due(t); return d && isToday(d); });
  const rest = tasks.filter((t) => !overdue.includes(t) && !today.includes(t));
  const upcoming = rest.filter((t) => due(t));        // есть срок, но не сегодня/не просрочено
  const noDue = rest.filter((t) => !due(t));
  const important = noDue.filter((t) => t.isImportant);
  const other = noDue.filter((t) => !t.isImportant);

  return (
    <main className="px-4 pt-12">
      <header className="mb-6 flex items-end justify-between">
        <div>
        <p className="text-sm text-muted">{me ? `Привет, ${me.displayName}` : " "}</p>
        <h1 className="text-2xl font-semibold">Сегодня</h1>
        </div>
        <Link href="/done" className="rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          ✓ Выполненные
        </Link>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-10 text-center text-muted">Задач на сегодня нет 🎉</p>
      ) : (
        <>
          <Section title="Просрочено" tasks={overdue} tone="text-danger" />
          <Section title="Сегодня" tasks={today} tone="text-warn" />
          <Section title="Предстоит" tasks={upcoming} />
          <Section title="Важное" tasks={important} />
          <Section title="Без срока" tasks={other} />
        </>
      )}
    </main>
  );
}
