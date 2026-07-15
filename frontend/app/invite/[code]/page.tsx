"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";
import { EmailLogin } from "@/components/EmailLogin";

interface InviteInfo { workspaceName: string; role: "owner" | "admin" | "member" }

const ROLE_TEXT: Record<string, string> = {
  admin: "главой пространства",
  owner: "владельцем пространства",
  member: "участником",
};

/**
 * Публичная страница приглашения (без входа). Регистрация в AppKacalypse только
 * по такой ссылке: человек вводит почту, получает код — и сразу оказывается в
 * пространстве с той ролью, которая записана в приглашении.
 */
export default function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const setToken = useAuth((s) => s.setToken);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setDead(true));
  }, [code]);

  function finish(token: string, ws?: { slug: string; pending: boolean }) {
    setToken(token);
    // pending — заявка ждёт одобрения главы; лендинг покажет экран ожидания.
    router.replace(ws && !ws.pending ? `/${ws.slug}/today` : "/");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-3xl font-bold text-white">
          A
        </div>
        <h1 className="text-2xl font-semibold">AppKacalypse</h1>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-4">
        {dead && (
          <p className="text-center text-muted">
            Ссылка-приглашение недействительна или уже использована. Попросите новую.
          </p>
        )}
        {!dead && !info && <p className="text-muted">Проверяем приглашение…</p>}
        {info && (
          <>
            <p className="text-center">
              Вас приглашают в <span className="font-semibold">«{info.workspaceName}»</span>
              <br />
              <span className="text-sm text-muted">{ROLE_TEXT[info.role] ?? "участником"}</span>
            </p>
            <p className="text-center text-xs text-muted">
              Введите рабочую почту — пришлём код. Он же станет вашим способом входа.
            </p>
            <EmailLogin invite={code} onToken={finish} />
          </>
        )}
      </div>
    </main>
  );
}
