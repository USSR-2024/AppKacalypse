import { useAuth } from "./store";

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token;
  const res = await fetch("/api" + path, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
