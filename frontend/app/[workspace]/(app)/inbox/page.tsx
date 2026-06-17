"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useTasks, useUsers } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import type { Task } from "@/lib/types";

function TriageRow({ task }: { task: Task }) {
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const [assignee, setAssignee] = useState(task.assignees?.[0]?.userId ?? "");
  const [busy, setBusy] = useState(false);

  const projectOpts: Opt[] = (projects ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color || "#4f8cff" }));
  const userOpts: Opt[] = (users ?? []).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));

  // Разобрать: задать проект (или личная) + исполнителя → ушла из «Входящих».
  async function triage(projectId: string | null) {
    setBusy(true);
    try {
      await api(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ projectId, assigneeIds: assignee ? [assignee] : [], isTriaged: true }),
      });
      refreshTasks();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${busy ? "opacity-50" : ""}`}>
      <TaskItem task={task} />
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2/50 p-2">
        <SheetSelect title="Исполнитель" placeholder="Исполнитель (необязательно)" value={assignee} onChange={setAssignee} options={userOpts} />
        <div className="flex gap-2">
          <div className="flex-1">
            <SheetSelect title="В проект" placeholder="📁 В проект…" value="" onChange={(v) => v && triage(v)} options={projectOpts} allowClear={false} />
          </div>
          <button onClick={() => triage(null)} disabled={busy} className="rounded-xl bg-surface px-4 text-sm text-muted disabled:opacity-40">
            🔒 Личная
          </button>
        </div>
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
