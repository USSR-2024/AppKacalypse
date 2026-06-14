"use client";
import { useState } from "react";
import Link from "next/link";
import { useProjects } from "@/lib/hooks";
import { ProjectComposer } from "@/components/ProjectComposer";

export default function ProjectsPage() {
  const { data: projects, isLoading, mutate } = useProjects();
  const [composer, setComposer] = useState(false);

  return (
    <main className="px-4 pt-12">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-sm text-muted">Направления команды</p>
          <h1 className="text-2xl font-semibold">Проекты</h1>
        </div>
        <button
          onClick={() => setComposer(true)}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          + Проект
        </button>
      </header>

      {composer && <ProjectComposer onClose={() => setComposer(false)} onCreated={mutate} />}

      {isLoading ? (
        <p className="text-muted">Загрузка…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {projects?.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5"
            >
              <span className="h-3 w-3 rounded-full" style={{ background: p.color || "#4f8cff" }} />
              <span className="flex-1">{p.name}</span>
              <span className="text-muted">›</span>
            </Link>
          ))}
          {projects?.length === 0 && <p className="mt-8 text-center text-muted">Пока нет проектов</p>}
        </div>
      )}
    </main>
  );
}
