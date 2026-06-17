"use client";
import { useParams } from "next/navigation";

/** Slug текущего воркспейса из URL (/<slug>/...). */
export function useWs(): string {
  const p = useParams<{ workspace: string }>();
  return p.workspace;
}

/** Путь внутри воркспейса: wsHref('mig', '/today') → '/mig/today'. */
export function wsHref(ws: string, path: string): string {
  return `/${ws}${path.startsWith("/") ? path : "/" + path}`;
}
