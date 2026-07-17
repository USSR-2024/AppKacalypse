"use client";
import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DOC_PRIORITY, StatusChip, fileSize } from "@/lib/docStrings";
import type { DocCard, DocActivity } from "@/lib/types";

// Человеческие подписи событий журнала: в БД лежат коды (created, version_saved…).
const ACTION_LABEL: Record<string, string> = {
  created: "Карточка создана",
  edited: "Карточка изменена",
  version_saved: "Загружена версия",
  status_changed: "Статус изменён",
};

export default function DocCardPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWs();
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const { data: d, mutate } = useSWR<DocCard>(`/documents/${id}`, fetcher);
  const { data: log } = useSWR<DocActivity[]>(`/documents/${id}/activity`, fetcher);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  if (!d) return <main className="px-4 pt-12"><p className="text-sm text-muted">Загрузка…</p></main>;

  // Версию кладут в черновик или в карточку, вернувшуюся на корректировку.
  const canUpload = d.canEdit || d.status === "rework";

  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/documents/${id}/versions?filename=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: {
          "content-type": file.type || "application/octet-stream",
          authorization: `Bearer ${token}`,
          "x-workspace": ws,
        },
        body: file,   // сырое тело, не multipart: большой файл не должен лечь в память бэка целиком
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "upload_failed");
      mutate();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(code === "too_large" ? "Файл больше 100 МБ" : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(versionId: string, fileName: string) {
    // Файл отдаёт бэкенд с проверкой прав → нужен заголовок авторизации, простой ссылкой не взять.
    const r = await fetch(`/api/documents/${id}/versions/${versionId}/file`, {
      headers: { authorization: `Bearer ${token}`, "x-workspace": ws },
    });
    if (!r.ok) return setErr("Не удалось скачать файл");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    setConfirmSubmit(false);
    setErr(null);
    setBusy(true);
    try {
      await api(`/documents/${id}/submit`, { method: "POST" });
      mutate();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "no_version" ? "Сначала загрузите файл документа" :
        code === "note_required" ? "Для этого типа нужна пояснительная записка" :
        "Не удалось отправить на согласование",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/docs"))} className="mb-3 text-sm text-accent">
        ← К списку
      </button>

      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {d.registryNumber && <div className="font-mono text-xs text-muted">{d.registryNumber}</div>}
            <h1 className="text-xl font-semibold">{d.title}</h1>
          </div>
          <StatusChip status={d.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {d.typeName && <span>{d.typeName}</span>}
          {d.counterpartyName && <span>· {d.counterpartyName}</span>}
          <span>· {DOC_PRIORITY[d.priority]}</span>
          {d.ownerName && <span>· ответственный: {d.ownerName}</span>}
        </div>
        {d.priorityReason && <p className="mt-2 text-xs text-muted">Обоснование: {d.priorityReason}</p>}
        {d.description && <p className="mt-3 whitespace-pre-wrap text-sm">{d.description}</p>}
      </header>

      {err && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Версии</h2>
          {canUpload && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-lg bg-surface px-3 py-1.5 text-xs text-muted transition hover:text-text disabled:opacity-40"
              >
                {busy ? "Загрузка…" : "↑ Загрузить версию"}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </>
          )}
        </div>

        {d.versions.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
            Файла ещё нет. Загрузите версию — без неё документ не уйдёт на согласование.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {d.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
                      v{v.versionNo}
                    </span>
                    <span className="truncate text-sm">{v.fileName}</span>
                    {v.id === d.currentVersionId && <span className="shrink-0 text-xs text-accent">текущая</span>}
                    {v.isSignedOriginal && <span className="shrink-0 text-xs text-emerald-500">оригинал</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fileSize(v.fileSize)} · {v.authorName} · {new Date(v.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
                <button
                  onClick={() => download(v.id, v.fileName)}
                  className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-xs transition hover:text-accent"
                >
                  ↓ Скачать
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {d.status === "draft" && d.canEdit && (
        <button
          onClick={() => setConfirmSubmit(true)}
          disabled={busy || d.versions.length === 0}
          className="mb-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40 lg:w-auto lg:px-6"
        >
          Отправить на согласование
        </button>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">История</h2>
        <div className="flex flex-col gap-1.5">
          {log?.map((a) => (
            <div key={a.id} className="flex gap-2 text-xs">
              <span className="shrink-0 text-muted">{new Date(a.at).toLocaleString("ru-RU")}</span>
              <span>{ACTION_LABEL[a.action] ?? a.action}</span>
              {a.actorName && <span className="text-muted">— {a.actorName}</span>}
            </div>
          ))}
        </div>
      </section>

      {confirmSubmit && (
        <ConfirmSheet
          title="Отправить на согласование?"
          message="Карточка получит реестровый номер, и править её будет уже нельзя — только загрузить новую версию."
          confirmLabel="Отправить"
          onConfirm={submit}
          onCancel={() => setConfirmSubmit(false)}
        />
      )}
    </main>
  );
}
