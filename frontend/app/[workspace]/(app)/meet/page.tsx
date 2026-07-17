"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { meetStr } from "@/lib/meetStrings";
import { useBackClose } from "@/lib/useBackClose";
import type { Meeting, MeetingKind } from "@/lib/types";

// Локальные дата/время из <input type=date|time> → ISO со смещением часового пояса
// браузера. Именно смещение важно: без него сервер прочитает 10:00 как UTC.
function toIso(date: string, time: string): string | null {
  const d = new Date(`${date}T${time}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export default function MeetListPage() {
  const ws = useWs();
  const router = useRouter();
  const lang = useAuth((s) => s.me?.lang) === "es" ? "es" : "ru";
  const t = meetStr[lang];
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const { data, mutate } = useSWR<Meeting[]>("/meetings", fetcher);

  async function create(kind: MeetingKind, title: string, startAt?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const m = await api<{ id: string }>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title, kind, ...(startAt ? { startAt } : {}) }),
      });
      if (kind === "instant") router.push(wsHref(ws, `/meet/${m.id}/room`));
      else { setSheet(false); setBusy(false); mutate(); }
    } catch {
      setBusy(false);
    }
  }

  const all = data ?? [];
  const now = Date.now();
  const isUpcoming = (m: Meeting) => m.kind === "scheduled" && !!m.startAt && new Date(m.startAt).getTime() > now;
  const live = all.filter((m) => m.status === "active" && m.kind !== "permanent" && !isUpcoming(m));
  const upcoming = all
    .filter((m) => m.status === "active" && isUpcoming(m))
    .sort((a, b) => new Date(a.startAt!).getTime() - new Date(b.startAt!).getTime());
  const rooms = all.filter((m) => m.status === "active" && m.kind === "permanent");
  const ended = all.filter((m) => m.status === "ended");
  const dl = lang === "es" ? "es-ES" : "ru-RU";

  return (
    <main className="px-4 pt-12">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">{t.meetings}</h1>
        <p className="mt-1 text-sm text-muted">{t.meetingsDesc}</p>
      </header>

      <button onClick={() => setSheet(true)} className="mb-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white">
        📹 {t.newMeeting}
      </button>

      {upcoming.length > 0 && (
        <Section title={t.scheduled}>
          {upcoming.map((m) => (
            <MeetingRow
              key={m.id} m={m} t={t} lang={lang}
              subtitle={`${t.startsAt}: ${new Date(m.startAt!).toLocaleString(dl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
              onEnter={() => router.push(wsHref(ws, `/meet/${m.id}/room`))}
            />
          ))}
        </Section>
      )}

      {rooms.length > 0 && (
        <Section title={t.permanent}>
          {rooms.map((m) => (
            <MeetingRow key={m.id} m={m} t={t} lang={lang} subtitle={t.alwaysOpen}
              onEnter={() => router.push(wsHref(ws, `/meet/${m.id}/room`))} />
          ))}
        </Section>
      )}

      {live.length > 0 && (
        <Section title={t.ongoing}>
          {live.map((m) => (
            <MeetingRow
              key={m.id} m={m} t={t} lang={lang}
              subtitle={`${t.startedAt} ${new Date(m.createdAt).toLocaleString(dl)}${m.recordingStatus === "active" ? " · 🔴" : ""}`}
              onEnter={() => router.push(wsHref(ws, `/meet/${m.id}/room`))}
            />
          ))}
        </Section>
      )}

      {ended.length > 0 && (
        <Section title={t.past}>
          {ended.map((m) => (
            <button key={m.id} onClick={() => router.push(wsHref(ws, `/meet/${m.id}`))} className="w-full rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2">
              <div className="truncate font-medium">{m.title}</div>
              <div className="mt-0.5 text-xs text-muted">
                {new Date(m.createdAt).toLocaleDateString(dl)}
                {m.recordingStatus === "ready" || m.transcriptionId ? ` · 🎬 ${t.hasRecording}` : ""}
              </div>
            </button>
          ))}
        </Section>
      )}

      {data && data.length === 0 && <p className="text-sm text-muted">{t.empty}</p>}

      {sheet && <CreateSheet t={t} busy={busy} onClose={() => setSheet(false)} onCreate={create} />}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function MeetingRow({ m, t, subtitle, onEnter }: {
  m: Meeting; t: Record<string, string>; lang: "ru" | "es"; subtitle: string; onEnter: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!m.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(m.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard недоступен (http / отказ в разрешении) — показываем ссылку, чтобы скопировали руками
      prompt(t.copyLink, m.inviteUrl);
    }
  }

  return (
    <div className="rounded-2xl bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{m.title}</div>
          <div className="mt-0.5 text-xs text-muted">{subtitle}</div>
        </div>
        <button onClick={onEnter} className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">
          {t.enter} →
        </button>
      </div>
      {m.inviteUrl && (
        <button onClick={copy} className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-muted transition hover:text-fg">
          {copied ? `✓ ${t.copied}` : `🔗 ${t.copyLink}`}
        </button>
      )}
    </div>
  );
}

function CreateSheet({ t, busy, onClose, onCreate }: {
  t: Record<string, string>; busy: boolean; onClose: () => void;
  onCreate: (kind: MeetingKind, title: string, startAt?: string) => void;
}) {
  const [kind, setKind] = useState<MeetingKind>("scheduled");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [err, setErr] = useState<string | null>(null);
  useBackClose(true, onClose);

  function submit() {
    setErr(null);
    const name = title.trim() || t.meetingTitle;
    if (kind !== "scheduled") return onCreate(kind, name);
    if (!date || !time) return setErr(t.startRequired);
    const iso = toIso(date, time);
    if (!iso) return setErr(t.startRequired);
    if (new Date(iso).getTime() < Date.now()) return setErr(t.startInPast);
    onCreate("scheduled", name, iso);
  }

  const kinds: { k: MeetingKind; label: string; hint: string }[] = [
    { k: "instant", label: t.kindInstant, hint: t.kindInstantHint },
    { k: "scheduled", label: t.kindScheduled, hint: t.kindScheduledHint },
    { k: "permanent", label: t.kindPermanent, hint: t.kindPermanentHint },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-t-3xl bg-bg px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5"
      >
        <h2 className="mb-4 text-lg font-semibold">{t.newMeeting}</h2>

        <div className="mb-4 flex flex-col gap-2">
          {kinds.map(({ k, label, hint }) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-xl px-3 py-2.5 text-left transition ${kind === k ? "bg-accent text-white" : "bg-surface hover:bg-surface-2"}`}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className={`text-xs ${kind === k ? "text-white/75" : "text-muted"}`}>{hint}</div>
            </button>
          ))}
        </div>

        <label className="text-xs text-muted">{t.titleLabel}</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t.meetingTitle}
          className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
        />

        {kind === "scheduled" && (
          <div className="mb-3 flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted">{t.dateLabel}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />
            </div>
            <div className="w-32">
              <label className="text-xs text-muted">{t.timeLabel}</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />
            </div>
          </div>
        )}

        {kind === "scheduled" && <p className="mb-3 text-xs text-muted">{t.opensBefore}</p>}
        {err && <p className="mb-3 text-sm text-danger">{err}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">{t.cancel}</button>
          <button onClick={submit} disabled={busy} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">
            {busy ? t.starting : kind === "instant" ? t.start : t.create}
          </button>
        </div>
      </div>
    </div>
  );
}
