"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useProjects } from "@/lib/hooks";

export default function ProjectsPage() {
  const { data: projects, isLoading, mutate } = useProjects();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      mutate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 pt-12">
      <header className="mb-6">
        <p className="text-sm text-muted">Направления команды</p>
        <h1 className="text-2xl font-semibold">Проекты</h1>
      </header>

      <div className="mb-5 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Новое направление"
          className="flex-1 rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
        />
        <button onClick={create} disabled={busy || !name.trim()} className="rounded-xl bg-accent px-4 text-white disabled:opacity-40">
          +
        </button>
      </div>

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
