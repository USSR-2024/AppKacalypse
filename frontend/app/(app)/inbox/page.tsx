"use client";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import type { Task } from "@/lib/types";

function TriageRow({ task }: { task: Task }) {
  const { data: projects } = useProjects();

  async function toProject(projectId: string) {
    await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ projectId, isTriaged: true }) });
    refreshTasks();
  }
  async function asPersonal() {
    await api(`/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ isTriaged: true }) });
    refreshTasks();
  }

  return (
    <div className="flex flex-col gap-2">
      <TaskItem task={task} />
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
        <span className="text-xs text-muted">Куда:</span>
        <select
          defaultValue=""
          onChange={(e) => e.target.value && toProject(e.target.value)}
          className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-text"
        >
          <option value="" disabled>В проект…</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={asPersonal} className="rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted">
          Личная
        </button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { data, isLoading } = useTasks("?inbox=1");
  const tasks = data ?? [];

  return (
    <main className="px-4 pt-12">
      <header className="mb-6">
        <p className="text-sm text-muted">Разбери и распредели</p>
        <h1 className="text-2xl font-semibold">Входящие</h1>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-10 text-center text-muted">Входящие пусты ✨</p>
      ) : (
        <div className="flex flex-col gap-4">
          {tasks.map((t) => <TriageRow key={t.id} task={t} />)}
        </div>
      )}
    </main>
  );
}
