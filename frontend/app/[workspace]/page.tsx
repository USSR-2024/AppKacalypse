"use client";
import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";

export default function WorkspaceHome() {
  const router = useRouter();
  const { workspace } = useParams<{ workspace: string }>();
  useEffect(() => {
    router.replace(`/${workspace}/today`);
  }, [router, workspace]);
  return null;
}
