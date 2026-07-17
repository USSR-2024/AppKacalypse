"use client";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";

export interface Opt {
  value: string;
  label: string;
  color?: string | null;
  avatar?: string | null;
}

export function SheetSelect({
  value,
  onChange,
  options,
  placeholder,
  title,
  allowClear = true,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  placeholder: string;
  title: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sel = options.find((o) => o.value === value);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl bg-surface px-3 py-2.5 text-left text-sm"
      >
        {sel?.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sel.color }} />}
        {sel?.avatar && <img src={sel.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />}
        <span className={`flex-1 truncate ${sel ? "text-text" : "text-muted"}`}>{sel ? sel.label : placeholder}</span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)} z="z-[60]" scroll="max-h-[70vh] lg:max-h-[60vh]">
          <p className="mb-2 px-1 text-sm font-medium text-muted">{title}</p>
          <div className="flex flex-col">
            {allowClear && (
              <button onClick={() => pick("")} className="flex items-center gap-3 rounded-xl px-2 py-3 text-left text-muted active:bg-surface">
                — не выбрано
              </button>
            )}
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => pick(o.value)}
                className={`flex items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-surface lg:hover:bg-surface ${o.value === value ? "text-accent" : ""}`}
              >
                {o.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.color }} />}
                {o.avatar ? (
                  <img src={o.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                ) : (
                  !o.color && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-xs">{o.label.slice(0, 1)}</span>
                )}
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <span>✓</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
