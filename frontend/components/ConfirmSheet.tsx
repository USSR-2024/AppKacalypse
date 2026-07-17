"use client";
import { Sheet } from "@/components/Sheet";

// Лёгкое подтверждение действия. Шторка на телефоне, диалог по центру на десктопе (см. Sheet).
export function ConfirmSheet({
  title,
  message,
  confirmLabel = "Подтвердить",
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet onClose={onCancel} size="sm" z="z-[70]">
      <p className="text-lg font-medium">{title}</p>
      {message && <p className="mt-1 text-sm text-muted">{message}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-xl bg-surface py-3 text-muted">
          Отмена
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 rounded-xl py-3 font-medium text-white ${danger ? "bg-danger" : "bg-accent"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
