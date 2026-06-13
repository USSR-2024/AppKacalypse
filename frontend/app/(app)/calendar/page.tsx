"use client";
import { useState } from "react";
import {
  format, isToday, isSameMonth, isSameDay,
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

type Filter = "all" | "personal" | "work";

export default function CalendarPage() {
  const { data, isLoading } = useTasks("?mine=1&status=queued,in_progress");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<Date>(() => new Date());

  // Фильтр личные/рабочие + корзины по локальному дню.
  const groups = new Map<string, Task[]>();
  for (const t of data ?? []) {
    if (!t.dueAt) continue;
    if (filter === "personal" && t.projectId) continue;
    if (filter === "work" && !t.projectId) continue;
    const k = key(new Date(t.dueAt));
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));

  const step = (dir: -1 | 1) => setAnchor((a) => (expanded ? addMonths(a, dir) : addWeeks(a, dir)));
  const pick = (d: Date) => { setSelected(d); setAnchor(d); };

  const weekStart = startOfWeek(anchor, WEEK);
  const label = expanded
    ? format(anchor, "LLLL yyyy", { locale: ru })
    : `${format(weekStart, "d")}–${format(endOfWeek(anchor, WEEK), "d MMM", { locale: ru })}`;

  const cells = expanded
    ? eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor), WEEK), end: endOfWeek(endOfMonth(anchor), WEEK) })
    : eachDayOfInterval({ start: weekStart, end: endOfWeek(anchor, WEEK) });

  const selTasks = groups.get(key(selected)) ?? [];

  return (
    <main className="px-4 pt-12">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Календарь</h1>
        <div className="flex rounded-xl bg-surface p-0.5 text-xs">
          {([["all", "Все"], ["personal", "Личные"], ["work", "Рабочие"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} className={`rounded-lg px-2.5 py-1.5 ${filter === v ? "bg-surface-2 font-medium" : "text-muted"}`}>{l}</button>
          ))}
        </div>
      </header>

      <div className="mb-3 rounded-2xl bg-surface p-2">
        <div className="mb-1 flex items-center justify-between">
          <button onClick={() => step(-1)} aria-label="Назад" className="rounded-lg px-3 py-1 text-lg text-muted active:bg-surface-2">‹</button>
          <span className="text-sm font-medium capitalize">{label}</span>
          <button onClick={() => step(1)} aria-label="Вперёд" className="rounded-lg px-3 py-1 text-lg text-muted active:bg-surface-2">›</button>
        </div>

        {expanded && (
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
            {WD.map((w) => <div key={w}>{w}</div>)}
          </div>
        )}

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const has = (groups.get(key(d))?.length ?? 0) > 0;
            const sel = isSameDay(d, selected);
            const today = isToday(d);
            const dim = expanded && !isSameMonth(d, anchor);
            return (
              <button
                key={key(d)}
                onClick={() => pick(d)}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm
                  ${sel ? "bg-accent text-white" : today ? "bg-surface-2" : ""} ${dim ? "text-muted/40" : ""}`}
              >
                {!expanded && <span className="text-[10px] uppercase opacity-70">{WD[(d.getDay() + 6) % 7]}</span>}
                <span>{format(d, "d")}</span>
                <span className={`mt-0.5 h-1 w-1 rounded-full ${has ? (sel ? "bg-white" : "bg-accent") : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 flex w-full items-center justify-center rounded-lg py-1 text-xs text-muted active:bg-surface-2"
          aria-label={expanded ? "Свернуть" : "Развернуть на месяц"}
        >
          {expanded ? "▲ свернуть" : "▼ месяц"}
        </button>
      </div>

      <section>
        <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-accent">
          {format(selected, "EEEE, d MMMM", { locale: ru })}{isToday(selected) ? " · сегодня" : ""}
        </h2>
        {isLoading ? (
          <p className="text-muted">Загрузка…</p>
        ) : selTasks.length ? (
          <div className="flex flex-col gap-2">{selTasks.map((t) => <TaskItem key={t.id} task={t} />)}</div>
        ) : (
          <p className="px-1 text-sm text-muted">Нет задач на этот день</p>
        )}
      </section>
    </main>
  );
}
