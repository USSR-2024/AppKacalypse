"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { meetStr } from "@/lib/meetStrings";
import type { Meeting } from "@/lib/types";

export default function MeetListPage() {
  const ws = useWs();
  const router = useRouter();
  const lang = useAuth((s) => s.me?.lang) === "es" ? "es" : "ru";
  const t = meetStr[lang];
  const [busy, setBusy] = useState(false);
  const { data } = useSWR<Meeting[]>("/meetings", fetcher);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const m = await api<{ id: string }>("/meetings", { method: "POST", body: JSON.stringify({ title: t.meetingTitle }) });
      router.push(wsHref(ws, `/meet/${m.id}/room`));
    } catch {
      setBusy(false);
    }
  }

  const active = data?.filter((m) => m.status === "active") ?? [];
  const ended = data?.filter((m) => m.status === "ended") ?? [];
  const dl = lang === "es" ? "es-ES" : "ru-RU";

  return (
    <main className="px-4 pt-12">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">{t.meetings}</h1>
        <p className="mt-1 text-sm text-muted">{t.meetingsDesc}</p>
      </header>

      <button onClick={create} disabled={busy} className="mb-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">
        {busy ? t.starting : `📹 ${t.start}`}
      </button>

      {active.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t.ongoing}</h2>
          <div className="flex flex-col gap-2">
            {active.map((m) => (
              <button key={m.id} onClick={() => router.push(wsHref(ws, `/meet/${m.id}/room`))} className="flex items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t.startedAt} {new Date(m.createdAt).toLocaleString(dl)}
                    {m.recordingStatus === "active" ? " · 🔴" : ""}
                  </div>
                </div>
                <span className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">{t.enter} →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {ended.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t.past}</h2>
          <div className="flex flex-col gap-2">
            {ended.map((m) => (
              <button key={m.id} onClick={() => router.push(wsHref(ws, `/meet/${m.id}`))} className="rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2">
                <div className="truncate font-medium">{m.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {new Date(m.createdAt).toLocaleDateString(dl)}
                  {m.recordingStatus === "ready" || m.transcriptionId ? ` · 🎬 ${t.hasRecording}` : ""}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {data && data.length === 0 && <p className="text-sm text-muted">{t.empty}</p>}
    </main>
  );
}
