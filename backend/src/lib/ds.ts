import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { extname } from 'node:path';
import { env } from './env.js';

// ONLYOFFICE Document Server: подпись/проверка токенов, права редактора, вызовы
// Command/Convert Service. Всё, что связано с рукопожатием DS↔бэк — в одном месте.
// Спека: docs/ТЗ-документооборот.md §4. DS выключен, если DS_JWT_SECRET пуст.

const secret = () => new TextEncoder().encode(env.DS_JWT_SECRET);

export const dsEnabled = () => env.DS_JWT_SECRET.length > 0;

/** Общая подпись JWT секретом DS (HS256). Тот же секрет и у контейнера DS. */
export async function signDs(payload: JWTPayload, ttl = '30d'): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(secret());
}

export async function verifyDs<T = JWTPayload>(token: string): Promise<T> {
  const { payload } = await jwtVerify(token, secret());
  return payload as T;
}

// ── Одноразовые токены для DS-фейсинг эндпоинтов (файл, колбэк) ───────────────
// DS не носит сессию: файл он качает и колбэк шлёт по подписанному токену в URL.

export interface FileToken extends JWTPayload { p: 'ds-file'; versionId: string; documentId: string }
export interface CbToken extends JWTPayload { p: 'ds-cb'; documentId: string }

export const signFileToken = (documentId: string, versionId: string) =>
  signDs({ p: 'ds-file', documentId, versionId }, '10m');   // ссылка на файл живёт недолго
export const signCallbackToken = (documentId: string) =>
  signDs({ p: 'ds-cb', documentId }, '1d');                 // колбэк может прийти позже, пока открыт редактор

// ── fileType / documentType ──────────────────────────────────────────────────
const WORD = new Set(['.docx', '.doc', '.odt', '.rtf', '.txt']);
const CELL = new Set(['.xlsx', '.xls', '.ods', '.csv']);
const SLIDE = new Set(['.pptx', '.ppt', '.odp']);
const PDF = new Set(['.pdf']);   // DS 9.x открывает PDF своим вьювером (у нас — только просмотр)

/** Тип редактора по расширению. null = ONLYOFFICE такое не открывает (кнопки редактора нет). */
export function docType(fileName: string): { documentType: 'word' | 'cell' | 'slide' | 'pdf'; fileType: string } | null {
  const ext = extname(fileName).toLowerCase();
  if (WORD.has(ext)) return { documentType: 'word', fileType: ext.slice(1) };
  if (CELL.has(ext)) return { documentType: 'cell', fileType: ext.slice(1) };
  if (SLIDE.has(ext)) return { documentType: 'slide', fileType: ext.slice(1) };
  if (PDF.has(ext)) return { documentType: 'pdf', fileType: ext.slice(1) };
  return null;
}

// ── Матрица прав по статусу и роли (ТЗ §4.3) ─────────────────────────────────
export interface EditorAccess {
  mode: 'edit' | 'view';
  edit: boolean;
  review: boolean;
  comment: boolean;
  trackChanges: boolean;
}

/**
 * Кто как открывает документ:
 * - автор в draft/rework — правит БЕЗ рецензирования (иначе первая версия вся в цветных вставках);
 * - согласующий на своём активном шаге — ТОЛЬКО с принудительным trackChanges (втихую цифру не поменяет);
 * - согласующий вне шага / наблюдатель / статус ≥ approved — просмотр (+коммент, если участник).
 */
export function resolveAccess(a: {
  status: string;
  isAuthor: boolean;
  activeApprover: boolean;
  pastApprover: boolean;
}): EditorAccess {
  const editable = a.status === 'draft' || a.status === 'rework';
  if (editable && a.isAuthor) {
    return { mode: 'edit', edit: true, review: false, comment: true, trackChanges: false };
  }
  if (a.status === 'on_approval' && a.activeApprover) {
    // ★ edit=false + review=true = ТОЛЬКО рецензирование: согласующий не может выключить
    // track changes и внести правку «мимо» истории. edit=true раньше это позволял (дырка).
    return { mode: 'edit', edit: false, review: true, comment: true, trackChanges: true };
  }
  if (a.activeApprover || a.pastApprover) {
    return { mode: 'view', edit: false, review: false, comment: true, trackChanges: false };
  }
  return { mode: 'view', edit: false, review: false, comment: false, trackChanges: false };
}

// ── Command / Convert Service ────────────────────────────────────────────────

/** forcesave: принудительно снять текущее состояние (перед «отправить дальше»). Вызовет callback status:6. */
export async function commandForcesave(key: string): Promise<{ error: number }> {
  const body = { c: 'forcesave', key, userdata: 'manual-save' };
  const token = await signDs({ payload: body });
  const r = await fetch(`${env.DS_INTERNAL_URL}/coauthoring/CommandService.ashx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, token }),
  });
  return (await r.json().catch(() => ({ error: -1 }))) as { error: number };
}

/** drop: выкинуть всех из редактирования (при переходе в approved документ становится view-only). */
export async function commandDrop(key: string): Promise<void> {
  const body = { c: 'drop', key };
  const token = await signDs({ payload: body });
  await fetch(`${env.DS_INTERNAL_URL}/coauthoring/CommandService.ashx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, token }),
  }).catch(() => {});
}

/**
 * Конвертация файла (docx→pdf для подписи; заодно ЛУЧШИЙ смоук-тест рукопожатия:
 * DS качает файл с бэка по внутреннему url и возвращает результат — доказывает оба
 * направления + JWT без всякого браузера).
 */
export async function convert(a: { key: string; url: string; fromExt: string; toExt: string; title: string }): Promise<{ endConvert?: boolean; fileUrl?: string; error?: number; percent?: number }> {
  const body = { async: false, filetype: a.fromExt, outputtype: a.toExt, key: a.key, url: a.url, title: a.title };
  const token = await signDs(body);
  const r = await fetch(`${env.DS_INTERNAL_URL}/ConvertService.ashx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, token }),
  });
  return (await r.json().catch(() => ({ error: -1 }))) as { endConvert?: boolean; fileUrl?: string; error?: number };
}
