"use client";
import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { Sheet } from "@/components/Sheet";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DOC_PRIORITY, StatusChip, STEP_STATUS, fileSize, isOfficeDoc } from "@/lib/docStrings";
import type { DocCard, DocActivity, DocRoute, DocMember, DocRoutePreview, DocCounterparty, DocPriority } from "@/lib/types";

// Человеческие подписи событий журнала: в БД лежат коды (created, version_saved…).
const ACTION_LABEL: Record<string, string> = {
  created: "Карточка создана",
  edited: "Карточка изменена",
  version_saved: "Загружена версия",
  status_changed: "Статус изменён",
  route_started: "Отправлено на согласование",
  approved: "Шаг согласован",
  rejected: "Возвращено на корректировку",
};

export default function DocCardPage() {
  const { id } = useParams<{ id: string }>();
  const ws = useWs();
  const router = useRouter();
  const token = useAuth((s) => s.token);
  const { data: d, mutate } = useSWR<DocCard>(`/documents/${id}`, fetcher);
  const { data: log, mutate: mutateLog } = useSWR<DocActivity[]>(`/documents/${id}/activity`, fetcher);
  const { data: route, mutate: mutateRoute } = useSWR<DocRoute>(`/documents/${id}/route`, fetcher);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [finalDecision, setFinalDecision] = useState<"approve" | "reject" | null>(null);

  if (!d) return <main className="px-4 pt-12"><p className="text-sm text-muted">Загрузка…</p></main>;

  // Версию кладут в черновик или в карточку, вернувшуюся на корректировку.
  const canUpload = d.canEdit || d.status === "rework";

  function refresh() {
    mutate();
    mutateLog();
    mutateRoute();
  }

  async function remove() {
    setConfirmDel(false);
    setBusy(true);
    setErr(null);
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      router.push(wsHref(ws, "/docs"));
    } catch {
      setErr("Не удалось удалить карточку");
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/documents/${id}/versions?filename=${encodeURIComponent(file.name)}`, {
        method: "PUT",
        headers: {
          "content-type": file.type || "application/octet-stream",
          authorization: `Bearer ${token}`,
          "x-workspace": ws,
        },
        body: file,   // сырое тело, не multipart: большой файл не должен лечь в память бэка целиком
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "upload_failed");
      refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(code === "too_large" ? "Файл больше 100 МБ" : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function download(versionId: string, fileName: string) {
    // Файл отдаёт бэкенд с проверкой прав → нужен заголовок авторизации, простой ссылкой не взять.
    const r = await fetch(`/api/documents/${id}/versions/${versionId}/file`, {
      headers: { authorization: `Bearer ${token}`, "x-workspace": ws },
    });
    if (!r.ok) return setErr("Не удалось скачать файл");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  const remarksByStep = (stepId: string) => route?.remarks.filter((r) => r.stepId === stepId) ?? [];

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/docs"))} className="mb-3 text-sm text-accent">
        ← К списку
      </button>

      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {d.registryNumber && <div className="font-mono text-xs text-muted">{d.registryNumber}</div>}
            <div className="flex items-start gap-2">
              <h1 className="text-xl font-semibold">{d.title}</h1>
              {d.canRename && (
                <button
                  onClick={() => setEditOpen(true)}
                  title="Изменить название и сведения"
                  className="mt-1 shrink-0 rounded-lg px-1.5 py-0.5 text-sm text-muted transition hover:bg-surface hover:text-accent"
                >
                  ✎
                </button>
              )}
            </div>
          </div>
          <StatusChip status={d.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {d.typeName && <span>{d.typeName}</span>}
          {d.counterpartyName && <span>· {d.counterpartyName}</span>}
          <span>· {DOC_PRIORITY[d.priority]}</span>
          {d.ownerName && <span>· ответственный: {d.ownerName}</span>}
        </div>
        {d.priorityReason && <p className="mt-2 text-xs text-muted">Обоснование: {d.priorityReason}</p>}
        {d.description && <p className="mt-3 whitespace-pre-wrap text-sm">{d.description}</p>}
      </header>

      {err && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}

      {/* Две колонки на десктопе: основное слева, дорожная карта — доп-панель справа. */}
      <div className="lg:flex lg:items-start lg:gap-6">
      <div className="lg:min-w-0 lg:flex-1">

      {/* ── Решение по согласованию: показываем, только если очередь дошла до меня ── */}
      {route?.canDecide && (
        <section className="mb-6 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-4">
          <p className="mb-3 text-sm font-medium">
            {route.finalStage ? "Вы — последний согласующий. Согласуете — документ уйдёт на утверждение." : "Документ ждёт вашего решения"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setDecision("approve")}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              {route.finalStage ? "✓ Согласовать и отправить на утверждение" : "✓ Согласовать"}
            </button>
            <button
              onClick={() => setDecision("reject")}
              className="flex-1 rounded-xl bg-danger/90 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-danger"
            >
              ↩ Вернуть на корректировку
            </button>
          </div>
        </section>
      )}

      {/* ── Утверждение: документ согласован всеми, ждёт утверждения главы ── */}
      {d.canApproveFinal && (
        <section className="mb-6 rounded-2xl border border-gold/50 bg-gold-soft/60 px-4 py-4">
          <p className="mb-3 text-sm font-medium">Документ согласован всеми и ждёт вашего утверждения</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setFinalDecision("approve")}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              ✓ Утвердить
            </button>
            <button
              onClick={() => setFinalDecision("reject")}
              className="flex-1 rounded-xl bg-danger/90 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-danger"
            >
              ↩ Вернуть на доработку
            </button>
          </div>
        </section>
      )}

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Версии</h2>
          <div className="flex items-center gap-2">
            {d.currentVersionId && isOfficeDoc(d.versions.find((v) => v.id === d.currentVersionId)?.fileName) && (
              <button
                onClick={() => router.push(wsHref(ws, `/docs/${id}/edit`))}
                className="rounded-lg bg-accent/10 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/20"
              >
                ✎ Открыть в редакторе
              </button>
            )}
            {canUpload && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="rounded-lg bg-surface px-3 py-1.5 text-xs text-muted transition hover:text-text disabled:opacity-40"
                >
                  {busy ? "Загрузка…" : "↑ Загрузить версию"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </>
            )}
          </div>
        </div>

        {d.versions.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
            Файла ещё нет. Загрузите версию — без неё документ не уйдёт на согласование.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {d.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
                      v{v.versionNo}
                    </span>
                    <span className="truncate text-sm">{v.fileName}</span>
                    {v.id === d.currentVersionId && <span className="shrink-0 text-xs text-accent">текущая</span>}
                    {v.isSignedOriginal && <span className="shrink-0 text-xs text-emerald-500">оригинал</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {fileSize(v.fileSize)} · {v.authorName} · {new Date(v.createdAt).toLocaleString("ru-RU")}
                  </div>
                </div>
                <button
                  onClick={() => download(v.id, v.fileName)}
                  className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-xs transition hover:text-accent"
                >
                  ↓ Скачать
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {d.canSubmit && (
        <button
          onClick={() => setSubmitOpen(true)}
          disabled={busy || d.versions.length === 0}
          className="mb-6 w-full rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40 lg:w-auto lg:px-6"
        >
          {d.status === "rework" ? "Отправить повторно" : "Отправить на согласование"}
        </button>
      )}

      <section>
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted transition hover:text-text"
        >
          <span className={`transition ${historyOpen ? "rotate-90" : ""}`}>▸</span>
          История {log && log.length > 0 && <span className="font-normal normal-case">({log.length})</span>}
        </button>
        {historyOpen && (
          <div className="flex flex-col gap-1.5">
            {log?.length ? log.map((a) => (
              <div key={a.id} className="flex gap-2 text-xs">
                <span className="shrink-0 text-muted">{new Date(a.at).toLocaleString("ru-RU")}</span>
                <span>{ACTION_LABEL[a.action] ?? a.action}</span>
                {a.actorName && <span className="text-muted">— {a.actorName}</span>}
              </div>
            )) : <p className="text-xs text-muted">Событий пока нет.</p>}
          </div>
        )}
      </section>

      {d.canDelete && (
        <div className="mt-8 border-t border-border pt-4">
          <button
            onClick={() => setConfirmDel(true)}
            disabled={busy}
            className="text-sm text-muted transition hover:text-danger disabled:opacity-40"
          >
            🗑 Удалить карточку
          </button>
          <p className="mt-1 text-xs text-muted">
            {d.canManage ? "Для чистки ошибочных или тестовых карточек." : "Пока документ не ушёл в дело."}
          </p>
        </div>
      )}

      </div>{/* /основная колонка */}

      {/* ── Дорожная карта — доп-панель (справа на десктопе, снизу на мобиле) ── */}
      {route?.route && (
        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-4 lg:w-72 lg:shrink-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Дорожная карта</h2>
            {route.route.iteration > 1 && <span className="text-xs text-muted">круг {route.route.iteration}</span>}
          </div>
          <div className="rounded-2xl bg-surface px-4 py-4">
            {route.steps.map((s) => (
              <RoadmapNode
                key={s.id}
                name={s.assigneeName ?? "—"}
                statusLabel={STEP_STATUS[s.status]}
                circle={s.status === "approved" ? "done" : s.status === "rejected" ? "rejected" : s.status === "active" ? "active" : "pending"}
                decidedAt={s.decidedAt}
                remarks={remarksByStep(s.id)}
              />
            ))}
            <RoadmapNode
              name="Утверждение (ГД)"
              statusLabel={d.status === "on_signing" ? "на утверждении" : d.status === "approved" ? "утверждено" : "ожидает"}
              circle={d.status === "on_signing" ? "active" : d.status === "approved" ? "done" : "pending"}
              last
            />
          </div>
        </aside>
      )}

      </div>{/* /две колонки */}

      {confirmDel && (
        <ConfirmSheet
          title="Удалить карточку документа?"
          message="Необратимо: удалятся все версии, история и маршрут; связанные задачи-напоминания закроются."
          confirmLabel="Удалить"
          danger
          onConfirm={remove}
          onCancel={() => setConfirmDel(false)}
        />
      )}

      {editOpen && (
        <EditCardSheet
          doc={d}
          onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); refresh(); }}
        />
      )}

      {submitOpen && (
        <SubmitSheet
          docId={id}
          rework={d.status === "rework"}
          onClose={() => setSubmitOpen(false)}
          onDone={() => { setSubmitOpen(false); refresh(); }}
        />
      )}

      {decision && (
        <DecisionSheet
          docId={id}
          mode={decision}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); refresh(); }}
        />
      )}

      {finalDecision && (
        <DecisionSheet
          docId={id}
          mode={finalDecision}
          final
          onClose={() => setFinalDecision(null)}
          onDone={() => { setFinalDecision(null); refresh(); }}
        />
      )}
    </main>
  );
}

// Отправка на согласование. Если у типа есть матрица — маршрут собран заранее,
// показываем предпросмотр (только чтение). Иначе — ручной выбор людей по порядку.
// Узел дорожной карты согласования: кружок статуса + имя + линия к следующему.
function RoadmapNode({ name, statusLabel, circle, decidedAt, remarks, last }: {
  name: string;
  statusLabel: string;
  circle: "done" | "active" | "rejected" | "pending";
  decidedAt?: string | null;
  remarks?: { id: string; kind: string; text: string }[];
  last?: boolean;
}) {
  const circleCls =
    circle === "done" ? "bg-emerald-500 text-white" :
    circle === "rejected" ? "bg-danger text-white" :
    circle === "active" ? "border-2 border-accent bg-surface text-accent" :
    "border border-border bg-surface-2 text-muted";
  const statusCls =
    circle === "rejected" ? "text-danger" : circle === "done" ? "text-emerald-500" : circle === "active" ? "text-accent" : "text-muted";
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${circleCls}`}>
          {circle === "done" ? "✓" : circle === "rejected" ? "✕" : ""}
        </span>
        {!last && <span className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-4"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${circle === "active" ? "font-medium text-text" : ""}`}>{name}</span>
          <span className={`shrink-0 text-xs ${statusCls}`}>{statusLabel}</span>
        </div>
        {decidedAt && <div className="mt-0.5 text-xs text-muted">{new Date(decidedAt).toLocaleString("ru-RU")}</div>}
        {remarks?.map((r) => (
          <div key={r.id} className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs ${r.kind === "blocking" ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted"}`}>
            <span className="font-medium">{r.kind === "blocking" ? "Замечание" : "Комментарий"}:</span> {r.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// Правка сведений карточки. Название/описание — на любом статусе; контрагент/приоритет —
// только в черновике (после отправки поля зафиксированы вместе с содержанием).
function EditCardSheet({ doc, onClose, onDone }: { doc: DocCard; onClose: () => void; onDone: () => void }) {
  const draft = doc.canEdit;   // canEdit = черновик и моё
  const { data: counterparties } = useSWR<DocCounterparty[]>(draft ? "/documents/counterparties" : null, fetcher);
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [cpChoice, setCpChoice] = useState(doc.counterpartyId ?? (doc.counterpartyName ? "__free__" : ""));
  const [cpFree, setCpFree] = useState(doc.counterpartyId ? "" : (doc.counterpartyName ?? ""));
  const [priority, setPriority] = useState<DocPriority>(doc.priority);
  const [reason, setReason] = useState(doc.priorityReason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setErr("Название не может быть пустым");
    if (draft && priority === "critical" && !reason.trim()) return setErr("Критический приоритет требует обоснования");
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { title: title.trim(), description: description.trim() || null };
      if (draft) {
        body.priority = priority;
        body.priorityReason = priority === "critical" ? reason.trim() : null;
        if (cpChoice === "__free__") { body.counterpartyId = null; body.counterpartyName = cpFree.trim() || null; }
        else if (cpChoice) body.counterpartyId = cpChoice;
        else { body.counterpartyId = null; body.counterpartyName = null; }
      }
      await api(`/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify(body) });
      onDone();
    } catch (e) {
      setErr(e instanceof Error && e.message === "only_title_after_draft" ? "После отправки можно менять только название и описание" : "Не удалось сохранить");
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} size="lg">
      <h2 className="mb-1 text-lg font-semibold">Сведения о документе</h2>
      {!draft && <p className="mb-3 text-xs text-muted">Документ уже в работе — меняется только название и описание.</p>}

      <label className="text-xs text-muted">Название документа</label>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
        className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />

      <label className="text-xs text-muted">Описание</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
        className="mb-3 mt-1 w-full resize-none rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />

      {draft && (
        <>
          <label className="text-xs text-muted">Контрагент</label>
          <select value={cpChoice} onChange={(e) => setCpChoice(e.target.value)}
            className="mb-3 mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none">
            <option value="">— не указан —</option>
            {counterparties?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.inn ? ` (ИНН ${c.inn})` : ""}</option>)}
            <option value="__free__">Ввести вручную…</option>
          </select>
          {cpChoice === "__free__" && (
            <input value={cpFree} onChange={(e) => setCpFree(e.target.value)} placeholder="ООО «Ромашка»"
              className="mb-3 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />
          )}

          <label className="text-xs text-muted">Приоритет</label>
          <div className="mb-3 mt-1 flex gap-1">
            {(Object.keys(DOC_PRIORITY) as DocPriority[]).map((p) => (
              <button key={p} onClick={() => setPriority(p)}
                className={`flex-1 rounded-lg px-2 py-2 text-xs transition ${priority === p ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"}`}>
                {DOC_PRIORITY[p]}
              </button>
            ))}
          </div>
          {priority === "critical" && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Обоснование критичности"
              className="mb-3 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none" />
          )}
        </>
      )}

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </Sheet>
  );
}

function SubmitSheet({ docId, rework, onClose, onDone }: { docId: string; rework: boolean; onClose: () => void; onDone: () => void }) {
  const { data: preview } = useSWR<DocRoutePreview>(`/documents/${docId}/route-preview`, fetcher);
  const matrix = preview?.mode === "matrix";
  const { data: members } = useSWR<DocMember[]>(preview && !matrix ? "/documents/members" : null, fetcher);
  const [chain, setChain] = useState<string[]>([]);
  const [dueAt, setDueAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nameOf = (uid: string) => members?.find((m) => m.id === uid)?.displayName ?? "—";
  const toggle = (uid: string) => setChain((c) => (c.includes(uid) ? c.filter((x) => x !== uid) : [...c, uid]));

  async function submit() {
    setErr(null);
    if (!matrix && chain.length === 0) return setErr("Выберите хотя бы одного согласующего");
    setBusy(true);
    try {
      const body: Record<string, unknown> = matrix ? {} : { approvers: chain };
      if (dueAt) body.dueAt = new Date(dueAt).toISOString();
      await api(`/documents/${docId}/submit`, { method: "POST", body: JSON.stringify(body) });
      onDone();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "no_version" ? "Сначала загрузите файл документа" :
        code === "note_required" ? "Для этого типа нужна пояснительная записка" :
        code === "approvers_required" ? "Выберите согласующих" :
        code === "unresolved_groups" ? "В некоторых обязательных группах некому визировать — задайте состав в Настройках" :
        "Не удалось отправить на согласование",
      );
      setBusy(false);
    }
  }

  // Группируем предпросмотр матрицы по стадиям.
  const stages = matrix && preview?.rows
    ? [...new Set(preview.rows.map((r) => r.stageNo))].sort((a, b) => a - b)
    : [];

  return (
    <Sheet onClose={onClose} size="lg">
      <h2 className="mb-1 text-lg font-semibold">{rework ? "Отправить повторно" : "На согласование"}</h2>

      {!preview && <p className="text-sm text-muted">Загрузка…</p>}

      {matrix && preview?.rows && (
        <>
          <p className="mb-4 text-sm text-muted">
            Маршрут собран по матрице типа. Согласующие в одной стадии решают параллельно, стадии идут по очереди.
            {!rework && " Карточка получит реестровый номер."}
          </p>
          <div className="mb-4 flex flex-col gap-3">
            {stages.map((st) => (
              <div key={st}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Стадия {st}</div>
                <div className="flex flex-col gap-1.5">
                  {preview.rows!.filter((r) => r.stageNo === st).map((r) => (
                    <div key={r.unitId} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {r.unitName}
                        {!r.isRequired && <span className="text-xs text-muted"> · необязат.</span>}
                      </span>
                      <span className={`shrink-0 text-xs ${r.assigneeName ? "text-muted" : "text-danger"}`}>
                        {r.assigneeName ?? "некому визировать"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {preview.unresolvedRequired && preview.unresolvedRequired.length > 0 && (
            <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
              Некому визировать в обязательных группах: {preview.unresolvedRequired.join(", ")}. Задайте состав в «Настройки → Группы согласования».
            </p>
          )}
        </>
      )}

      {preview && !matrix && (
        <>
          <p className="mb-4 text-sm text-muted">
            Матрицы для этого типа нет — выберите согласующих вручную, по порядку.
            {!rework && " Карточка получит реестровый номер."}
          </p>
          {chain.length > 0 && (
            <div className="mb-3 flex flex-col gap-1.5">
              {chain.map((uid, i) => (
                <div key={uid} className="flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{nameOf(uid)}</span>
                  <button onClick={() => toggle(uid)} className="shrink-0 text-xs text-muted hover:text-danger">убрать</button>
                </div>
              ))}
            </div>
          )}
          <label className="text-xs text-muted">Участники пространства</label>
          <div className="mb-4 mt-1 flex max-h-60 flex-col gap-1 overflow-y-auto">
            {members?.filter((m) => !chain.includes(m.id)).map((m) => (
              <button key={m.id} onClick={() => toggle(m.id)}
                className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-left text-sm transition hover:bg-surface-2">
                <span className="truncate">{m.displayName}</span>
                <span className="shrink-0 text-xs text-accent">+ добавить</span>
              </button>
            ))}
          </div>
        </>
      )}

      {preview && (
        <div className="mb-4">
          <label className="text-xs text-muted">Крайний срок согласования (необязательно)</label>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
          />
          <p className="mt-1 text-xs text-muted">Попадёт в срез «Просрочено», если к сроку не согласуют.</p>
        </div>
      )}

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button
          onClick={submit}
          disabled={busy || !preview || (matrix && preview?.canSubmit === false)}
          className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Отправляем…" : "Отправить"}
        </button>
      </div>
    </Sheet>
  );
}

// Решение согласующего. Возврат требует замечания (оно блокирует), согласование
// разрешает необязательный комментарий (уйдёт в лист разногласий).
function DecisionSheet({ docId, mode, final, onClose, onDone }: { docId: string; mode: "approve" | "reject"; final?: boolean; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reject = mode === "reject";

  async function submit() {
    setErr(null);
    if (reject && !comment.trim()) return setErr("Опишите, что нужно исправить");
    setBusy(true);
    try {
      await api(`/documents/${docId}/${final ? "approve-final" : "decision"}`, {
        method: "POST",
        body: JSON.stringify({ decision: mode, comment: comment.trim() || undefined }),
      });
      onDone();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "not_your_step" ? "Сейчас очередь не за вами" :
        code === "not_on_signing" ? "Документ уже не на утверждении" :
        code === "not_approver" ? "Утверждать может только глава пространства" :
        code === "remark_required" ? "Опишите, что нужно исправить" :
        "Не удалось сохранить решение",
      );
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} size="md">
      <h2 className="mb-1 text-lg font-semibold">
        {reject ? (final ? "Вернуть на доработку" : "Вернуть на корректировку") : (final ? "Утвердить документ" : "Согласовать документ")}
      </h2>
      <p className="mb-4 text-sm text-muted">
        {reject
          ? "Замечание блокирует — документ вернётся инициатору, согласование пройдёт заново после правки."
          : final
            ? "Все согласовали. После утверждения документ будет готов (далее — подписание оригинала)."
            : "Можно приложить комментарий — он не блокирует согласование и попадёт в лист разногласий."}
      </p>

      <label className="text-xs text-muted">{reject ? "Замечание" : "Комментарий (необязательно)"}</label>
      <textarea
        autoFocus
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={4}
        placeholder={reject ? "Что нужно исправить" : "Например: согласовано при условии…"}
        className="mb-3 mt-1 w-full resize-none rounded-xl bg-surface px-3 py-2.5 text-sm outline-none"
      />

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button
          onClick={submit}
          disabled={busy}
          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-40 ${reject ? "bg-danger" : "bg-emerald-600"}`}
        >
          {busy ? "Сохраняем…" : reject ? "Вернуть" : final ? "Утвердить" : "Согласовать"}
        </button>
      </div>
    </Sheet>
  );
}
