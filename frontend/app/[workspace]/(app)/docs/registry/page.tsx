"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { StatusChip } from "@/lib/docStrings";
import type { DocRow, DocCounterparty } from "@/lib/types";

// «Реестр» — подписанные и сданные в архив документы: хранение + поиск + фасеты.
// Статус/контрагент — серверные фильтры; поиск по тексту — клиентский по загруженному.
export default function RegistryPage() {
  const ws = useWs();
  const router = useRouter();
  const [filter, setFilter] = useState<string>("");
  const [cpId, setCpId] = useState<string>("");
  const [q, setQ] = useState("");
  const { data: counterparties } = useSWR<DocCounterparty[]>("/documents/counterparties", fetcher);
  const query = new URLSearchParams();
  if (filter) query.set("status", filter); else query.set("bucket", "registry");
  if (cpId) query.set("counterpartyId", cpId);
  const { data, error } = useSWR<DocRow[]>(`/documents?${query.toString()}`, fetcher);
  const disabled = error instanceof Error && error.message === "module_disabled";

  const rows = useMemo(() => {
    if (!data) return data;
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return data.filter((d) =>
      [d.title, d.registryNumber, d.counterpartyName, d.typeName].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [data, q]);

  if (disabled) return (
    <main className="px-4 pt-12">
      <h1 className="text-2xl font-semibold">Реестр</h1>
      <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
        Модуль отключён администратором пространства.
      </p>
    </main>
  );

  const dl = "ru-RU";
  const tabs: { v: string; label: string }[] = [
    { v: "", label: "Весь реестр" },
    { v: "signed", label: "Подписаны" },
    { v: "active", label: "Действуют" },
    { v: "expired", label: "Истекли" },
    { v: "terminated", label: "Расторгнуты" },
    { v: "archived", label: "В архиве" },
    { v: "cancelled", label: "Отменены" },
  ];

  return (
    <main className="px-4 pt-12">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Реестр</h1>
        <p className="mt-1 text-sm text-muted">
          Подписанные и завершённые документы. Идущие согласования — в{" "}
          <button onClick={() => router.push(wsHref(ws, "/docs"))} className="text-accent">разделе «В работе»</button>.
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по номеру, названию, контрагенту…"
          className="w-full rounded-xl bg-surface px-3.5 py-2.5 text-sm outline-none"
        />
        <select
          value={cpId}
          onChange={(e) => setCpId(e.target.value)}
          className="rounded-xl bg-surface px-3 py-2.5 text-sm text-muted outline-none sm:w-64"
        >
          <option value="">Все контрагенты</option>
          {counterparties?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
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

      {rows && rows.length === 0 && (
        <p className="text-sm text-muted">
          {q ? "Ничего не найдено." : filter ? "В этом статусе документов нет." : "Реестр пока пуст — сюда попадают подписанные документы."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows?.map((d) => (
          <button
            key={d.id}
            onClick={() => router.push(wsHref(ws, `/docs/${d.id}`))}
            className="rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {d.registryNumber && (
                    <span className="shrink-0 font-mono text-xs text-muted">{d.registryNumber}</span>
                  )}
                  <span className="truncate font-medium">{d.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {d.typeName && <span>{d.typeName}</span>}
                  {d.counterpartyName && <span>· {d.counterpartyName}</span>}
                  {d.groupName && <span>· {d.groupName}</span>}
                  <span>· {new Date(d.updatedAt).toLocaleDateString(dl)}</span>
                </div>
              </div>
              <StatusChip status={d.status} />
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
