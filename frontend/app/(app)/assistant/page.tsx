"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { DraftCard, type Draft } from "@/components/DraftCard";

interface ExtractResponse {
  intent: string;
  note: string | null;
  questions: string[];
  needsConfirmation: boolean;
  drafts: Draft[];
  reply?: string;
}

interface Msg {
  id: number;
  role: "user" | "assistant";
  text?: string;
  drafts?: Draft[];
}

let counter = 0;

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: ++counter, role: "assistant", text: "Привет! Напиши задачу обычным языком — например «завтра Ивану проверить VPN сервер к 15:00». Я разберу и предложу карточку." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  function push(m: Omit<Msg, "id">) {
    setMessages((prev) => [...prev, { id: ++counter, ...m }]);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function buildReply(r: ExtractResponse): string {
    if (r.reply) return r.reply;
    const parts: string[] = [];
    if (r.drafts.length) parts.push(r.drafts.length > 1 ? `Понял ${r.drafts.length} задачи:` : "Вот задача — проверь и создай:");
    else if (r.note) parts.push(`📝 Заметка: ${r.note}`);
    else parts.push("Похоже, это не задача. Опиши, что нужно сделать, и я предложу карточку.");
    if (r.questions?.length) parts.push("Уточни: " + r.questions.join(" "));
    return parts.join("\n");
  }

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    push({ role: "user", text: t });
    setBusy(true);
    push({ role: "assistant", text: "…" });
    try {
      const r = await api<ExtractResponse>("/assistant/extract", { method: "POST", body: JSON.stringify({ text: t }) });
      setMessages((prev) => prev.slice(0, -1));
      push({ role: "assistant", text: buildReply(r), drafts: r.drafts });
    } catch {
      setMessages((prev) => prev.slice(0, -1));
      push({ role: "assistant", text: "Ошибка связи. Попробуй ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="px-4 pt-12 pb-44">
        <h1 className="mb-4 text-2xl font-semibold">Ассистент</h1>
        {messages.map((m) => (
          <div key={m.id} className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={m.role === "user" ? "max-w-[85%]" : "w-full"}>
              {m.text && (
                <div
                  className={`whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[15px] ${
                    m.role === "user" ? "bg-accent text-white" : "bg-surface text-text"
                  }`}
                >
                  {m.text}
                </div>
              )}
              {m.drafts?.map((d, i) => <DraftCard key={i} draft={d} />)}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="fixed inset-x-0 bottom-[58px] z-30 mx-auto max-w-md border-t border-border bg-surface/95 p-3 backdrop-blur">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Опиши задачу…"
            className="max-h-32 flex-1 resize-none rounded-2xl bg-surface px-4 py-2.5 text-[15px] outline-none placeholder:text-muted"
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
          >
            ↑
          </button>
        </div>
      </div>
    </>
  );
}
