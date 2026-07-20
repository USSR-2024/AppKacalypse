"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher, api } from "@/lib/api";
import { useWs, wsHref } from "@/lib/ws";
import { Sheet } from "@/components/Sheet";
import type { DocAdminGroup, DocAdminType, DocUnit, DocMember, DocMatrixRow, OrgUnitRole } from "@/lib/types";

// «Настройки» модуля документов: справочники, функциональные группы, матрица.
// Всё редактируется в UI — «не лезть в код» (требование владельца). Только админ.
type Tab = "types" | "groups" | "units" | "matrix";

const ROLE_LABEL: Record<OrgUnitRole, string> = { lead: "лид", member: "участник", deputy: "заместитель" };

export default function DocsSettingsPage() {
  const ws = useWs();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("types");
  // Гейт доступа: этот же запрос переиспользуют секции (SWR дедуплицирует).
  const { error } = useSWR<DocAdminGroup[]>("/docs-admin/groups", fetcher);

  if (error) return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/docs"))} className="mb-3 text-sm text-accent">← К документам</button>
      <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">Настройки документооборота доступны только администратору пространства.</p>
    </main>
  );

  const tabs: { v: Tab; label: string }[] = [
    { v: "types", label: "Типы" },
    { v: "groups", label: "Категории" },
    { v: "units", label: "Группы согласования" },
    { v: "matrix", label: "Матрица" },
  ];

  return (
    <main className="px-4 pt-12">
      <button onClick={() => router.push(wsHref(ws, "/docs"))} className="mb-3 text-sm text-accent">← К документам</button>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Настройки документооборота</h1>
        <p className="mt-1 text-sm text-muted">Типы, категории, группы согласования и матрица «тип → кто согласует».</p>
      </header>

      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition ${tab === t.v ? "bg-accent text-white" : "bg-surface text-muted hover:text-text"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "types" && <TypesSection />}
      {tab === "groups" && <GroupsSection />}
      {tab === "units" && <UnitsSection />}
      {tab === "matrix" && <MatrixSection />}
    </main>
  );
}

// ── Категории ─────────────────────────────────────────────────────────────────
function GroupsSection() {
  const { data, mutate } = useSWR<DocAdminGroup[]>("/docs-admin/groups", fetcher);
  const [add, setAdd] = useState(false);
  return (
    <section>
      <SectionHead title="Категории документов" onAdd={() => setAdd(true)} />
      <div className="flex flex-col gap-2">
        {data?.map((g) => (
          <Row key={g.id} title={g.name} subtitle={g.code}
            onDelete={async () => { await api(`/docs-admin/groups/${g.id}`, { method: "DELETE" }).catch(() => {}); mutate(); }} />
        ))}
        {data && data.length === 0 && <Empty>Категорий пока нет.</Empty>}
      </div>
      {add && <CodeNameSheet title="Новая категория" onClose={() => setAdd(false)}
        onSave={async (code, name) => { await api("/docs-admin/groups", { method: "POST", body: JSON.stringify({ code, name }) }); setAdd(false); mutate(); }} />}
    </section>
  );
}

// ── Типы ──────────────────────────────────────────────────────────────────────
function TypesSection() {
  const { data, mutate } = useSWR<DocAdminType[]>("/docs-admin/types", fetcher);
  const { data: groups } = useSWR<DocAdminGroup[]>("/docs-admin/groups", fetcher);
  const [edit, setEdit] = useState<DocAdminType | "new" | null>(null);
  return (
    <section>
      <SectionHead title="Типы документов" onAdd={() => setEdit("new")} />
      <div className="flex flex-col gap-2">
        {data?.map((t) => (
          <button key={t.id} onClick={() => setEdit(t)}
            className="rounded-2xl bg-surface px-4 py-3 text-left transition hover:bg-surface-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{t.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted">{t.code}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
              {t.groupName && <span>{t.groupName}</span>}
              <span>· SLA {t.slaDays} дн.</span>
              {t.requiresNote && <span>· нужна ПЗ</span>}
              {!t.isActive && <span className="text-danger">· выключен</span>}
            </div>
          </button>
        ))}
        {data && data.length === 0 && <Empty>Типов пока нет. Без них нельзя создать документ.</Empty>}
      </div>
      {edit && <TypeSheet type={edit === "new" ? null : edit} groups={groups ?? []}
        onClose={() => setEdit(null)} onSaved={() => { setEdit(null); mutate(); }} />}
    </section>
  );
}

function TypeSheet({ type, groups, onClose, onSaved }: { type: DocAdminType | null; groups: DocAdminGroup[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(type?.name ?? "");
  const [code, setCode] = useState(type?.code ?? "");
  const [groupId, setGroupId] = useState(type?.groupId ?? "");
  const [mask, setMask] = useState(type?.registryMask ?? "{TYPE}-{YYYY}-{NNNN}");
  const [requiresNote, setRequiresNote] = useState(type?.requiresNote ?? false);
  const [slaDays, setSlaDays] = useState(String(type?.slaDays ?? 3));
  const [reqCp, setReqCp] = useState(type?.requiresCounterparty ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!name.trim() || !code.trim()) return setErr("Название и код обязательны");
    setBusy(true);
    const body = { name: name.trim(), code: code.trim(), groupId: groupId || null, registryMask: mask.trim(), requiresNote, slaDays: Number(slaDays) || 0, requiresCounterparty: reqCp };
    try {
      if (type) await api(`/docs-admin/types/${type.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/docs-admin/types", { method: "POST", body: JSON.stringify(body) });
      onSaved();
    } catch (e) { setErr((e instanceof Error && e.message === "code_taken") ? "Такой код уже занят" : "Не удалось сохранить"); setBusy(false); }
  }

  return (
    <Sheet onClose={onClose} size="lg">
      <h2 className="mb-4 text-lg font-semibold">{type ? "Тип документа" : "Новый тип"}</h2>
      <Field label="Название"><input value={name} onChange={(e) => setName(e.target.value)} className={inp} placeholder="Договор оказания услуг" /></Field>
      <Field label="Код (латиницей, для номера)"><input value={code} onChange={(e) => setCode(e.target.value)} className={inp} placeholder="DOG" /></Field>
      <Field label="Категория">
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inp}>
          <option value="">— без категории —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      <Field label="Маска номера">
        <input value={mask} onChange={(e) => setMask(e.target.value)} className={inp} />
        <p className="mt-1 text-xs text-muted">Плейсхолдеры: {"{TYPE} {GROUP} {YYYY} {YY} {MM} {NNNN}"}</p>
      </Field>
      <Field label="SLA согласования, рабочих дней"><input value={slaDays} onChange={(e) => setSlaDays(e.target.value.replace(/\D/g, ""))} className={inp} inputMode="numeric" /></Field>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresNote} onChange={(e) => setRequiresNote(e.target.checked)} /> Нужна пояснительная записка</label>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={reqCp} onChange={(e) => setReqCp(e.target.checked)} /> Обязателен контрагент</label>
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">{busy ? "Сохраняем…" : "Сохранить"}</button>
      </div>
    </Sheet>
  );
}

// ── Группы согласования ────────────────────────────────────────────────────────
function UnitsSection() {
  const { data, mutate } = useSWR<DocUnit[]>("/docs-admin/units", fetcher);
  const { data: members } = useSWR<DocMember[]>("/documents/members", fetcher);
  const [addUnit, setAddUnit] = useState(false);
  const [addTo, setAddTo] = useState<DocUnit | null>(null);

  return (
    <section>
      <SectionHead title="Группы согласования" onAdd={() => setAddUnit(true)} />
      <p className="mb-3 text-xs text-muted">Матрица зовёт группу, а не человека. Кто «может визировать» — тот попадёт в маршрут; заместитель подстрахует.</p>
      <div className="flex flex-col gap-3">
        {data?.map((u) => (
          <div key={u.id} className="rounded-2xl bg-surface px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0"><span className="font-medium">{u.name}</span> <span className="font-mono text-xs text-muted">{u.code}</span></div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => setAddTo(u)} className="text-xs text-accent">+ человек</button>
                <button onClick={async () => { await api(`/docs-admin/units/${u.id}`, { method: "DELETE" }).catch(() => {}); mutate(); }} className="text-xs text-muted hover:text-danger">удалить</button>
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {u.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{m.displayName} <span className="text-xs text-muted">· {ROLE_LABEL[m.role]}{m.canApprove ? " · визирует" : ""}</span></span>
                  <button onClick={async () => { await api(`/docs-admin/units/${u.id}/members/${m.userId}`, { method: "DELETE" }); mutate(); }} className="shrink-0 text-xs text-muted hover:text-danger">×</button>
                </div>
              ))}
              {u.members.length === 0 && <p className="text-xs text-muted">Пока никого. Добавьте, кто визирует за группу.</p>}
            </div>
          </div>
        ))}
        {data && data.length === 0 && <Empty>Групп согласования пока нет.</Empty>}
      </div>
      {addUnit && <CodeNameSheet title="Новая группа согласования" onClose={() => setAddUnit(false)}
        onSave={async (code, name) => { await api("/docs-admin/units", { method: "POST", body: JSON.stringify({ code, name }) }); setAddUnit(false); mutate(); }} />}
      {addTo && <AddMemberSheet unit={addTo} members={members ?? []} onClose={() => setAddTo(null)} onSaved={() => { setAddTo(null); mutate(); }} />}
    </section>
  );
}

function AddMemberSheet({ unit, members, onClose, onSaved }: { unit: DocUnit; members: DocMember[]; onClose: () => void; onSaved: () => void }) {
  const inUnit = new Set(unit.members.map((m) => m.userId));
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<OrgUnitRole>("member");
  const [canApprove, setCanApprove] = useState(true);
  const [busy, setBusy] = useState(false);
  const free = members.filter((m) => !inUnit.has(m.id));

  async function save() {
    if (!userId) return;
    setBusy(true);
    try { await api(`/docs-admin/units/${unit.id}/members`, { method: "POST", body: JSON.stringify({ userId, role, canApprove }) }); onSaved(); }
    catch { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} size="md">
      <h2 className="mb-4 text-lg font-semibold">Добавить в «{unit.name}»</h2>
      <Field label="Человек">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inp}>
          <option value="">— выберите —</option>
          {free.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </select>
      </Field>
      <Field label="Роль в группе">
        <select value={role} onChange={(e) => setRole(e.target.value as OrgUnitRole)} className={inp}>
          <option value="member">участник</option>
          <option value="lead">лид</option>
          <option value="deputy">заместитель</option>
        </select>
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={canApprove} onChange={(e) => setCanApprove(e.target.checked)} /> Может визировать за группу</label>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button onClick={save} disabled={busy || !userId} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">Добавить</button>
      </div>
    </Sheet>
  );
}

// ── Матрица ─────────────────────────────────────────────────────────────────
function MatrixSection() {
  const { data: types } = useSWR<DocAdminType[]>("/docs-admin/types", fetcher);
  const { data: units } = useSWR<DocUnit[]>("/docs-admin/units", fetcher);
  const [typeId, setTypeId] = useState("");
  const { data: rows, mutate } = useSWR<DocMatrixRow[]>(typeId ? `/docs-admin/matrix/${typeId}` : null, fetcher);
  const [busy, setBusy] = useState(false);

  // локальная модель: unitId → stageNo (0 = не участвует)
  const stageOf = (unitId: string) => rows?.find((r) => r.unitId === unitId)?.stageNo ?? 0;
  const requiredOf = (unitId: string) => rows?.find((r) => r.unitId === unitId)?.isRequired ?? true;

  async function setUnit(unitId: string, stageNo: number, isRequired: boolean) {
    if (!typeId) return;
    const others = (rows ?? []).filter((r) => r.unitId !== unitId).map((r) => ({ unitId: r.unitId, stageNo: r.stageNo, isRequired: r.isRequired, slaDays: r.slaDays }));
    const next = stageNo > 0 ? [...others, { unitId, stageNo, isRequired }] : others;
    setBusy(true);
    try { await api(`/docs-admin/matrix/${typeId}`, { method: "PUT", body: JSON.stringify({ rows: next }) }); await mutate(); }
    finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">Матрица согласования</h2>
      <p className="mb-3 text-xs text-muted">Тип документа → какие группы согласуют и на какой стадии. Одна стадия = согласуют параллельно; разные стадии — по очереди.</p>
      <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`${inp} mb-4`}>
        <option value="">— выберите тип документа —</option>
        {types?.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {typeId && (
        <div className="flex flex-col gap-2">
          {units?.map((u) => {
            const st = stageOf(u.id);
            return (
              <div key={u.id} className="rounded-2xl bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{u.name}</span>
                  <select value={st} disabled={busy} onChange={(e) => setUnit(u.id, Number(e.target.value), requiredOf(u.id))}
                    className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 text-xs outline-none">
                    <option value={0}>не участвует</option>
                    {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>стадия {s}</option>)}
                  </select>
                </div>
                {st > 0 && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={requiredOf(u.id)} disabled={busy} onChange={(e) => setUnit(u.id, st, e.target.checked)} />
                    обязательная (убрать из маршрута нельзя)
                  </label>
                )}
              </div>
            );
          })}
          {units && units.length === 0 && <Empty>Сначала заведите группы согласования.</Empty>}
        </div>
      )}
    </section>
  );
}

// ── Мелкие переиспользуемые куски ─────────────────────────────────────────────
const inp = "w-full rounded-xl bg-surface px-3 py-2.5 text-sm outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-3"><label className="text-xs text-muted">{label}</label><div className="mt-1">{children}</div></div>;
}
function SectionHead({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-semibold">{title}</h2>
      <button onClick={onAdd} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white">+ Добавить</button>
    </div>
  );
}
function Row({ title, subtitle, onDelete }: { title: string; subtitle?: string; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-3">
      <div className="min-w-0"><span className="font-medium">{title}</span> {subtitle && <span className="font-mono text-xs text-muted">{subtitle}</span>}</div>
      <button onClick={onDelete} className="shrink-0 text-xs text-muted hover:text-danger">удалить</button>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">{children}</p>;
}
function CodeNameSheet({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (code: string, name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!name.trim() || !code.trim()) return setErr("Заполните оба поля");
    setBusy(true);
    try { await onSave(code.trim(), name.trim()); } catch (e) { setErr((e instanceof Error && e.message === "code_taken") ? "Код занят" : "Не удалось"); setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} size="md">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <Field label="Название"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inp} /></Field>
      <Field label="Код (латиницей)"><input value={code} onChange={(e) => setCode(e.target.value)} className={inp} placeholder="LAW" /></Field>
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-surface px-4 py-3 text-sm font-medium">Отмена</button>
        <button onClick={save} disabled={busy} className="flex-1 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-40">Сохранить</button>
      </div>
    </Sheet>
  );
}
