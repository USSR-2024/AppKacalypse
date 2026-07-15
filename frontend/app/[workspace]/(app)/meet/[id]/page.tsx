"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { meetStr } from "@/lib/meetStrings";
import type { Meeting, RecordingStatus } from "@/lib/types";

// Загрузить mp4 записи с авторизацией (эндпоинт отдаёт attachment) → скачать blob.
async function downloadRecording(id: string, filename: string) {
  const token = useAuth.getState().token;
  const ws = window.location.pathname.split("/").filter(Boolean)[0];
  const res = await fetch(`/api/meetings/${id}/recording`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "x-workspace": ws },
  });
  if (!res.ok) throw new Error("download_failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function MeetingCardPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWs();
  const router = useRouter();
  const lang = useAuth((s) => s.me?.lang) === "es" ? "es" : "ru";
  const t = meetStr[lang];
  const dl = lang === "es" ? "es-ES" : "ru-RU";

  const { data: m, mutate } = useSWR<Meeting & { canManage?: boolean }>(`/meetings/${id}`, fetcher, {
    // поллим, пока запись обрабатывается
    refreshInterval: (d) => (d?.recordingStatus === "processing" || d?.recordingStatus === "active" ? 4000 : 0),
  });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!m) {
    return <main className="px-4 pt-12"><p className="animate-pulse text-sm text-muted">{t.loading}</p></main>;
  }

  const rs: RecordingStatus = m.recordingStatus;
  const durationMin = m.endedAt ? Math.max(1, Math.round((+new Date(m.endedAt) - +new Date(m.createdAt)) / 60000)) : null;

  async function saveTitle() {
    const v = title.trim();
    if (!v || v === m!.title) { setEditing(false); return; }
    setBusy("title");
    try {
      await api(`/meetings/${id}`, { method: "PATCH", body: JSON.stringify({ title: v }) });
      await mutate();
      setEditing(false);
    } catch { /* игнор */ }
    finally { setBusy(null); }
  }

  async function transcribe() {
    setBusy("transcribe");
    try {
      await api(`/meetings/${id}/transcribe`, { method: "POST" });
      await mutate();
    } catch { /* игнор */ }
    finally { setBusy(null); }
  }

  async function doDownload() {
    setBusy("download");
    try { await downloadRecording(id, `${m!.title || "meeting"}.mp4`); }
    catch { /* игнор */ }
    finally { setBusy(null); }
  }

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/meet"))} className="mb-4 text-sm text-accent">{t.backToList}</button>

      {/* Заголовок + переименование */}
      <header className="mb-5">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditing(false); }}
              className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-lg font-semibold outline-none ring-1 ring-border focus:ring-accent"
            />
            <button onClick={saveTitle} disabled={busy === "title"} className="rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-40">{t.save}</button>
            <button onClick={() => setEditing(false)} className="rounded-lg px-2 py-2 text-sm text-muted">{t.cancel}</button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-semibold">{m.title}</h1>
            {m.canManage && (
              <button onClick={() => { setTitle(m.title); setEditing(true); }} className="shrink-0 text-sm text-muted hover:text-accent">✏️ {t.rename}</button>
            )}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className={`rounded-full px-2 py-0.5 font-medium ${m.status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-2"}`}>
            {m.status === "active" ? t.statusActive : t.statusEnded}
          </span>
          <span>{t.created}: {new Date(m.createdAt).toLocaleString(dl)}</span>
          {durationMin && <span>· {t.duration}: {durationMin} {lang === "es" ? "min" : "мин"}</span>}
        </div>
      </header>

      {/* Активная встреча → войти в комнату */}
      {m.status === "active" && (
        <button onClick={() => router.push(wsHref(ws, `/meet/${id}/room`))} className="mb-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white">
          📹 {t.joinRoom}
        </button>
      )}

      {/* Запись и расшифровка */}
      <section className="rounded-2xl bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{t.recordingSection}</h2>

        {rs === "none" && <p className="text-sm text-muted">{t.recNone}</p>}
        {rs === "active" && <p className="flex items-center gap-2 text-sm"><span className="animate-pulse text-red-500">●</span> {t.recActive}</p>}
        {rs === "processing" && <p className="flex items-center gap-2 text-sm text-muted"><span className="animate-pulse">⏳</span> {t.recProcessing}</p>}
        {rs === "failed" && <p className="text-sm text-red-500">{t.recFailed}</p>}

        {rs === "ready" && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm"><span className="text-emerald-500">✓</span> {t.recReady}</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={doDownload} disabled={busy === "download"} className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-medium disabled:opacity-40">
                ⬇️ {t.download}
              </button>
              {m.canManage && !m.transcriptionId && (
                <button onClick={transcribe} disabled={busy === "transcribe"} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  📝 {busy === "transcribe" ? t.transcribing : t.transcribe}
                </button>
              )}
            </div>
            {m.transcriptionId && (
              <button onClick={() => router.push(wsHref(ws, "/protocol"))} className="self-start text-sm text-accent">
                📄 {t.openTranscript} →
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
