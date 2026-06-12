"use client";
import { format, isPast, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useUsers } from "@/lib/hooks";
import type { Task, TaskStatus } from "@/lib/types";

const STATUS_RING: Record<TaskStatus, string> = {
  queued: "border-muted",
  in_progress: "border-accent",
  done: "border-ok bg-ok",
  cancelled: "border-muted",
  archived: "border-muted",
};

export function TaskItem({ task }: { task: Task }) {
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const project = projects?.find((p) => p.id === task.projectId);
  const assignee = users?.find((u) => u.id === task.assigneeId);
  const done = task.status === "done";

  async function toggle() {
    const next: TaskStatus = done ? "queued" : "done";
    await api(`/tasks/${task.id}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
    refreshTasks();
  }

  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due && !done && isPast(due) && !isToday(due);

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface px-3.5 py-3">
      <button
        onClick={toggle}
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${STATUS_RING[task.status]} transition`}
        aria-label="Готово"
      >
        {done && <span className="block text-center text-[11px] leading-4 text-white">✓</span>}
      </button>

      <div className="min-w-0 flex-1">
        <div className={`text-[15px] leading-tight ${done ? "text-muted line-through" : ""}`}>
          {task.isImportant && <span className="mr-1 text-warn">★</span>}
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {project && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: project.color || "#4f8cff" }} />
              {project.name}
            </span>
          )}
          {assignee && <span>👤 {assignee.displayName}</span>}
          {due && (
            <span className={overdue ? "text-danger" : isToday(due) ? "text-warn" : ""}>
              🕑 {format(due, "d MMM HH:mm", { locale: ru })}
            </span>
          )}
          {task.priority === "high" && <span className="text-danger">!высокий</span>}
        </div>
      </div>
    </div>
  );
}
