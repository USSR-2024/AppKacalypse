"use client";

// Явный признак задачи: личная (без проекта) или рабочая (в проекте).
export function KindToggle({ kind, onChange }: { kind: "personal" | "work"; onChange: (k: "personal" | "work") => void }) {
  return (
    <div className="flex rounded-xl bg-surface p-0.5 text-sm">
      {([["personal", "🔒 Личная"], ["work", "👥 Рабочая"]] as const).map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`flex-1 rounded-lg px-3 py-2 ${kind === k ? "bg-surface-2 font-medium" : "text-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
