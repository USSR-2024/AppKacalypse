"use client";
import { useEffect, useRef } from "react";

// Пока модалка/лист открыт — системная кнопка «Назад» закрывает его,
// а не уводит между страницами. Стекируется: вложенные листы закрываются по очереди.
export function useBackClose(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ sheet: true }, "");
    let closedByPop = false;
    const onPop = () => {
      closedByPop = true;
      ref.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Закрылись тапом/кнопкой (не через «назад») → убрать добавленную запись истории.
      if (!closedByPop) window.history.back();
    };
  }, [open]);
}
