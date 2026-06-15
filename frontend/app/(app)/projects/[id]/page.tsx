"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/store";
import { useProjects, useProjectDetail, useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";
import { STATUS_LABELS } from "@/lib/format";
import type { ProjectView, Task, TaskStatus } from "@/lib/types";

const BOARD_COLS: TaskStatus[] = ["queued", "in_progress", "done"];

const VIEWS: [ProjectView, string][] = [
  ["list", "Список"],
  ["board", "Доска"],
  ["table", "Таблица"],
];

function fmtDue(due: string | null): string {
  if (!due) return "—";
  return new Date(due).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function assigneeText(task: Task): string | null {
  const a = task.assignees ?? [];
  if (!a.length) return null;
  return a.length <= 2 ? a.map((x) => x.displayName).join(", ") : `${a[0].displayName} +${a.length - 1}`;
}

// ── рендер задач раздела по выбранному виду (горизонтальный жест занят разделами,
//    поэтому «Доска» здесь — вертикальные группы по статусам) ──────────────────────
function SectionContent({ tasks, view }: { tasks: Task[]; view: ProjectView }) {
  if (tasks.length === 0) {
    return <p className="mt-6 text-center text-sm text-muted">В разделе пока нет задач</p>;
  }

  if (view === "table") {
    return (
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
    );
  }

  if (view === "board") {
    return (
      <div className="flex flex-col gap-4">
        {BOARD_COLS.map((col) => {
          const ts = tasks.filter((t) => t.status === col);
          return (
            <div key={col} className="flex flex-col gap-2">
              <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted">{STATUS_LABELS[col]} · {ts.length}</h3>
              {ts.map((t) => <TaskItem key={t.id} task={t} />)}
              {ts.length === 0 && <p className="px-1 text-xs text-muted">пусто</p>}
            </div>
          );
        })}
      </div>
    );
  }

  // list: активные сверху, готовые снизу
  const active = tasks.filter((t) => t.status === "queued" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");
  return (
    <div className="flex flex-col gap-2">
      {active.map((t) => <TaskItem key={t.id} task={t} />)}
      {done.length > 0 && <h3 className="mt-3 px-1 text-xs uppercase tracking-wide text-muted">Готово</h3>}
      {done.map((t) => <TaskItem key={t.id} task={t} />)}
    </div>
  );
}

// ── горизонтальный пейджер по разделам (подпапкам): вкладки + свайп ────────────────
function SectionPager({ pages, view }: { pages: { key: string; label: string; tasks: Task[] }[]; view: ProjectView }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const step = () => ref.current?.clientWidth ?? 0;
  const onScroll = () => { if (ref.current) setActive(Math.round(ref.current.scrollLeft / Math.max(1, step()))); };
  const go = (i: number) => ref.current?.scrollTo({ left: i * step(), behavior: "smooth" });

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-surface p-0.5 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pages.map((pg, i) => (
          <button
            key={pg.key}
            onClick={() => go(i)}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 ${active === i ? "bg-surface-2 font-medium" : "text-muted"}`}
          >
            {pg.label} · {pg.tasks.length}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory items-start overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((pg) => (
          <div key={pg.key} className="w-full shrink-0 snap-start pr-px">
            <SectionContent tasks={pg.tasks} view={view} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useAuth((s) => s.me);
  const { data: projects } = useProjects();
  const { data: detail } = useProjectDetail(id);
  const project = projects?.find((p) => p.id === id);
  const { data, isLoading } = useTasks(`?projectId=${id}`);
  const tasks = data ?? [];

  // Вид внутри раздела — из профиля, на экране переключается (сессия).
  const [view, setView] = useState<ProjectView | null>(null);
  useEffect(() => { if (view === null && me) setView(me.projectView); }, [me, view]);
  const v: ProjectView = view ?? me?.projectView ?? "list";

  const active = tasks.filter((t) => t.status === "queued" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");
  const sections = detail?.sections ?? [];

  // Страницы пейджера: «Без раздела» (если такие задачи есть) + по разделу.
  const noSection = tasks.filter((t) => !t.sectionId);
  const pages = [
    ...(noSection.length > 0 || sections.length === 0 ? [{ key: "__none", label: "Без раздела", tasks: noSection }] : []),
    ...sections.map((s) => ({ key: s.id, label: s.name, tasks: tasks.filter((t) => t.sectionId === s.id) })),
  ];

  return (
    <main className="px-4 pt-12">
      <Link href="/projects" className="text-sm text-muted">‹ Проекты</Link>
      <header className="mb-4 mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{project?.name ?? "Проект"}</h1>
          <p className="mt-1 text-sm text-muted">{active.length} активных · {done.length} готово</p>
        </div>
        <Link
          href={`/projects/${id}/settings`}
          aria-label="Настройки проекта"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-lg"
        >
          ⚙
        </Link>
      </header>

      <div className="mb-4 flex rounded-xl bg-surface p-0.5 text-sm">
        {VIEWS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 rounded-lg px-3 py-1.5 ${v === key ? "bg-surface-2 font-medium" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="mt-8 text-center text-muted">В проекте пока нет задач</p>
      ) : sections.length > 0 ? (
        <SectionPager pages={pages} view={v} />
      ) : (
        <SectionContent tasks={tasks} view={v} />
      )}
    </main>
  );
}
