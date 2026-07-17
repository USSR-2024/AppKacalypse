"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { MeetingRoom } from "@/components/MeetingRoom";
import { meetStr } from "@/lib/meetStrings";
import type { RecordingStatus } from "@/lib/types";

interface JoinInfo {
  url: string; token: string; title: string; captions: boolean;
  recordingStatus: RecordingStatus; canRecord: boolean;
}

export default function MeetingRoomPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWs();
  const router = useRouter();
  const viewerLang = useAuth((s) => s.me?.lang) === "es" ? "es" : "ru";
  const t = meetStr[viewerLang];
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<JoinInfo>(`/meetings/${id}/token`, { method: "POST" })
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "ошибка"); });
    return () => { cancelled = true; };
  }, [id]);

  const leave = () => router.push(wsHref(ws, "/meet"));

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function invite() {
    try {
      const { url } = await api<{ url: string }>(`/meetings/${id}/invite`, { method: "POST" });
      await navigator.clipboard.writeText(url).catch(() => {});
      flash(t.linkCopied);
    } catch {
      flash(t.linkFail);
    }
  }

  async function setCaptions(enabled: boolean) {
    await api(`/meetings/${id}/captions`, { method: "PATCH", body: JSON.stringify({ enabled }) }).catch(() => {});
  }

  async function toggleRecording(action: "start" | "stop"): Promise<RecordingStatus> {
    const r = await api<{ recordingStatus: RecordingStatus }>(`/meetings/${id}/recording/${action}`, { method: "POST" });
    return r.recordingStatus;
  }

  async function end() {
    if (!confirm(t.endConfirm)) return;
    await api(`/meetings/${id}/end`, { method: "POST" }).catch(() => {});
    leave();
  }

  if (err) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-4xl">📹</div>
        <p className="font-medium">{err === "too_early" ? t.tooEarlyTitle : t.cantEnter}</p>
        <p className="text-sm text-muted">
          {err === "ended" ? t.ended : err === "too_early" ? t.opensBefore : t.notFound}
        </p>
        <button onClick={leave} className="mt-2 text-sm text-accent">{t.backToList}</button>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <p className="animate-pulse text-sm text-muted">{t.connectingMeeting}</p>
      </main>
    );
  }

  return (
    <>
      <MeetingRoom
        url={info.url} token={info.token} title={info.title}
        viewerLang={viewerLang} initialCaptions={info.captions}
        canRecord={info.canRecord} initialRecording={info.recordingStatus}
        onLeave={leave} onInvite={invite} onEnd={end} onSetCaptions={setCaptions} onToggleRecording={toggleRecording}
      />
      {toast && (
        <div className="fixed inset-x-0 top-3 z-[60] mx-auto w-fit max-w-[90%] rounded-lg bg-black/80 px-4 py-2 text-center text-sm text-white">
          {toast}
        </div>
      )}
    </>
  );
}
