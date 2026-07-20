"use client";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { DOC_PRIORITY, StatusChip } from "@/lib/docStrings";
import type { DocInboxItem } from "@/lib/types";

// «Жду моего решения» — документы, где сейчас активен шаг маршрута на текущем юзере.
export default function InboxPage() {
  const ws = useWs();
  const router = useRouter();
  const { data } = useSWR<DocInboxItem[]>("/documents/inbox", fetcher);

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/docs"))} className="mb-3 text-sm text-accent">
        ← К документам
      </button>

      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Жду моего решения</h1>
        <p className="mt-1 text-sm text-muted">Документы, где очередь согласования дошла до вас.</p>
      </header>

      {data && data.length === 0 && (
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
          Сейчас от вас ничего не ждут. Как только документ дойдёт до вашего шага — он появится здесь.
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
                  {d.registryNumber && <span className="shrink-0 font-mono text-xs text-muted">{d.registryNumber}</span>}
                  <span className="truncate font-medium">{d.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {d.typeName && <span>{d.typeName}</span>}
                  {d.counterpartyName && <span>· {d.counterpartyName}</span>}
                  {d.ownerName && <span>· инициатор: {d.ownerName}</span>}
                  {d.priority !== "important" && (
                    <span className={d.priority === "critical" ? "text-danger" : ""}>· {DOC_PRIORITY[d.priority]}</span>
                  )}
                  {d.activatedAt && <span>· с {new Date(d.activatedAt).toLocaleDateString("ru-RU")}</span>}
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
