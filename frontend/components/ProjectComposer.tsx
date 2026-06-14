"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useBackClose } from "@/lib/useBackClose";

const COLORS = ["#4f8cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#64748b"];

export function ProjectComposer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useBackClose(true, onClose);

  async function submit() {
    if (!name.trim()) {
      setErr("Введите название проекта");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ name: name.trim(), color }) });
      onCreated();
      onClose();
    } catch {
      setErr("Не удалось создать проект. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl bg-surface-2 p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
        <p className="mb-3 text-lg font-medium">Новый проект</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (err) setErr("");
          }}
          placeholder="Название направления"
          className="w-full rounded-xl bg-surface px-3 py-2.5 text-[15px] outline-none placeholder:text-muted"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`h-8 w-8 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-offset-surface-2 ring-white" : ""}`}
              style={{ background: c }}
              aria-label="Цвет"
            />
          ))}
        </div>

        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded-xl bg-accent py-3 font-medium text-white disabled:opacity-40"
        >
          {busy ? "…" : "Создать проект"}
        </button>
      </div>
    </div>
  );
}
