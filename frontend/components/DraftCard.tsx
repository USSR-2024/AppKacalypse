"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { refreshTasks, useProjects, useUsers } from "@/lib/hooks";
import { SheetSelect, type Opt } from "./SheetSelect";
import { AssigneePicker } from "./AssigneePicker";
import type { Priority } from "@/lib/types";

export interface Draft {
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  dueText: string | null;
  priority: Priority;
  needsConfirmation: boolean;
}

const PRIORITY_OPTS: Opt[] = [
  { value: "low", label: "Низкий приоритет" },
  { value: "normal", label: "Обычный приоритет" },
  { value: "high", label: "Высокий приоритет" },
];

function toLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DraftCard({ draft }: { draft: Draft }) {
  const { data: projects } = useProjects();
  const { data: users } = useUsers();
  const [title, setTitle] = useState(draft.title);
  const [projectId, setProjectId] = useState(draft.projectId ?? "");
  // Распознанный исполнитель: из команды → userIds; имя не из команды → внешний.
  const [userIds, setUserIds] = useState<string[]>(draft.assigneeId ? [draft.assigneeId] : []);
  const [externals, setExternals] = useState<string[]>(!draft.assigneeId && draft.assigneeName ? [draft.assigneeName] : []);
  const [due, setDue] = useState(draft.dueAt ? toLocal(draft.dueAt) : "");
  const [priority, setPriority] = useState<Priority>(draft.priority);
  const [important, setImportant] = useState(false);
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);

  const projectOpts: Opt[] = (projects ?? []).map((p) => ({ value: p.id, label: p.name, color: p.color || "#4f8cff" }));

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          projectId: projectId || null,
          assigneeIds: userIds,
          externalAssignees: externals,
          dueAt: due ? new Date(due).toISOString() : null,
          priority,
          isImportant: important,
          source: "ai",
          isTriaged: true,
        }),
      });
      refreshTasks();
      setCreated(true);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mt-2 rounded-2xl border border-ok/40 bg-ok/10 px-3.5 py-3 text-sm text-ok">
        ✓ Создана: {title}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-transparent text-[15px] font-medium outline-none"
      />
      <SheetSelect title="Проект" placeholder="Без проекта" value={projectId} onChange={setProjectId} options={projectOpts} />
      <AssigneePicker users={users ?? []} userIds={userIds} externals={externals} onChange={(u, e) => { setUserIds(u); setExternals(e); }} />
      <label className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-sm">
        <span className="shrink-0 text-muted">Дедлайн{draft.dueText ? ` (${draft.dueText})` : ""}</span>
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-right text-text outline-none"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <SheetSelect title="Приоритет" placeholder="Приоритет" value={priority} onChange={(v) => setPriority(v as Priority)} options={PRIORITY_OPTS} allowClear={false} />
      </div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setImportant(!important)}
          className={`rounded-xl px-3 py-2 text-sm ${important ? "bg-warn/20 text-warn" : "bg-surface text-muted"}`}
        >
          ★ Важная
        </button>
        <button onClick={create} disabled={busy || !title.trim()} className="rounded-xl bg-accent px-5 py-2 font-medium text-white disabled:opacity-40">
          {busy ? "…" : "Создать"}
        </button>
      </div>
    </div>
  );
}
