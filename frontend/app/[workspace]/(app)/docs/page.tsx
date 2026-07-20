"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { Sheet } from "@/components/Sheet";
import { DOC_STATUS, DOC_PRIORITY, StatusChip } from "@/lib/docStrings";
import type { DocRow, DocType, DocPriority, DocInboxItem } from "@/lib/types";

// Базовый список документов. Полный реестр с фасетами и категориями — фаза 6 плана.
export default function DocsPage() {
  const ws = useWs();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const { data, mutate } = useSWR<DocRow[]>(`/documents${filter ? `?status=${filter}` : ""}`, fetcher);
  const { data: inbox } = useSWR<DocInboxItem[]>("/documents/inbox", fetcher);

  const dl = "ru-RU";
  const tabs: { v: string; label: string }[] = [
    { v: "", label: "Все" },
    { v: "draft", label: "Черновики" },
    { v: "on_approval", label: "На согласовании" },
    { v: "rework", label: "На корректировке" },
    { v: "signed", label: "Подписаны" },
  ];

  return (
    <main className="px-4 pt-12">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Документы</h1>
        <p className="mt-1 text-sm text-muted">
          Карточка документа: файл, версии, согласование, история. Реестр по категориям.
        </p>
      </header>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => setSheet(true)}
          className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white sm:w-auto sm:px-6"
        >
          + Новый документ
        </button>
        {inbox && inbox.length > 0 && (
          <button
            onClick={() => router.push(wsHref(ws, "/docs/inbox"))}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm font-medium transition hover:bg-surface-2 sm:w-auto sm:px-6"
          >
            Жду решения
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold text-white">
              {inbox.length}
            </span>
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.v}
            onClick={() => setFilter(t.v)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition ${
              filter === t.v ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {data && data.length === 0 && (
        <p className="text-sm text-muted">
          {filter ? "В этом статусе документов нет." : "Документов пока нет. Создайте первый."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {data?.map((d) => (
          <button
            key={d.id}
            onClick={() => router.push(wsHref(ws, `/docs/${d.id}`))}
            className="rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {/* Номер появляется только на согласовании — у черновика его нет by design */}
                  {d.registryNumber && (
                    <span className="shrink-0 font-mono text-xs text-muted">{d.registryNumber}</span>
                  )}
                  <span className="truncate font-medium">{d.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {d.typeName && <span>{d.typeName}</span>}
                  {d.counterpartyName && <span>· {d.counterpartyName}</span>}
                  {d.ownerName && <span>· {d.ownerName}</span>}
                  {d.priority !== "important" && (
                    <span className={d.priority === "critical" ? "text-danger" : ""}>
                      · {DOC_PRIORITY[d.priority]}
                    </span>
                  )}
                  <span>· {new Date(d.updatedAt).toLocaleDateString(dl)}</span>
                </div>
              </div>
              <StatusChip status={d.status} />
            </div>
          </button>
        ))}
      </div>

      {sheet && (
        <CreateSheet
          onClose={() => setSheet(false)}
          onCreated={(id, edit) => { mutate(); router.push(wsHref(ws, edit ? `/docs/${id}/edit` : `/docs/${id}`)); }}
        />
      )}
    </main>
  );
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string, edit?: boolean) => void }) {
  const { data: types } = useSWR<DocType[]>("/documents/types", fetcher);
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [priority, setPriority] = useState<DocPriority>("important");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // blank=true — сразу создаём пустой docx и открываем редактор (писать в приложении);
  // blank=false — просто черновик, файл приложат/загрузят в карточке.
  async function submit(blank: boolean) {
    setErr(null);
    if (!title.trim()) return setErr("Укажите название");
    if (!typeId) return setErr("Выберите тип документа");
    if (priority === "critical" && !reason.trim()) return setErr("Критический приоритет требует обоснования");
    setBusy(true);
    try {
      const d = await api<{ id: string }>("/documents", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          typeId,
          counterpartyName: counterparty.trim() || undefined,
          priority,
          priorityReason: priority === "critical" ? reason.trim() : undefined,
        }),
      });
      if (blank) await api(`/documents/${d.id}/versions/blank`, { method: "POST" });
      onCreated(d.id, blank);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось создать");
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} size="lg">
      <h2 className="mb-4 text-lg font-semibold">Новый документ</h2>

      <label className="text-xs text-muted">Название</label>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Договор поставки с ООО «Ромашка»"
        className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
      />

      <label className="text-xs text-muted">Тип документа</label>
      {types && types.length === 0 ? (
        // Типы заводит админ (фаза 2). Без них создавать нечего — честно об этом говорим.
        <p className="mb-3 mt-1 rounded-xl bg-surface px-3 py-2.5 text-sm text-muted">
          Типы документов ещё не заведены. Их настраивает администратор пространства.
        </p>
      ) : (
        <select
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
        >
          <option value="">— выберите —</option>
          {types?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.requiresNote ? " (нужна пояснительная записка)" : ""}
            </option>
          ))}
        </select>
      )}

      <label className="text-xs text-muted">Контрагент</label>
      <input
        value={counterparty}
        onChange={(e) => setCounterparty(e.target.value)}
        placeholder="ООО «Ромашка»"
        className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
      />

      <label className="text-xs text-muted">Приоритет</label>
      <div className="mb-3 mt-1 flex gap-1">
        {(Object.keys(DOC_PRIORITY) as DocPriority[]).map((p) => (
          <button
            key={p}
            onClick={() => setPriority(p)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs transition ${
              priority === p ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"
            }`}
          >
            {DOC_PRIORITY[p]}
          </button>
        ))}
      </div>

      {priority === "critical" && (
        <>
          <label className="text-xs text-muted">Обоснование критичности</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Почему это критично"
            className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
          />
        </>
      )}

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => submit(true)}
          disabled={busy}
          className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Создаём…" : "✎ Создать и писать в редакторе"}
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">
            Отмена
          </button>
          <button
            onClick={() => submit(false)}
            disabled={busy}
            className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium disabled:opacity-40"
          >
            Черновик, приложу файл
          </button>
        </div>
      </div>
    </Sheet>
  );
}
