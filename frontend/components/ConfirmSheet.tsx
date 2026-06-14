"use client";
import { useBackClose } from "@/lib/useBackClose";

// Лёгкое подтверждение действия (bottom-sheet). Закрывается тапом мимо и кнопкой «Назад».
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
  useBackClose(true, onCancel);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/50" onClick={onCancel}>
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl bg-surface-2 p-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
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
      </div>
    </div>
  );
}
