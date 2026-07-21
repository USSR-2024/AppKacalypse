"use client";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { StatusChip, DOC_STATUS } from "@/lib/docStrings";
import type { DocRow, DocumentStatus } from "@/lib/types";

// «Реестр» — табличный вид подписанных/завершённых документов: колонки-метаданные,
// сортировка, фасеты (статус/направление/контрагент/ответственный/период), поиск,
// экспорт CSV. Данные грузим один раз (bucket=registry), всё фильтруем на клиенте.

type SortKey = "number" | "title" | "type" | "counterparty" | "owner" | "date" | "status";
const REG_STATUSES: DocumentStatus[] = ["signed", "active", "expired", "terminated", "archived", "cancelled"];
const rowDate = (d: DocRow) => d.dateSigned || d.createdAt;

export default function RegistryPage() {
  const ws = useWs();
  const router = useRouter();
  const { data, error } = useSWR<DocRow[]>("/documents?bucket=registry", fetcher);
  const disabled = error instanceof Error && error.message === "module_disabled";

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [groupId, setGroupId] = useState("");
  const [cpId, setCpId] = useState(useSearchParams().get("cp") || "");   // из «Реестра контрагентов»
  const [ownerId, setOwnerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Опции фасетов — из полного набора (не сужаются при фильтрации).
  const opts = useMemo(() => {
    const groups = new Map<string, string>(), cps = new Map<string, string>(), owners = new Map<string, string>();
    for (const d of data ?? []) {
      if (d.groupId && d.groupName) groups.set(d.groupId, d.groupName);
      if (d.counterpartyId && d.counterpartyName) cps.set(d.counterpartyId, d.counterpartyName);
      if (d.ownerId && d.ownerName) owners.set(d.ownerId, d.ownerName);
    }
    const sort = (m: Map<string, string>) => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
    return { groups: sort(groups), cps: sort(cps), owners: sort(owners) };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return data;
    const s = q.trim().toLowerCase();
    const fromT = from ? new Date(from).getTime() : null;
    const toT = to ? new Date(to).getTime() + 86400000 : null;   // включительно по дню
    const filtered = data.filter((d) => {
      if (status && d.status !== status) return false;
      if (groupId && d.groupId !== groupId) return false;
      if (cpId && d.counterpartyId !== cpId) return false;
      if (ownerId && d.ownerId !== ownerId) return false;
      if (fromT || toT) {
        const t = new Date(rowDate(d)).getTime();
        if (fromT && t < fromT) return false;
        if (toT && t >= toT) return false;
      }
      if (s && ![d.title, d.registryNumber, d.counterpartyName, d.typeName, d.ownerName].some((v) => v?.toLowerCase().includes(s))) return false;
      return true;
    });
    const val = (d: DocRow): string => {
      switch (sortKey) {
        case "number": return d.registryNumber ?? "";
        case "title": return d.title;
        case "type": return d.typeName ?? "";
        case "counterparty": return d.counterpartyName ?? "";
        case "owner": return d.ownerName ?? "";
        case "status": return DOC_STATUS[d.status];
        case "date": return rowDate(d);
      }
    };
    return [...filtered].sort((a, b) => {
      const cmp = sortKey === "date" ? val(a).localeCompare(val(b)) : val(a).localeCompare(val(b), "ru");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, q, status, groupId, cpId, ownerId, from, to, sortKey, sortDir]);

  function sortBy(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "date" ? "desc" : "asc"); }
  }

  function exportCsv() {
    const head = ["Номер", "Название", "Тип", "Направление", "Контрагент", "Ответственный", "Дата", "Статус"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(";")];
    for (const d of rows ?? []) {
      lines.push([
        d.registryNumber ?? "", d.title, d.typeName ?? "", d.groupName ?? "", d.counterpartyName ?? "",
        d.ownerName ?? "", new Date(rowDate(d)).toLocaleDateString("ru-RU"), DOC_STATUS[d.status],
      ].map((x) => esc(String(x))).join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Реестр_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  if (disabled) return (
    <main className="px-4 pt-12">
      <h1 className="text-2xl font-semibold">Реестр</h1>
      <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">Модуль отключён администратором пространства.</p>
    </main>
  );

  const selCls = "rounded-xl bg-surface px-3 py-2 text-sm text-muted outline-none";
  const Th = ({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium text-muted transition hover:text-text ${className}`} onClick={() => sortBy(k)}>
      {label}{sortKey === k && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <main className="px-4 pt-12">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Реестр</h1>
          <p className="mt-1 text-sm text-muted">
            Подписанные и завершённые документы. Идущие согласования — в{" "}
            <button onClick={() => router.push(wsHref(ws, "/docs"))} className="text-accent">разделе «В работе»</button>.
          </p>
        </div>
        <button onClick={exportCsv} disabled={!rows?.length}
          className="shrink-0 rounded-xl bg-surface px-4 py-2 text-sm text-muted transition hover:text-text disabled:opacity-40">
          ⭳ Экспорт CSV
        </button>
      </header>

      {/* Панель фильтров */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по номеру, названию, контрагенту…"
          className="min-w-[220px] flex-1 rounded-xl bg-surface px-3.5 py-2 text-sm outline-none" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="">Все статусы</option>
          {REG_STATUSES.map((s) => <option key={s} value={s}>{DOC_STATUS[s]}</option>)}
        </select>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={selCls}>
          <option value="">Все направления</option>
          {opts.groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={cpId} onChange={(e) => setCpId(e.target.value)} className={selCls}>
          <option value="">Все контрагенты</option>
          {opts.cps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={selCls}>
          <option value="">Все ответственные</option>
          {opts.owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="flex items-center gap-1 text-xs text-muted">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} title="Период с" />
          <span>–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} title="Период по" />
        </div>
      </div>

      {rows && (
        <p className="mb-2 text-xs text-muted">Найдено: {rows.length}{data && rows.length !== data.length ? ` из ${data.length}` : ""}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-2 text-xs">
            <tr>
              <Th k="number" label="№" />
              <Th k="title" label="Название" />
              <Th k="type" label="Тип" />
              <Th k="counterparty" label="Контрагент" />
              <Th k="owner" label="Ответственный" />
              <Th k="date" label="Дата" />
              <Th k="status" label="Статус" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((d) => (
              <tr key={d.id} onClick={() => router.push(wsHref(ws, `/docs/${d.id}`))}
                className="cursor-pointer border-t border-border transition hover:bg-surface-2">
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted">{d.registryNumber ?? "—"}</td>
                <td className="max-w-[280px] truncate px-3 py-2.5 font-medium">{d.title}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{d.typeName ?? "—"}</td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-muted">{d.counterpartyName ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{d.ownerName ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{new Date(rowDate(d)).toLocaleDateString("ru-RU")}</td>
                <td className="px-3 py-2.5"><StatusChip status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {data && data.length === 0 ? "Реестр пока пуст — сюда попадают подписанные документы." : "Ничего не найдено по фильтрам."}
          </p>
        )}
      </div>
    </main>
  );
}
