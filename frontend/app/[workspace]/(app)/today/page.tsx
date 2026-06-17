"use client";
import { WsLink } from "@/components/WsLink";
import { isPast, isToday, format } from "date-fns";
import { ru } from "date-fns/locale";
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

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between">
        <span className={`text-3xl font-bold ${tone ?? ""}`}>{value}</span>
        <span className="text-xl opacity-60">{icon}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

export default function TodayPage() {
  const me = useAuth((s) => s.me);
  const { data, isLoading } = useTasks("?mine=1&status=queued,in_progress");
  const { data: doneData } = useTasks("?mine=1&status=done");
  const tasks = data ?? [];

  const due = (t: Task) => (t.dueAt ? new Date(t.dueAt) : null);
  const overdue = tasks.filter((t) => { const d = due(t); return d && isPast(d) && !isToday(d); });
  const today = tasks.filter((t) => { const d = due(t); return d && isToday(d); });
  const rest = tasks.filter((t) => !overdue.includes(t) && !today.includes(t));
  const upcoming = rest.filter((t) => due(t));        // есть срок, но не сегодня/не просрочено
  const noDue = rest.filter((t) => !due(t));
  const important = noDue.filter((t) => t.isImportant);
  const other = noDue.filter((t) => !t.isImportant);

  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const doneToday = (doneData ?? []).filter((t) => t.completedAt && isToday(new Date(t.completedAt))).length;

  const firstName = me?.displayName?.split(/\s+/)[0] ?? "";

  return (
    <main className="px-4 pt-12 lg:pt-2">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted">{firstName ? `Привет, ${firstName}! 👋` : " "}</p>
          <h1 className="text-2xl font-semibold lg:text-3xl">
            Сегодня, <span className="text-accent">{format(new Date(), "d MMMM", { locale: ru })}</span>
          </h1>
        </div>
        <WsLink href="/done" className="shrink-0 rounded-xl bg-surface px-3 py-2 text-sm text-muted">
          ✓ Выполненные
        </WsLink>
      </header>

      {/* KPI */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="На сегодня" value={today.length} icon="📌" tone="text-accent" />
        <Kpi label="В работе" value={inProgress} icon="⚙️" />
        <Kpi label="Просрочено" value={overdue.length} icon="🔥" tone={overdue.length ? "text-danger" : ""} />
        <Kpi label="Завершено сегодня" value={doneToday} icon="✓" tone={doneToday ? "text-ok" : ""} />
      </div>

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
