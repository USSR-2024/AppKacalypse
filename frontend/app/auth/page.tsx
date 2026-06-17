"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/store";

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const setToken = useAuth((s) => s.setToken);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      router.replace("/login");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/bot/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data.token) {
          setToken(data.token);
          router.replace("/");
        } else if (!cancelled) {
          setErr(true);
        }
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, [params, router, setToken]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {err ? (
        <>
          <p className="text-muted">Ссылка для входа устарела.</p>
          <a href="/login" className="rounded-xl bg-accent px-4 py-2 font-medium text-white">
            На страницу входа
          </a>
        </>
      ) : (
        <p className="text-muted">Входим…</p>
      )}
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="flex min-h-dvh items-center justify-center text-muted">Входим…</main>}>
      <AuthInner />
    </Suspense>
  );
}
