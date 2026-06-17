"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useWs, wsHref } from "@/lib/ws";

/** <Link>, который автоматически префиксует href текущим воркспейсом: "/today" → "/<slug>/today". */
export function WsLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const ws = useWs();
  return <Link href={wsHref(ws, href)} {...rest} />;
}
