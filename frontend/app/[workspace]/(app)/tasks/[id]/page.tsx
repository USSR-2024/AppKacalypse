"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useProjectDetail, useUsers, useTask } from "@/lib/hooks";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import { AssigneePicker, splitAssignees } from "@/components/AssigneePicker";
import { KindToggle } from "@/components/KindToggle";
import { TaskComments } from "@/components/TaskComments";
import { toLocalInput, STATUS_LABELS, PRIORITY_LABELS } from "@/lib/format";
import type { Priority, Task, TaskStatus } from "@/lib/types";

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

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"personal" | "work">("personal");
  const [projectId, setProjectId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [externals, setExternals] = useState<string[]>([]);
  const [controllerId, setControllerId] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [status, setStatus] = useState<TaskStatus>("queued");
  const [important, setImportant] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: projDetail } = useProjectDetail(projectId);

  function resetFields(t: Task) {
    setTitle(t.title);
    setDescription(t.description);
    setProjectId(t.projectId ?? "");
    setSectionId(t.sectionId ?? "");
    setKind(t.projectId ? "work" : "personal");
    const { userIds: uids, externals: exts } = splitAssignees(t.assignees ?? []);
    setUserIds(uids);
    setExternals(exts);
    setControllerId(t.controllerId ?? "");
    setDue(t.dueAt ? toLocalInput(t.dueAt) : "");
    setPriority(t.priority);
    setStatus(t.status);
    setImportant(t.isImportant);
  }

  useEffect(() => {
    if (task) resetFields(task);
  }, [task]);

  if (isLoading || !task) return <main className="px-4 pt-12 text-muted">Загрузка…</main>;

  const projectOpts: Opt[] = (projects ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color || "#4f8cff" }));
  const userOpts: Opt[] = (users ?? []).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));
  const sectionOpts: Opt[] = (projDetail?.sections ?? []).map((s) => ({ value: s.id, label: s.name }));

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
          sectionId: sectionId || null,
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
      setEditing(false);
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

  // ── Просмотр (read-only) ──────────────────────────────────────────────────
  const project = projects?.find((p) => p.id === task.projectId);
  const assigneeNames = (task.assignees ?? []).map((a) => a.displayName).join(", ");
  const controllerName = users?.find((u) => u.id === task.controllerId)?.displayName;
  const dueLabel = task.dueAt
    ? new Date(task.dueAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <main className="px-4 pt-12">
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-muted">‹ Назад</button>
        {!editing && (
          <button onClick={() => setEditing(true)} className="rounded-xl bg-surface px-3 py-1.5 text-sm text-accent">
            ✎ Редактировать
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-3">
          <h1 className="text-xl font-semibold leading-tight">
            {task.isImportant && <span className="mr-1 text-warn">★</span>}
            {task.title}
          </h1>
          {task.description && <p className="mt-2 whitespace-pre-line text-sm text-text/80">{task.description}</p>}

          <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-2xl bg-surface">
            <ViewRow label="Статус" value={STATUS_LABELS[task.status]} />
            <ViewRow label="Тип" value={project ? `👥 ${project.name}` : "🔒 Личная"} />
            <ViewRow label="Исполнители" value={assigneeNames || "—"} />
            <ViewRow label="Контролёр" value={controllerName ?? "—"} />
            <ViewRow label="Срок" value={dueLabel} />
            <ViewRow label="Приоритет" value={PRIORITY_LABELS[task.priority]} />
          </div>
        </div>
      ) : (
        <>
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
            <KindToggle kind={kind} onChange={(k) => { setKind(k); if (k === "personal") { setProjectId(""); setSectionId(""); } }} />
            {kind === "work" && (
              <SheetSelect title="Проект" placeholder="Выберите проект" value={projectId} onChange={(v) => { setProjectId(v); setSectionId(""); }} options={projectOpts} />
            )}
            {kind === "work" && projectId && sectionOpts.length > 0 && (
              <SheetSelect title="Раздел" placeholder="Без раздела" value={sectionId} onChange={setSectionId} options={sectionOpts} />
            )}
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
            <button onClick={save} disabled={busy || !title.trim() || (kind === "work" && !projectId)} className="flex-1 rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40">
              {busy ? "…" : "Сохранить"}
            </button>
            <button onClick={() => { resetFields(task); setEditing(false); }} className="rounded-xl bg-surface px-4 text-muted">Отмена</button>
            <button onClick={remove} className="rounded-xl bg-surface px-4 text-danger">Удалить</button>
          </div>
        </>
      )}

      <TaskComments taskId={id} users={users ?? []} />
    </main>
  );
}

function ViewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}
