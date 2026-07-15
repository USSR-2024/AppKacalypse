"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs } from "@/lib/ws";
import type { Transcription } from "@/lib/types";

const LANGS = [
  { value: "auto", label: "Авто" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
] as const;

// Идёт ли по расшифровке фоновая работа (для поллинга статусов).
const isBusy = (t: Transcription) =>
  t.status === "queued" || t.status === "transcribing" ||
  t.protocolStatus === "queued" || t.protocolStatus === "running";

export default function ProtocolPage() {
  const ws = useWs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [lang, setLang] = useState<string>("auto");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);   // 0..1, только пока идёт отправка
  const [err, setErr] = useState<string | null>(null);

  const { data, mutate } = useSWR<Transcription[]>("/transcriptions", fetcher, {
    refreshInterval: (rows) => (rows?.some(isBusy) ? 4000 : 0),
  });

  // Отправляем файл сырым телом PUT. XHR, а не fetch — только он даёт события
  // прогресса, а встреча на пару гигабайт заливается не одну минуту.
  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || uploading) return;
    setErr(null);
    setUploading(true);
    setProgress(0);
    try {
      await new Promise<void>((resolve, reject) => {
        const qs = new URLSearchParams({ filename: file.name, lang });
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/transcriptions?${qs}`);
        xhr.setRequestHeader("authorization", `Bearer ${useAuth.getState().token}`);
        xhr.setRequestHeader("x-workspace", ws);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total); };
        xhr.onload = () => {
          if (xhr.status === 201) return resolve();
          let msg = "ошибка загрузки";
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
          reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error("связь оборвалась — попробуйте ещё раз"));
        xhr.onabort = () => reject(new Error("загрузка отменена"));
        xhr.send(file);
      });
      if (fileRef.current) fileRef.current.value = "";
      mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ошибка загрузки");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <main className="px-4 pt-12">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Расшифровки встреч</h1>
        <p className="mt-1 text-sm text-muted">
          Загрузите аудио или видео встречи (Zoom .m4a, .mp4, .mov, .mkv и др.) — получите транскрипт с разделением по спикерам и, по желанию, протокол. Из видео звук извлекается автоматически. Всё считается локально на GPU-сервере.
        </p>
      </header>

      {/* Загрузка */}
      <section className="mb-6 rounded-2xl bg-surface p-4">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.mp4,.mov,.mkv,.webm"
          className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-surface-2 file:px-4 file:py-2 file:text-sm file:text-text"
        />
        <div className="mt-3 flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none"
          >
            {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button
            onClick={upload}
            disabled={uploading}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {uploading ? `Загрузка… ${Math.round(progress * 100)}%` : "Загрузить и расшифровать"}
          </button>
        </div>
        {uploading && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      </section>

      {/* Список */}
      <section className="flex flex-col gap-2">
        {data?.map((t) => <Row key={t.id} t={t} ws={ws} onChange={mutate} />)}
        {data && data.length === 0 && (
          <p className="text-sm text-muted">Пока ничего не загружено.</p>
        )}
      </section>
    </main>
  );
}

function Row({ t, ws, onChange }: { t: Transcription; ws: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function download(path: string, name: string) {
    const res = await fetch("/api" + path, {
      headers: { authorization: `Bearer ${useAuth.getState().token}`, "x-workspace": ws },
    });
    if (!res.ok) { alert("Файл ещё не готов. Если протокол делали раньше — нажмите «пересоставить»."); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  async function makeProtocol() {
    setBusy(true);
    try { await api(`/transcriptions/${t.id}/protocol`, { method: "POST" }); onChange(); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Удалить «${t.filename}»?`)) return;
    await api(`/transcriptions/${t.id}`, { method: "DELETE" });
    onChange();
  }

  const base = t.filename.replace(/\.[^.]+$/, "") || "meeting";

  return (
    <div className="rounded-2xl bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{t.filename}</div>
          <div className="mt-0.5 text-xs text-muted">{new Date(t.createdAt).toLocaleString("ru-RU")}</div>
        </div>
        <button onClick={remove} className="shrink-0 text-xs text-danger">Удалить</button>
      </div>

      {/* Статус транскрипта */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {t.status === "queued" && <Badge>⏳ В очереди</Badge>}
        {t.status === "transcribing" && <Badge spin>🎧 Расшифровка…</Badge>}
        {t.status === "failed" && <Badge tone="danger">✕ Ошибка</Badge>}
        {t.status === "transcribed" && (
          <button onClick={() => download(`/transcriptions/${t.id}/transcript`, base + ".txt")}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium hover:opacity-80">
            ⬇ Транскрипт (.txt)
          </button>
        )}
      </div>

      {/* Протокол — только когда транскрипт готов */}
      {t.status === "transcribed" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {t.protocolStatus === "none" && (
            <button onClick={makeProtocol} disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              📝 Составить протокол
            </button>
          )}
          {(t.protocolStatus === "queued" || t.protocolStatus === "running") && <Badge spin>📝 Протокол готовится…</Badge>}
          {t.protocolStatus === "ready" && (
            <>
              <button onClick={() => download(`/transcriptions/${t.id}/protocol/pdf`, base + ".protocol.pdf")}
                className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium hover:opacity-80">
                ⬇ Протокол (PDF)
              </button>
              <button onClick={() => download(`/transcriptions/${t.id}/protocol/file`, base + ".protocol.md")}
                className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium hover:opacity-80">
                ⬇ .md
              </button>
              <button onClick={makeProtocol} disabled={busy} className="text-xs text-muted hover:text-text">пересоставить</button>
            </>
          )}
          {t.protocolStatus === "failed" && (
            <>
              <Badge tone="danger">✕ Протокол не собрался</Badge>
              <button onClick={makeProtocol} disabled={busy} className="text-xs text-accent">повторить</button>
            </>
          )}
        </div>
      )}

      {t.error && (t.status === "failed" || t.protocolStatus === "failed") && (
        <p className="mt-1.5 text-xs text-danger">{t.error}</p>
      )}
    </div>
  );
}

function Badge({ children, tone, spin }: { children: React.ReactNode; tone?: "danger"; spin?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ${tone === "danger" ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted"} ${spin ? "animate-pulse" : ""}`}>
      {children}
    </span>
  );
}
