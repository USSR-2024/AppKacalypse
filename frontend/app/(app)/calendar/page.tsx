"use client";
import { useState } from "react";
import {
  format, isToday, isSameMonth,
  startOfWeek, endOfWeek, addWeeks,
  startOfMonth, endOfMonth, addMonths, eachDayOfInterval,
} from "date-fns";
import { ru } from "date-fns/locale";
import { useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import type { Task } from "@/lib/types";

const WD = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const key = (d: Date) => format(d, "yyyy-MM-dd");
const WEEK = { weekStartsOn: 1 } as const;

export default function CalendarPage() {
  const { data, isLoading } = useTasks("?mine=1&status=queued,in_progress");
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<string>(() => key(new Date()));

  // Задачи со сроком → корзины по локальному дню.
  const groups = new Map<string, Task[]>();
  for (const t of data ?? []) {
    if (!t.dueAt) continue;
    const k = key(new Date(t.dueAt));
    const arr = groups.get(k);
    if (arr) arr.push(t);
    else groups.set(k, [t]);
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));

  const step = (dir: -1 | 1) =>
    setAnchor((a) => (view === "week" ? addWeeks(a, dir) : addMonths(a, dir)));

  const weekStart = startOfWeek(anchor, WEEK);
  const weekEnd = endOfWeek(anchor, WEEK);
  const label =
    view === "week"
      ? `${format(weekStart, "d")}–${format(weekEnd, "d MMM", { locale: ru })}`
      : format(anchor, "LLLL yyyy", { locale: ru });

  return (
    <main className="px-4 pt-12">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Календарь</h1>
        <div className="flex rounded-xl bg-surface p-0.5 text-sm">
          <button onClick={() => setView("week")} className={`rounded-lg px-3 py-1.5 ${view === "week" ? "bg-surface-2" : "text-muted"}`}>Неделя</button>
          <button onClick={() => setView("month")} className={`rounded-lg px-3 py-1.5 ${view === "month" ? "bg-surface-2" : "text-muted"}`}>Месяц</button>
        </div>
      </header>

      <div className="mb-5 flex items-center justify-between">
        <button onClick={() => step(-1)} aria-label="Назад" className="rounded-lg px-3 py-1.5 text-lg text-muted active:bg-surface">‹</button>
        <span className="text-sm font-medium capitalize">{label}</span>
        <button onClick={() => step(1)} aria-label="Вперёд" className="rounded-lg px-3 py-1.5 text-lg text-muted active:bg-surface">›</button>
      </div>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : view === "week" ? (
        <WeekView days={eachDayOfInterval({ start: weekStart, end: weekEnd })} groups={groups} />
      ) : (
        <MonthView anchor={anchor} groups={groups} selected={selected} onSelect={setSelected} />
      )}
    </main>
  );
}

function WeekView({ days, groups }: { days: Date[]; groups: Map<string, Task[]> }) {
  return (
    <>
      {days.map((d) => {
        const tasks = groups.get(key(d)) ?? [];
        const today = isToday(d);
        return (
          <section key={key(d)} className="mb-4">
            <h2 className={`mb-2 px-1 text-xs font-medium uppercase tracking-wide ${today ? "text-accent" : "text-muted"}`}>
              {format(d, "EEEEEE d", { locale: ru })}{today ? " · сегодня" : ""}
            </h2>
            {tasks.length ? (
              <div className="flex flex-col gap-2">{tasks.map((t) => <TaskItem key={t.id} task={t} />)}</div>
            ) : (
              <p className="px-1 text-xs text-muted/50">—</p>
            )}
          </section>
        );
      })}
    </>
  );
}

function MonthView({
  anchor, groups, selected, onSelect,
}: {
  anchor: Date;
  groups: Map<string, Task[]>;
  selected: string;
  onSelect: (k: string) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(anchor), WEEK);
  const gridEnd = endOfWeek(endOfMonth(anchor), WEEK);
  const cells = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const selTasks = groups.get(selected) ?? [];

  return (
    <>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
        {WD.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const k = key(d);
          const has = (groups.get(k)?.length ?? 0) > 0;
          const inMonth = isSameMonth(d, anchor);
          const today = isToday(d);
          const sel = k === selected;
          return (
            <button
              key={k}
              onClick={() => onSelect(k)}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm
                ${sel ? "bg-accent text-white" : today ? "bg-surface-2" : ""}
                ${inMonth ? "" : "text-muted/40"}`}
            >
              <span>{format(d, "d")}</span>
              <span className={`mt-0.5 h-1 w-1 rounded-full ${has ? (sel ? "bg-white" : "bg-accent") : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-accent">
          {format(new Date(`${selected}T00:00:00`), "EEEE, d MMMM", { locale: ru })}
        </h2>
        {selTasks.length ? (
          <div className="flex flex-col gap-2">{selTasks.map((t) => <TaskItem key={t.id} task={t} />)}</div>
        ) : (
          <p className="px-1 text-sm text-muted">Нет задач</p>
        )}
      </section>
    </>
  );
}
