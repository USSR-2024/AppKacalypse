"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useUsers } from "@/lib/hooks";
import type { Priority } from "@/lib/types";

export function TaskComposer({ onClose, defaultProjectId }: { onClose: () => void; defaultProjectId?: string }) {
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          projectId: projectId || null,
          assigneeId: assigneeId || null,
          dueAt: due ? new Date(due).toISOString() : null,
          priority,
          isImportant: important,
        }),
      });
      refreshTasks();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl bg-surface-2 p-5 pb-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          className="w-full bg-transparent text-lg outline-none placeholder:text-muted"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-xl bg-surface px-3 py-2.5 text-text">
            <option value="">Без проекта</option>
            {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="rounded-xl bg-surface px-3 py-2.5 text-text">
            <option value="">Исполнитель</option>
            {users?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded-xl bg-surface px-3 py-2.5 text-text"
          />
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="rounded-xl bg-surface px-3 py-2.5 text-text">
            <option value="low">Низкий</option>
            <option value="normal">Обычный</option>
            <option value="high">Высокий</option>
          </select>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setImportant(!important)}
            className={`rounded-xl px-3 py-2 text-sm ${important ? "bg-warn/20 text-warn" : "bg-surface text-muted"}`}
          >
            ★ Важная
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="rounded-xl bg-accent px-6 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}
