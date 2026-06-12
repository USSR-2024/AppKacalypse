"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(useAuth.getState().token ? "/today" : "/login");
  }, [router]);
  return null;
}
