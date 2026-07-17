"use client";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import type { User } from "@/lib/types";

// Несколько исполнителей: внутренние (из команды) + внешние (имя текстом, без аккаунта).
export function AssigneePicker({
  users,
  userIds,
  externals,
  onChange,
}: {
  users: User[];
  userIds: string[];
  externals: string[];
  onChange: (userIds: string[], externals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ext, setExt] = useState("");

  const total = userIds.length + externals.length;
  const names = [
    ...userIds.map((id) => users.find((u) => u.id === id)?.displayName ?? "—"),
    ...externals,
  ];

  function toggleUser(id: string) {
    onChange(userIds.includes(id) ? userIds.filter((x) => x !== id) : [...userIds, id], externals);
  }
  function addExt() {
    const v = ext.trim();
    if (!v || externals.includes(v) || userIds.some((id) => users.find((u) => u.id === id)?.displayName === v)) {
      setExt("");
      return;
    }
    onChange(userIds, [...externals, v]);
    setExt("");
  }
  function removeExt(v: string) {
    onChange(userIds, externals.filter((x) => x !== v));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-left text-sm"
      >
        <span className="shrink-0 text-muted">Исполнители</span>
        <span className={`flex-1 truncate text-right ${total ? "text-text" : "text-muted"}`}>
          {total ? names.join(", ") : "Без исполнителя"}
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} z="z-[60]" scroll="max-h-[75vh] lg:max-h-[70vh]">
          <p className="mb-2 px-1 text-sm font-medium text-muted">Исполнители</p>

          <div className="flex flex-col">
            {users.map((u) => {
              const on = userIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggleUser(u.id)}
                  className={`flex items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-surface lg:hover:bg-surface ${on ? "text-accent" : ""}`}
                >
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs">
                      {u.displayName.slice(0, 1)}
                    </span>
                  )}
                  <span className="flex-1 truncate">{u.displayName}</span>
                  {on && <span>✓</span>}
                </button>
              );
            })}
          </div>

          {externals.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {externals.map((v) => (
                <span key={v} className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm">
                  👤 {v}
                  <button onClick={() => removeExt(v)} className="text-muted" aria-label="Убрать">✕</button>
                </span>
              ))}
            </div>
          )}

          <p className="mb-1 mt-4 px-1 text-xs text-muted">Внешний исполнитель (не из команды)</p>
          <div className="flex gap-2">
            <input
              value={ext}
              onChange={(e) => setExt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExt()}
              placeholder="Имя"
              className="flex-1 rounded-xl bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted"
            />
            <button onClick={addExt} className="rounded-xl bg-accent px-4 text-white">+</button>
          </div>

          <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-xl bg-surface py-2.5 text-sm text-muted">
            Готово
          </button>
        </Sheet>
      )}
    </>
  );
}

// Разложить assignees из задачи на внутренних и внешних — для инициализации пикера.
export function splitAssignees(assignees: { userId: string | null; externalName: string | null }[]) {
  const userIds = assignees.filter((a) => a.userId).map((a) => a.userId as string);
  const externals = assignees.filter((a) => !a.userId && a.externalName).map((a) => a.externalName as string);
  return { userIds, externals };
}
