"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useUsers, useTask } from "@/lib/hooks";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import { AssigneePicker, splitAssignees } from "@/components/AssigneePicker";
import { toLocalInput, STATUS_LABELS, PRIORITY_LABELS } from "@/lib/format";
import type { Priority, TaskStatus } from "@/lib/types";

const STATUS_OPTS: Opt[] = (["queued", "in_progress", "done", "cancelled", "archived"] as TaskStatus[]).map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));
const PRIORITY_OPTS: Opt[] = (["low", "normal", "high"] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: task, isLoading } = useTask(id);
  const { data: projects } = useProjects();
  const { data: users } = useUsers();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [externals, setExternals] = useState<string[]>([]);
  const [controllerId, setControllerId] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [status, setStatus] = useState<TaskStatus>("queued");
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setProjectId(task.projectId ?? "");
    const { userIds: uids, externals: exts } = splitAssignees(task.assignees ?? []);
    setUserIds(uids);
    setExternals(exts);
    setControllerId(task.controllerId ?? "");
    setDue(task.dueAt ? toLocalInput(task.dueAt) : "");
    setPriority(task.priority);
    setStatus(task.status);
    setImportant(task.isImportant);
  }, [task]);

  if (isLoading || !task) return <main className="px-4 pt-12 text-muted">Загрузка…</main>;

  const projectOpts: Opt[] = (projects ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color || "#4f8cff" }));
  const userOpts: Opt[] = (users ?? []).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));

  async function save() {
    setBusy(true);
    try {
      if (status !== task!.status) {
        await api(`/tasks/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      }
      await api(`/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          description,
          projectId: projectId || null,
          assigneeIds: userIds,
          externalAssignees: externals,
          controllerId: controllerId || null,
          dueAt: due ? new Date(due).toISOString() : null,
          priority,
          isImportant: important,
        }),
      });
      refreshTasks();
      mutate(`/tasks/${id}`);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Удалить задачу?")) return;
    await api(`/tasks/${id}`, { method: "DELETE" });
    refreshTasks();
    router.back();
  }

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.back()} className="text-sm text-muted">‹ Назад</button>

      <div className="mt-3 flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xl bg-surface px-3 py-3 text-lg font-medium outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание…"
          rows={3}
          className="w-full resize-none rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
        />

        <SheetSelect title="Статус" placeholder="Статус" value={status} onChange={(v) => setStatus(v as TaskStatus)} options={STATUS_OPTS} allowClear={false} />
        <SheetSelect title="Проект" placeholder="Без проекта" value={projectId} onChange={setProjectId} options={projectOpts} />
        <AssigneePicker users={users ?? []} userIds={userIds} externals={externals} onChange={(u, e) => { setUserIds(u); setExternals(e); }} />
        <SheetSelect title="Контролёр" placeholder="Контролёр — создатель" value={controllerId} onChange={setControllerId} options={userOpts} />
        <label className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm">
          <span className="shrink-0 text-muted">Дедлайн</span>
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-right text-text outline-none"
          />
        </label>
        <SheetSelect title="Приоритет" placeholder="Приоритет" value={priority} onChange={(v) => setPriority(v as Priority)} options={PRIORITY_OPTS} allowClear={false} />

        <button
          onClick={() => setImportant(!important)}
          className={`rounded-xl px-3 py-2.5 text-left text-sm ${important ? "bg-warn/20 text-warn" : "bg-surface text-muted"}`}
        >
          ★ {important ? "Важная" : "Отметить важной"}
        </button>
      </div>

      <div className="mt-5 flex gap-2">
        <button onClick={save} disabled={busy || !title.trim()} className="flex-1 rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40">
          {busy ? "…" : "Сохранить"}
        </button>
        <button onClick={remove} className="rounded-xl bg-surface px-4 text-danger">Удалить</button>
      </div>
    </main>
  );
}
