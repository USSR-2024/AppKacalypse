"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useProjects, useTasks, useUsers } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import { STATUS_LABELS } from "@/lib/format";
import type { Task, TaskStatus } from "@/lib/types";

const BOARD_COLS: TaskStatus[] = ["queued", "in_progress", "done"];

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
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === id);
  const { data, isLoading } = useTasks(`?projectId=${id}`);
  const tasks = data ?? [];
  const [board, setBoard] = useState(false);

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
          <button onClick={() => setBoard(false)} className={`rounded-lg px-3 py-1.5 ${!board ? "bg-surface-2" : "text-muted"}`}>Список</button>
          <button onClick={() => setBoard(true)} className={`rounded-lg px-3 py-1.5 ${board ? "bg-surface-2" : "text-muted"}`}>Доска</button>
        </div>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-8 text-center text-muted">В проекте пока нет задач</p>
      ) : board ? (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {BOARD_COLS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col);
            return (
              <div key={col} className="flex w-64 shrink-0 flex-col gap-2">
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {STATUS_LABELS[col]} · {colTasks.length}
                </div>
                {colTasks.map((t) => <MiniCard key={t.id} task={t} />)}
                {colTasks.length === 0 && <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted">пусто</div>}
              </div>
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
