"use client";
import { use } from "react";
import Link from "next/link";
import { useProjects, useTasks } from "@/lib/hooks";
import { TaskItem } from "@/components/TaskItem";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: projects } = useProjects();
  const project = projects?.find((p) => p.id === id);
  const { data, isLoading } = useTasks(`?projectId=${id}`);
  const tasks = data ?? [];

  const active = tasks.filter((t) => t.status === "queued" || t.status === "in_progress");
  const done = tasks.filter((t) => t.status === "done");

  return (
    <main className="px-4 pt-12">
      <Link href="/projects" className="text-sm text-muted">‹ Проекты</Link>
      <header className="mb-6 mt-2">
        <h1 className="text-2xl font-semibold">{project?.name ?? "Проект"}</h1>
        <p className="mt-1 text-sm text-muted">{active.length} активных · {done.length} готово</p>
      </header>

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((t) => <TaskItem key={t.id} task={t} />)}
          {done.length > 0 && <h2 className="mt-4 px-1 text-xs uppercase tracking-wide text-muted">Готово</h2>}
          {done.map((t) => <TaskItem key={t.id} task={t} />)}
          {tasks.length === 0 && <p className="mt-8 text-center text-muted">В проекте пока нет задач</p>}
        </div>
      )}
    </main>
  );
}
