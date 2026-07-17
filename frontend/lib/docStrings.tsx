import type { DocumentStatus, DocPriority } from "./types";

// Подписи модуля «Документы». Пока только RU: модуль внутренний, испанский —
// когда дойдёт до пользователей в Эквадоре (в трекере для этого есть meetStrings).

export const DOC_STATUS: Record<DocumentStatus, string> = {
  draft: "Черновик",
  on_approval: "На согласовании",
  rework: "На корректировке",
  approved: "Согласован",
  on_signing: "На утверждении",
  signed: "Подписан",
  active: "Действует",
  expired: "Истёк",
  terminated: "Расторгнут",
  archived: "В архиве",
  cancelled: "Отменён",
};

// Порядок важен: сверху вниз по убыванию срочности (план, фаза 7).
export const DOC_PRIORITY: Record<DocPriority, string> = {
  critical: "Критический",
  urgent: "Срочно",
  important: "Важно",
  low: "Низший",
};

const TONE: Record<DocumentStatus, string> = {
  draft: "bg-surface-2 text-muted",
  on_approval: "bg-accent/15 text-accent",
  rework: "bg-danger/15 text-danger",
  approved: "bg-accent/15 text-accent",
  on_signing: "bg-accent/15 text-accent",
  signed: "bg-emerald-500/15 text-emerald-500",
  active: "bg-emerald-500/15 text-emerald-500",
  expired: "bg-surface-2 text-muted",
  terminated: "bg-surface-2 text-muted",
  archived: "bg-surface-2 text-muted",
  cancelled: "bg-surface-2 text-muted",
};

export function StatusChip({ status }: { status: DocumentStatus }) {
  return (
    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${TONE[status]}`}>
      {DOC_STATUS[status]}
    </span>
  );
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
