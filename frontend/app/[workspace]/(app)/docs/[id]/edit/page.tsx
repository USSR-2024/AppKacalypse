"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";

// Полноэкранный редактор ONLYOFFICE. Конфиг (права, key, ссылки) собирает бэкенд;
// api.js грузится НАПРЯМУЮ с docs.appka.space, минуя наш бэк (ТЗ §4.1).

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { DocsAPI?: any }
}

interface EditorConfigResp {
  config: any;
  apiUrl: string;
  editable: boolean;
}

// Грузим api.js один раз и переиспользуем.
function loadDsApi(apiUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.DocsAPI) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ds="1"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("ds_script")));
      return;
    }
    const s = document.createElement("script");
    s.src = apiUrl;
    s.async = true;
    s.dataset.ds = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("ds_script"));
    document.head.appendChild(s);
  });
}

export default function DocEditorPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWs();
  const router = useRouter();
  const editorRef = useRef<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<EditorConfigResp>(`/documents/${id}/editor-config`);
        if (cancelled) return;
        await loadDsApi(r.apiUrl);
        if (cancelled) return;

        const config = {
          ...r.config,
          type: "desktop",
          width: "100%",
          height: "100%",
          events: {
            onDocumentReady: () => setLoading(false),
            onError: (e: any) => setErr("Редактор сообщил об ошибке: " + (e?.data ?? "")),
            // Нативная история версий с подсветкой правок (ТЗ §4.6).
            onRequestHistory: async () => {
              const h = await api<any>(`/documents/${id}/history`);
              editorRef.current?.refreshHistory({ currentVersion: h.currentVersion, history: h.history });
            },
            onRequestHistoryData: async (ev: any) => {
              const data = await api<any>(`/documents/${id}/history/${ev.data}`);
              editorRef.current?.setHistoryData(data);
            },
            onRequestHistoryClose: () => editorRef.current?.refreshHistory?.(),
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor("ds-editor", config);
      } catch (e) {
        if (cancelled) return;
        const code = e instanceof Error ? e.message : "";
        setErr(
          code === "ds_script" ? "Не удалось загрузить редактор (docs.appka.space недоступен)." :
          code === "editor_disabled" ? "Редактор ещё не подключён на сервере." :
          code === "not_editable" ? "Этот файл нельзя открыть в редакторе — только офисные форматы." :
          code === "no_version" ? "У документа нет файла для редактирования." :
          code === "forbidden" ? "Нет доступа к документу." :
          "Не удалось открыть редактор.",
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      try { editorRef.current?.destroyEditor?.(); } catch { /* noop */ }
    };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <button
          onClick={() => router.push(wsHref(ws, `/docs/${id}`))}
          className="rounded-lg px-3 py-1.5 text-sm text-accent transition hover:bg-surface"
        >
          ← К карточке
        </button>
        {loading && !err && <span className="text-xs text-muted">Открываем редактор…</span>}
      </div>

      {err ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <p className="mb-3 text-sm text-danger">{err}</p>
            <button
              onClick={() => router.push(wsHref(ws, `/docs/${id}`))}
              className="rounded-xl bg-surface px-4 py-2 text-sm"
            >
              Вернуться к карточке
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex-1">
          <div id="ds-editor" className="absolute inset-0" />
        </div>
      )}
    </div>
  );
}
