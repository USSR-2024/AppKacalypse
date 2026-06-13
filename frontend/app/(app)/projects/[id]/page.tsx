"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/store";
import { useProjects, useTasks, useUsers } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import { STATUS_LABELS } from "@/lib/format";
import type { ProjectView, Task, TaskStatus } from "@/lib/types";

const BOARD_COLS: TaskStatus[] = ["queued", "in_progress", "done"];

function fmtDue(due: string | null): string {
  if (!due) return "—";
  return new Date(due).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function MiniCard({ task }: { task: Task }) {
  const { data: users } = useUsers();
  const assignee = users?.find((u) => u.id === task.assigneeId);
  return (
    <Link href={`/tasks/${task.id}`} className="block rounded-xl bg-surface px-3 py-2.5">
      <div className="text-sm leading-tight">
        {task.isImportant && <span className="mr-1 text-warn">★</span>}
        {task.title}
      </div>
      {assignee && <div className="mt-1 text-xs text-muted">👤 {assignee.displayName}</div>}
    </Link>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useAuth((s) => s.me);
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const project = projects?.find((p) => p.id === id);
  const { data, isLoading } = useTasks(`?projectId=${id}`);
  const tasks = data ?? [];

  // Вид по умолчанию — из профиля (сервер); на экране можно переключить на сессию.
  const [view, setView] = useState<ProjectView | null>(null);
  useEffect(() => { if (view === null && me) setView(me.projectView); }, [me, view]);
  const v: ProjectView = view ?? me?.projectView ?? "list";

  // Доска: свайп по колонкам (по экрану на колонку), gap-3 = 12px между ними.
  const boardRef = useRef<HTMLDivElement>(null);
  const [activeCol, setActiveCol] = useState(0);
  const step = () => (boardRef.current?.clientWidth ?? 0) + 12;
  const onBoardScroll = () => {
    if (boardRef.current) setActiveCol(Math.round(boardRef.current.scrollLeft / step()));
  };
  const goCol = (i: number) => boardRef.current?.scrollTo({ left: i * step(), behavior: "smooth" });

  const active = tasks.filter((t) => t.status === "queued" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <main className="px-4 pt-12">
      <Link href="/projects" className="text-sm text-muted">‹ Проекты</Link>
      <header className="mb-4 mt-2 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project?.name ?? "Проект"}</h1>
          <p className="mt-1 text-sm text-muted">{active.length} активных · {done.length} готово</p>
        </div>
        <div className="flex rounded-xl bg-surface p-0.5 text-sm">
          {([["list", "Список"], ["board", "Доска"], ["table", "Таблица"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-lg px-3 py-1.5 ${v === key ? "bg-surface-2" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-8 text-center text-muted">В проекте пока нет задач</p>
      ) : v === "board" ? (
        <div>
          <div className="mb-3 flex gap-1 rounded-xl bg-surface p-0.5 text-xs">
            {BOARD_COLS.map((col, i) => (
              <button
                key={col}
                onClick={() => goCol(i)}
                className={`flex-1 rounded-lg px-2 py-1.5 ${activeCol === i ? "bg-surface-2 font-medium" : "text-muted"}`}
              >
                {STATUS_LABELS[col]} · {tasks.filter((t) => t.status === col).length}
              </button>
            ))}
          </div>
          <div
            ref={boardRef}
            onScroll={onBoardScroll}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {BOARD_COLS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col);
              return (
                <div key={col} className="flex w-full shrink-0 snap-start flex-col gap-2">
                  {colTasks.map((t) => <MiniCard key={t.id} task={t} />)}
                  {colTasks.length === 0 && <div className="rounded-xl border border-dashed border-border py-12 text-center text-xs text-muted">пусто</div>}
                </div>
              );
            })}
          </div>
        </div>
      ) : v === "table" ? (
        <div className="overflow-hidden rounded-2xl bg-surface">
          <div className="grid grid-cols-[1fr_3.5rem_5rem] gap-2 border-b border-border px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
            <span>Задача</span><span>Срок</span><span>Статус</span>
          </div>
          {tasks.map((t) => {
            const assignee = users?.find((u) => u.id === t.assigneeId);
            return (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="grid grid-cols-[1fr_3.5rem_5rem] items-center gap-2 border-b border-border/40 px-3 py-3 text-sm last:border-0 active:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.isImportant && <span className="mr-1 text-warn">★</span>}{t.title}</span>
                  {assignee && <span className="block truncate text-xs text-muted">👤 {assignee.displayName}</span>}
                </span>
                <span className="text-xs text-muted">{fmtDue(t.dueAt)}</span>
                <span className="text-xs text-muted">{STATUS_LABELS[t.status]}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((t) => <TaskItem key={t.id} task={t} />)}
          {done.length > 0 && <h2 className="mt-4 px-1 text-xs uppercase tracking-wide text-muted">Готово</h2>}
          {done.map((t) => <TaskItem key={t.id} task={t} />)}
        </div>
      )}
    </main>
  );
}
