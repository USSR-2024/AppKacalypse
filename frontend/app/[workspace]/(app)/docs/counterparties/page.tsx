"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import type { DocCounterparty } from "@/lib/types";

// «Реестр контрагентов» — обзор справочника (чтение). Клик по строке → документы
// этого контрагента в реестре. Заводят/правят контрагентов в «Настройки → Контрагенты».
export default function CounterpartiesRegistryPage() {
  const ws = useWs();
  const router = useRouter();
  const { data, error } = useSWR<DocCounterparty[]>("/documents/counterparties", fetcher);
  const disabled = error instanceof Error && error.message === "module_disabled";
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!data) return data;
    const s = q.trim().toLowerCase();
    const filtered = s ? data.filter((c) => [c.name, c.inn, c.note].some((v) => v?.toLowerCase().includes(s))) : data;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [data, q]);

  if (disabled) return (
    <main className="px-4 pt-12">
      <h1 className="text-2xl font-semibold">Реестр контрагентов</h1>
      <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">Модуль отключён администратором пространства.</p>
    </main>
  );

  return (
    <main className="px-4 pt-12">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Реестр контрагентов</h1>
        <p className="mt-1 text-sm text-muted">
          Справочник организаций. Заводят и правят их в{" "}
          <button onClick={() => router.push(wsHref(ws, "/docs/settings"))} className="text-accent">Настройках → Контрагенты</button>.
        </p>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию, ИНН, заметке…"
        className="mb-4 w-full max-w-md rounded-xl bg-surface px-3.5 py-2 text-sm outline-none" />

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-2 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted">Контрагент</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted">ИНН</th>
              <th className="px-3 py-2 text-left font-medium text-muted">Заметка</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-muted">Документов</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id}
                onClick={() => c.docCount ? router.push(wsHref(ws, `/docs/registry?cp=${c.id}`)) : undefined}
                className={`border-t border-border transition ${c.docCount ? "cursor-pointer hover:bg-surface-2" : ""}`}>
                <td className="px-3 py-2.5 font-medium">{c.name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">{c.inn || "—"}</td>
                <td className="max-w-[320px] truncate px-3 py-2.5 text-muted">{c.note || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {c.docCount ? <span className="text-accent">{c.docCount} →</span> : <span className="text-muted">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {data && data.length === 0 ? "Контрагентов пока нет — добавьте в Настройках." : "Ничего не найдено."}
          </p>
        )}
      </div>
    </main>
  );
}
