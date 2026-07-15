"use client";
import "@livekit/components-styles";
import { useEffect, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  LiveKitRoom, GridLayout, ParticipantTile, TrackToggle, DisconnectButton,
  RoomAudioRenderer, Chat, useRoomContext, useTracks,
} from "@livekit/components-react";
import { meetStr, type MeetLang } from "@/lib/meetStrings";
import type { RecordingStatus } from "@/lib/types";

/**
 * Полноэкранный созвон с ПОЛНОСТЬЮ локализованным интерфейсом (RU/ES) — своя
 * раскладка (сетка LiveKit + своя нижняя панель на TrackToggle/DisconnectButton
 * с нашими подписями) + верхняя панель (язык / субтитры / пригласить / завершить)
 * + оверлей субтитров. Переключатель РУ/ES меняет ВЕСЬ интерфейс и язык субтитров
 * на лету во время звонка.
 */
export function MeetingRoom({
  url, token, title, viewerLang, initialCaptions = false, canRecord = false,
  initialRecording = "none", onLeave, onInvite, onEnd, onSetCaptions, onToggleRecording,
}: {
  url: string;
  token: string;
  title: string;
  viewerLang: MeetLang;
  initialCaptions?: boolean;
  canRecord?: boolean;
  initialRecording?: RecordingStatus;
  onLeave: () => void;
  onInvite?: () => void;
  onEnd?: () => void;
  onSetCaptions?: (enabled: boolean) => void | Promise<void>;
  onToggleRecording?: (action: "start" | "stop") => Promise<RecordingStatus>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  useEffect(() => () => { room.disconnect(); }, [room]);
  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black" data-lk-theme="default">
      <LiveKitRoom room={room} serverUrl={url} token={token} connect video audio onDisconnected={onLeave} style={{ height: "100dvh" }}>
        <Conference
          title={title} viewerLang={viewerLang} initialCaptions={initialCaptions}
          canRecord={canRecord} initialRecording={initialRecording}
          onInvite={onInvite} onEnd={onEnd} onSetCaptions={onSetCaptions} onToggleRecording={onToggleRecording}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}

function Conference({
  title, viewerLang, initialCaptions, canRecord, initialRecording, onInvite, onEnd, onSetCaptions, onToggleRecording,
}: {
  title: string;
  viewerLang: MeetLang;
  initialCaptions: boolean;
  canRecord: boolean;
  initialRecording: RecordingStatus;
  onInvite?: () => void;
  onEnd?: () => void;
  onSetCaptions?: (enabled: boolean) => void | Promise<void>;
  onToggleRecording?: (action: "start" | "stop") => Promise<RecordingStatus>;
}) {
  const [lang, setLang] = useState<MeetLang>(viewerLang);   // язык всего интерфейса + субтитров
  const [cc, setCc] = useState(initialCaptions);
  const [chatOpen, setChatOpen] = useState(false);
  const [rec, setRec] = useState<RecordingStatus>(initialRecording);
  const [recBusy, setRecBusy] = useState(false);
  const t = meetStr[lang];

  async function toggleRec() {
    if (!onToggleRecording || recBusy) return;
    const action = rec === "active" ? "stop" : "start";
    setRecBusy(true);
    try {
      setRec(await onToggleRecording(action));
    } catch { /* игнор — статус не меняем */ }
    finally { setRecBusy(false); }
  }

  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }],
    { onlySubscribed: false },
  );

  async function toggleCc() {
    const next = !cc;
    setCc(next);
    if (onSetCaptions) { try { await onSetCaptions(next); } catch { /* игнор */ } }
  }

  const pill = "rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur transition sm:px-3.5 sm:py-1.5 sm:text-sm";

  return (
    <div className="flex h-full w-full flex-col bg-black">
      {/* Видео */}
      <div className="relative min-h-0 flex-1">
        <GridLayout tracks={tracks} style={{ height: "100%" }}>
          <ParticipantTile />
        </GridLayout>

        {/* Верхняя панель */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-3">
          <span className="pointer-events-auto max-w-[35%] truncate rounded-full bg-black/55 px-4 py-1.5 text-sm font-medium text-white backdrop-blur">
            {title}
          </span>
          <div className="pointer-events-auto flex items-center gap-2">
            {/* Язык всего интерфейса */}
            <div className="flex items-center rounded-full bg-black/55 p-0.5 ring-1 ring-white/20 backdrop-blur">
              {(["ru", "es"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${lang === l ? "bg-white text-black" : "text-white/60 hover:text-white"}`}
                >
                  {l === "ru" ? "РУ" : "ES"}
                </button>
              ))}
            </div>
            <button
              onClick={toggleCc}
              className={`${pill} flex items-center gap-1.5 ${cc ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "bg-black/50 text-white/70 ring-1 ring-white/25 hover:text-white"}`}
            >
              <span>💬</span><span className="hidden sm:inline">{t.captions}</span>
            </button>
            {canRecord && onToggleRecording && (
              <button
                onClick={toggleRec}
                disabled={recBusy || rec === "processing"}
                className={`${pill} flex items-center gap-1.5 disabled:opacity-50 ${rec === "active" ? "bg-red-600 text-white shadow-lg shadow-red-600/30" : "bg-black/50 text-white/80 ring-1 ring-white/25 hover:text-white"}`}
              >
                <span className={rec === "active" ? "animate-pulse" : ""}>●</span>
                <span className="hidden sm:inline">{rec === "active" ? t.recStop : rec === "processing" ? t.recProcessing : recBusy ? t.recStarting : t.recStart}</span>
              </button>
            )}
            {onInvite && (
              <button onClick={onInvite} className={`${pill} flex items-center gap-1.5 bg-sky-500 text-white shadow-lg shadow-sky-500/30 hover:bg-sky-600`}>
                <span>🔗</span><span className="hidden sm:inline">{t.invite}</span>
              </button>
            )}
            {onEnd && (
              <button onClick={onEnd} className={`${pill} flex items-center gap-1.5 bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600`}>
                <span>📞</span><span className="hidden sm:inline">{t.end}</span>
              </button>
            )}
          </div>
        </div>

        {cc && <Captions lang={lang} />}

        {chatOpen && (
          <aside className="absolute bottom-2 right-2 top-16 z-20 w-80 max-w-[85%] overflow-hidden rounded-2xl bg-black/85 ring-1 ring-white/15 backdrop-blur">
            <Chat />
          </aside>
        )}
      </div>

      {/* Нижняя панель управления — иконки LiveKit + наши подписи (на телефоне только иконки) */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5 bg-black/70 p-2 sm:gap-2 sm:p-3">
        <TrackToggle source={Track.Source.Microphone} className="lk-button"><span className="hidden sm:inline">{t.mic}</span></TrackToggle>
        <TrackToggle source={Track.Source.Camera} className="lk-button"><span className="hidden sm:inline">{t.camera}</span></TrackToggle>
        <TrackToggle source={Track.Source.ScreenShare} className="lk-button"><span className="hidden sm:inline">{t.screen}</span></TrackToggle>
        <button onClick={() => setChatOpen((v) => !v)} className="lk-button" aria-pressed={chatOpen}>💬<span className="hidden sm:inline"> {t.chat}</span></button>
        <DisconnectButton className="lk-button lk-danger-button"><span aria-hidden>🚪</span><span className="hidden sm:inline"> {t.leave}</span></DisconnectButton>
      </div>
    </div>
  );
}

// Оверлей субтитров: слушает data-сообщения (topic 'captions'), показывает последние
// строки на выбранном языке (для каждого спикера — оригинал или перевод).
function Captions({ lang }: { lang: MeetLang }) {
  const room = useRoomContext();
  const [lines, setLines] = useState<{ id: string; name: string; text: string }[]>([]);

  useEffect(() => {
    const onData = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic !== "captions") return;
      try {
        const m = JSON.parse(new TextDecoder().decode(payload)) as { id: string; name: string; ru: string; es: string };
        const text = lang === "es" ? m.es : m.ru;
        if (!text) return;
        setLines((prev) => [...prev.filter((l) => l.id !== m.id), { id: m.id, name: m.name, text }].slice(-3));
      } catch { /* пропускаем битые */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, lang]);

  if (lines.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-1 px-4">
      {lines.map((l) => (
        <div key={l.id} className="max-w-2xl rounded-xl bg-black/75 px-3.5 py-1.5 text-center text-[15px] leading-snug text-white shadow-lg backdrop-blur">
          {l.name && <span className="mr-1.5 font-semibold text-emerald-300">{l.name}:</span>}
          {l.text}
        </div>
      ))}
    </div>
  );
}
