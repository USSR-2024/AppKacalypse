"use client";
import { useEffect, useState } from "react";
import { mutate } from "swr";

// Обновление данных протягиванием вниз от верха страницы (как в нативных приложениях).
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let startY: number | null = null;
    let dist = 0;
    let busy = false;
    const THRESHOLD = 70;
    const MAX = 90;

    const onStart = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && !busy ? e.touches[0].clientY : null;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null || busy) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && window.scrollY <= 0) {
        dist = Math.min(MAX, dy * 0.5); // сопротивление
        setPull(dist);
      } else {
        dist = 0;
        setPull(0);
      }
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (dist >= THRESHOLD && !busy) {
        busy = true;
        setRefreshing(true);
        setPull(MAX);
        try {
          await mutate(() => true);
        } catch {
          /* пусто */
        } finally {
          busy = false;
          setRefreshing(false);
          setPull(0);
          dist = 0;
        }
      } else {
        dist = 0;
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  const active = pull > 0 || refreshing;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center"
        style={{
          transform: `translateY(${pull - 36}px)`,
          opacity: refreshing ? 1 : Math.min(1, pull / 70),
          transition: active ? "none" : "transform 0.2s, opacity 0.2s",
        }}
      >
        <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-accent shadow">
          <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
        </div>
      </div>
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: active ? "none" : "transform 0.2s" }}>
        {children}
      </div>
    </>
  );
}
