"use client";
import { useEffect, useRef } from "react";

// Пока модалка/лист открыт — системная «Назад» закрывает его, а не уводит между
// страницами. Глобальный стек: открыт несколько листов → «Назад» закрывает только верхний.
type Entry = { close: () => void; closedByPop: boolean };
const stack: Entry[] = [];
// Сколько ближайших popstate-событий мы вызвали сами (history.back при закрытии тапом)
// и должны проигнорировать, чтобы они не закрыли родительский лист.
let suppress = 0;
let attached = false;

function onPop() {
  if (suppress > 0) {
    suppress--;
    return;
  }
  const top = stack[stack.length - 1];
  if (top) {
    top.closedByPop = true;
    top.close();
  }
}

export function useBackClose(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    if (!open) return;
    if (!attached) {
      window.addEventListener("popstate", onPop);
      attached = true;
    }
    const entry: Entry = { close: () => ref.current(), closedByPop: false };
    stack.push(entry);
    window.history.pushState({ sheet: true }, "");
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      // Закрылись тапом/кнопкой (не «Назад») → снять добавленную запись истории,
      // но не дать этому popstate закрыть родительский лист.
      if (!entry.closedByPop) {
        suppress++;
        window.history.back();
      }
    };
  }, [open]);
}
