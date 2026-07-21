"use client";
import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useAuth } from "@/lib/store";
import { useWs, wsHref } from "@/lib/ws";
import { Sheet } from "@/components/Sheet";
import { DOC_PRIORITY, StatusChip, STEP_STATUS, STEP_DOT, fileSize, isOfficeDoc } from "@/lib/docStrings";
import type { DocCard, DocActivity, DocRoute, DocMember, DocRoutePreview } from "@/lib/types";

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
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);

  if (!d) return <main className="px-4 pt-12"><p className="text-sm text-muted">Загрузка…</p></main>;

  // Версию кладут в черновик или в карточку, вернувшуюся на корректировку.
  const canUpload = d.canEdit || d.status === "rework";

  function refresh() {
    mutate();
    mutateLog();
    mutateRoute();
  }

  async function remove() {
    if (!confirm("Удалить карточку документа? Необратимо: удалятся все версии, история и маршрут; связанные задачи-напоминания закроются.")) return;
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
            <h1 className="text-xl font-semibold">{d.title}</h1>
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

      {/* ── Решение по согласованию: показываем, только если очередь дошла до меня ── */}
      {route?.canDecide && (
        <section className="mb-6 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-4">
          <p className="mb-3 text-sm font-medium">Документ ждёт вашего решения</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setDecision("approve")}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              ✓ Согласовать
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

      {/* ── Маршрут согласования: цепочка людей и их решения ── */}
      {route?.route && (
        <section className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Маршрут согласования</h2>
            {route.route.iteration > 1 && <span className="text-xs text-muted">круг {route.route.iteration}</span>}
          </div>
          <div className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
            {route.steps.map((s) => {
              const rem = remarksByStep(s.id);
              return (
                <div key={s.id} className="flex gap-3">
                  <div className="mt-1 flex flex-col items-center">
                    <span className={`h-2.5 w-2.5 rounded-full ${STEP_DOT[s.status]}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{s.assigneeName ?? "—"}</span>
                      <span className={`shrink-0 text-xs ${s.status === "rejected" ? "text-danger" : s.status === "approved" ? "text-emerald-500" : s.status === "active" ? "text-accent" : "text-muted"}`}>
                        {STEP_STATUS[s.status]}
                      </span>
                    </div>
                    {s.decidedAt && (
                      <div className="mt-0.5 text-xs text-muted">{new Date(s.decidedAt).toLocaleString("ru-RU")}</div>
                    )}
                    {rem.map((r) => (
                      <div
                        key={r.id}
                        className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs ${r.kind === "blocking" ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted"}`}
                      >
                        <span className="font-medium">{r.kind === "blocking" ? "Замечание" : "Комментарий"}:</span> {r.text}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">История</h2>
        <div className="flex flex-col gap-1.5">
          {log?.map((a) => (
            <div key={a.id} className="flex gap-2 text-xs">
              <span className="shrink-0 text-muted">{new Date(a.at).toLocaleString("ru-RU")}</span>
              <span>{ACTION_LABEL[a.action] ?? a.action}</span>
              {a.actorName && <span className="text-muted">— {a.actorName}</span>}
            </div>
          ))}
        </div>
      </section>

      {d.canDelete && (
        <div className="mt-8 border-t border-border pt-4">
          <button
            onClick={remove}
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
    </main>
  );
}

// Отправка на согласование. Если у типа есть матрица — маршрут собран заранее,
// показываем предпросмотр (только чтение). Иначе — ручной выбор людей по порядку.
function SubmitSheet({ docId, rework, onClose, onDone }: { docId: string; rework: boolean; onClose: () => void; onDone: () => void }) {
  const { data: preview } = useSWR<DocRoutePreview>(`/documents/${docId}/route-preview`, fetcher);
  const matrix = preview?.mode === "matrix";
  const { data: members } = useSWR<DocMember[]>(preview && !matrix ? "/documents/members" : null, fetcher);
  const [chain, setChain] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nameOf = (uid: string) => members?.find((m) => m.id === uid)?.displayName ?? "—";
  const toggle = (uid: string) => setChain((c) => (c.includes(uid) ? c.filter((x) => x !== uid) : [...c, uid]));

  async function submit() {
    setErr(null);
    if (!matrix && chain.length === 0) return setErr("Выберите хотя бы одного согласующего");
    setBusy(true);
    try {
      await api(`/documents/${docId}/submit`, { method: "POST", body: JSON.stringify(matrix ? {} : { approvers: chain }) });
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
function DecisionSheet({ docId, mode, onClose, onDone }: { docId: string; mode: "approve" | "reject"; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reject = mode === "reject";

  async function submit() {
    setErr(null);
    if (reject && !comment.trim()) return setErr("Опишите, что нужно исправить");
    setBusy(true);
    try {
      await api(`/documents/${docId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: mode, comment: comment.trim() || undefined }),
      });
      onDone();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(
        code === "not_your_step" ? "Сейчас очередь не за вами" :
        code === "remark_required" ? "Опишите, что нужно исправить" :
        "Не удалось сохранить решение",
      );
      setBusy(false);
    }
  }

  return (
    <Sheet onClose={onClose} size="md">
      <h2 className="mb-1 text-lg font-semibold">{reject ? "Вернуть на корректировку" : "Согласовать документ"}</h2>
      <p className="mb-4 text-sm text-muted">
        {reject
          ? "Замечание блокирует согласование — документ вернётся инициатору, круг начнётся заново после правки."
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
          {busy ? "Сохраняем…" : reject ? "Вернуть" : "Согласовать"}
        </button>
      </div>
    </Sheet>
  );
}
