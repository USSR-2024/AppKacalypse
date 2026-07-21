import type { DocumentStatus, DocPriority, StepStatus } from "./types";

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

// Статусы шага маршрута: подпись + цвет точки в цепочке согласования.
export const STEP_STATUS: Record<StepStatus, string> = {
  pending: "ожидает",
  active: "на согласовании",
  approved: "согласовано",
  rejected: "вернул на корректировку",
  skipped: "пропущено",
};

export const STEP_DOT: Record<StepStatus, string> = {
  pending: "bg-surface-2",
  active: "bg-accent",
  approved: "bg-emerald-500",
  rejected: "bg-danger",
  skipped: "bg-surface-2",
};

// Форматы, которые открывает ONLYOFFICE на РЕДАКТИРОВАНИЕ (docx и т.п.).
const OFFICE_EXT = /\.(docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?|odp)$/i;
export const isOfficeDoc = (fileName?: string): boolean => !!fileName && OFFICE_EXT.test(fileName);
// PDF — только просмотр (DS 9.x открывает своим вьювером).
export const isPdfDoc = (fileName?: string): boolean => !!fileName && /\.pdf$/i.test(fileName);
// Всё, что можно открыть в ONLYOFFICE (редактор или просмотр PDF).
export const isViewable = (fileName?: string): boolean => isOfficeDoc(fileName) || isPdfDoc(fileName);

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
