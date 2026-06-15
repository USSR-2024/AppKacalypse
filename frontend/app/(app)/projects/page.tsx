"use client";
import { useState } from "react";
import Link from "next/link";
import { mutate as globalMutate } from "swr";
import { api } from "@/lib/api";
import { useAllProjects, useProjects } from "@/lib/hooks";
import { ProjectComposer } from "@/components/ProjectComposer";

export default function ProjectsPage() {
  const { data: projects, isLoading, mutate } = useProjects();
  const [composer, setComposer] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const { data: all } = useAllProjects(showArchive);
  const archived = (all ?? []).filter((p) => p.isArchived);

  async function unarchive(pid: string) {
    await api(`/projects/${pid}/archive`, { method: "POST", body: JSON.stringify({ archived: false }) });
    mutate();
    globalMutate("/projects?archived=1");
  }

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

      <div className="mt-8">
        <button onClick={() => setShowArchive((v) => !v)} className="px-1 text-sm text-muted">
          {showArchive ? "▾" : "▸"} Архив
        </button>
        {showArchive && (
          <div className="mt-2 flex flex-col gap-2">
            {archived.length === 0 ? (
              <p className="px-1 text-sm text-muted">Архив пуст.</p>
            ) : (
              archived.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color || "#4f8cff" }} />
                  <span className="flex-1 truncate text-muted">{p.name}</span>
                  <button onClick={() => unarchive(p.id)} className="text-xs text-accent">вернуть</button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
