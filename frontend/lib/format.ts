import type { TaskStatus, Priority } from "./types";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "В очереди",
  in_progress: "Выполняется",
  done: "Готово",
  cancelled: "Отменено",
  archived: "Архив",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Низкий",
  normal: "Обычный",
  high: "Высокий",
};

/** ISO → значение для <input type="datetime-local"> в локальном времени. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
