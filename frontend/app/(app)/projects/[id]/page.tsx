"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mutate } from "swr";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { refreshTasks, useProjects, useProjectDetail, useTasks, useTeams, useUsers } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import { Avatar } from "@/components/Avatar";
import { SheetSelect, type Opt } from "@/components/SheetSelect";
import { STATUS_LABELS } from "@/lib/format";
import type { ProjectDetail, ProjectView, Section, Task, TaskStatus } from "@/lib/types";

const BOARD_COLS: TaskStatus[] = ["queued", "in_progress", "done"];

function fmtDue(due: string | null): string {
  if (!due) return "—";
  return new Date(due).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function assigneeText(task: Task): string | null {
  const a = task.assignees ?? [];
  if (!a.length) return null;
  return a.length <= 2 ? a.map((x) => x.displayName).join(", ") : `${a[0].displayName} +${a.length - 1}`;
}

function MiniCard({ task }: { task: Task }) {
  const label = assigneeText(task);
  return (
    <Link href={`/tasks/${task.id}`} className="block rounded-xl bg-surface px-3 py-2.5">
      <div className="text-sm leading-tight">
        {task.isImportant && <span className="mr-1 text-warn">★</span>}
        {task.title}
      </div>
      {label && <div className="mt-1 text-xs text-muted">👤 {label}</div>}
    </Link>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useAuth((s) => s.me);
  const { data: projects } = useProjects();
  const { data: detail } = useProjectDetail(id);
  const project = projects?.find((p) => p.id === id);
  const canManage = !!me && !!detail && (detail.ownerId === me.id || me.role === "admin" || me.role === "owner");
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
            const label = assigneeText(t);
            return (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="grid grid-cols-[1fr_3.5rem_5rem] items-center gap-2 border-b border-border/40 px-3 py-3 text-sm last:border-0 active:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.isImportant && <span className="mr-1 text-warn">★</span>}{t.title}</span>
                  {label && <span className="block truncate text-xs text-muted">👤 {label}</span>}
                </span>
                <span className="text-xs text-muted">{fmtDue(t.dueAt)}</span>
                <span className="text-xs text-muted">{STATUS_LABELS[t.status]}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <SectionedTasks tasks={active} sections={detail?.sections ?? []} projectId={id} canManage={canManage} />
          {done.length > 0 && <h2 className="mt-4 px-1 text-xs uppercase tracking-wide text-muted">Готово</h2>}
          {done.map((t) => <TaskItem key={t.id} task={t} />)}
        </div>
      )}

      {detail && <ProjectTeam projectId={id} detail={detail} canManage={canManage} />}
    </main>
  );
}

function SectionedTasks({ tasks, sections, projectId, canManage }: { tasks: Task[]; sections: Section[]; projectId: string; canManage: boolean }) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const noSection = tasks.filter((t) => !t.sectionId);
  const inSection = (sid: string) => tasks.filter((t) => t.sectionId === sid);

  async function addSection() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/sections`, { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
      mutate(`/projects/${projectId}`);
    } finally {
      setBusy(false);
    }
  }
  async function delSection(sid: string) {
    if (!confirm("Удалить раздел? Задачи останутся, но выйдут из раздела.")) return;
    await api(`/projects/${projectId}/sections/${sid}`, { method: "DELETE" });
    mutate(`/projects/${projectId}`);
    refreshTasks();
  }

  return (
    <div className="flex flex-col gap-4">
      {noSection.length > 0 && (
        <div className="flex flex-col gap-2">
          {noSection.map((t) => <TaskItem key={t.id} task={t} />)}
        </div>
      )}
      {sections.map((s) => (
        <div key={s.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted">{s.name} · {inSection(s.id).length}</h3>
            {canManage && <button onClick={() => delSection(s.id)} className="text-xs text-muted">✕</button>}
          </div>
          {inSection(s.id).map((t) => <TaskItem key={t.id} task={t} />)}
          {inSection(s.id).length === 0 && <p className="px-1 text-xs text-muted">пусто</p>}
        </div>
      ))}
      {canManage && (
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSection()}
            placeholder="+ Раздел"
            className="flex-1 rounded-xl bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          {newName.trim() && <button onClick={addSection} disabled={busy} className="rounded-xl bg-accent px-4 text-sm text-white disabled:opacity-40">Добавить</button>}
        </div>
      )}
    </div>
  );
}

function ProjectTeam({ projectId, detail, canManage }: { projectId: string; detail: ProjectDetail; canManage: boolean }) {
  const { data: users } = useUsers();
  const { data: teams } = useTeams();
  const [addUser, setAddUser] = useState("");
  const [addTeam, setAddTeam] = useState("");

  const memberIds = new Set(detail.members.map((m) => m.userId));
  const userOpts: Opt[] = (users ?? []).filter((u) => !memberIds.has(u.id)).map((u) => ({ value: u.id, label: u.displayName, avatar: u.avatarUrl }));
  const teamOpts: Opt[] = (teams ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.members.length})` }));

  async function addMember(userId: string) {
    if (!userId) return;
    await api(`/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ userId }) });
    setAddUser("");
    mutate(`/projects/${projectId}`);
  }
  async function addTeamMembers(teamId: string) {
    if (!teamId) return;
    await api(`/projects/${projectId}/team`, { method: "POST", body: JSON.stringify({ teamId }) });
    setAddTeam("");
    mutate(`/projects/${projectId}`);
  }
  async function removeMember(userId: string) {
    await api(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
    mutate(`/projects/${projectId}`);
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-wide text-muted">Команда проекта · {detail.members.length}</h2>
      <div className="flex flex-col gap-2">
        {detail.members.map((m) => (
          <div key={m.userId} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2.5">
            <Avatar src={m.avatarUrl} name={m.displayName} className="h-8 w-8 bg-surface-2 text-sm" />
            <span className="flex-1 truncate text-sm">{m.displayName}</span>
            {m.role === "lead" && <span className="text-xs text-muted">лид</span>}
            {canManage && m.role !== "lead" && (
              <button onClick={() => removeMember(m.userId)} className="text-xs text-danger">убрать</button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="mt-2 flex flex-col gap-2">
          {userOpts.length > 0 && (
            <SheetSelect title="Добавить участника" placeholder="+ Участник" value={addUser} onChange={addMember} options={userOpts} allowClear={false} />
          )}
          {teamOpts.length > 0 && (
            <SheetSelect title="Добавить команду" placeholder="+ Команда целиком" value={addTeam} onChange={addTeamMembers} options={teamOpts} allowClear={false} />
          )}
        </div>
      )}
    </section>
  );
}
