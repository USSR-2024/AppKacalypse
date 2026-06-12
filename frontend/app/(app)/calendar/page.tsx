"use client";
import { format, isToday, isTomorrow } from "date-fns";
import { ru } from "date-fns/locale";
import { useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import type { Task } from "@/lib/types";

function dayLabel(d: Date): string {
  if (isToday(d)) return "Сегодня";
  if (isTomorrow(d)) return "Завтра";
  return format(d, "EEEE, d MMMM", { locale: ru });
}

export default function CalendarPage() {
  const { data, isLoading } = useTasks("?mine=1&status=queued,in_progress");
  const withDue = (data ?? []).filter((t) => t.dueAt).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));

  // Группировка по дню (YYYY-MM-DD)
  const groups = new Map<string, Task[]>();
  for (const t of withDue) {
    const key = t.dueAt!.slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return (
    <main className="px-4 pt-12">
      <header className="mb-6">
        <p className="text-sm text-muted">Повестка по дням</p>
        <h1 className="text-2xl font-semibold">Календарь</h1>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : groups.size === 0 ? (
        <p className="mt-10 text-center text-muted">Нет задач со сроком</p>
      ) : (
        [...groups.entries()].map(([key, tasks]) => (
          <section key={key} className="mb-5">
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-accent">
              {dayLabel(new Date(key))}
            </h2>
            <div className="flex flex-col gap-2">
              {tasks.map((t) => <TaskItem key={t.id} task={t} />)}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
