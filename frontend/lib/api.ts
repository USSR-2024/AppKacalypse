import { useAuth } from "./store";

// Текущий воркспейс = первый сегмент пути (/<slug>/...). Шлём его в X-Workspace,
// чтобы бэкенд скоупил данные по компании. На /login, /auth, /owner и лендинге
// заголовок просто игнорируется бэкендом.
function currentWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  if (!seg || ["login", "auth", "owner", "join", "invite"].includes(seg)) return null;
  return seg;
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token;
  const ws = currentWorkspace();
  const res = await fetch("/api" + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ws ? { "x-workspace": ws } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401) {
    useAuth.getState().logout();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetcher = <T = unknown>(path: string) => api<T>(path);
