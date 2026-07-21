"use client";
import { useState } from "react";
import { WsLink } from "@/components/WsLink";
import { format, isPast, isToday } from "date-fns";
import { ru } from "date-fns/locale";
import { api } from "@/lib/api";
import { refreshTasks, useProjects } from "@/lib/hooks";
import { ConfirmSheet } from "@/components/ConfirmSheet";
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
  const project = projects?.find((p) => p.id === task.projectId);
  const assignees = task.assignees ?? [];
  const assigneeLabel =
    assignees.length === 0
      ? null
      : assignees.length <= 2
        ? assignees.map((a) => a.displayName).join(", ")
        : `${assignees[0].displayName} +${assignees.length - 1}`;
  const done = task.status === "done";
  // Задача-мост из «Документов» — системная: статусом управляет движок согласования,
  // руками не закрыть (бэк вернёт 409). Показываем замок, а не кликабельный кружок.
  const managed = !!task.documentId;
  const [confirming, setConfirming] = useState(false);

  async function setStatus(next: TaskStatus) {
    await api(`/tasks/${task.id}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
    refreshTasks();
  }

  function onToggle() {
    // Завершение подтверждаем (легко промахнуться), снятие — сразу.
    if (done) setStatus("queued");
    else setConfirming(true);
  }

  const due = task.dueAt ? new Date(task.dueAt) : null;
  const overdue = due && !done && isPast(due) && !isToday(due);

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface px-3.5 py-3">
      {managed ? (
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${done ? "border-ok bg-ok text-white" : "border-muted text-muted"}`}
          title="Закроется автоматически, когда согласование/подписание завершится"
        >
          {done ? "✓" : "🔒"}
        </span>
      ) : (
        <button
          onClick={onToggle}
          className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${STATUS_RING[task.status]} transition`}
          aria-label="Готово"
        >
          {done && <span className="block text-center text-[11px] leading-4 text-white">✓</span>}
        </button>
      )}

      {confirming && (
        <ConfirmSheet
          title="Завершить задачу?"
          message={task.title}
          confirmLabel="Завершить"
          onConfirm={() => {
            setConfirming(false);
            setStatus("done");
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      <WsLink href={`/tasks/${task.id}`} className="min-w-0 flex-1">
        <div className={`text-[15px] leading-tight ${done ? "text-muted line-through" : ""}`}>
          {task.isImportant && <span className="mr-1 text-warn">★</span>}
          {task.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {managed && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">📄 Согласование</span>}
          {project && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: project.color || "#4f8cff" }} />
              {project.name}
            </span>
          )}
          {assigneeLabel && <span>👤 {assigneeLabel}</span>}
          {due && (
            <span className={overdue ? "text-danger" : isToday(due) ? "text-warn" : ""}>
              🕑 {format(due, "d MMM HH:mm", { locale: ru })}
            </span>
          )}
          {task.priority === "high" && <span className="text-danger">!высокий</span>}
        </div>
      </WsLink>
    </div>
  );
}
