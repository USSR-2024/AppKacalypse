"use client";
import { useRef } from "react";
import { useBackClose } from "@/lib/useBackClose";

// Общая оболочка всех модалок. Одна и та же вещь ведёт себя по-разному:
//   телефон  — шторка снизу (палец у нижнего края, там же safe-area);
//   десктоп  — диалог по центру экрана, как в любом нормальном desktop-приложении.
// Раньше каждая модалка верстала это сама и разъезжалась: на десктопе почти все
// «вылезали» снизу по-телефонному. Правило живёт ЗДЕСЬ — новые модалки строить на Sheet.
//
// Закрывается кликом мимо и системной «Назад» (useBackClose стекуется — закрывается
// только верхняя из вложенных).
export function Sheet({
  onClose,
  children,
  size = "md",
  padded = true,
  scroll,
  z = "z-50",
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Ширина диалога на десктопе: sm — подтверждения, md — формы, lg — широкие. */
  size?: "sm" | "md" | "lg";
  /** Внутренние отступы панели (выключить, если контент рисует их сам). */
  padded?: boolean;
  /** Максимальная высота для длинных списков (напр. "max-h-[70vh]") + прокрутка. */
  scroll?: string;
  /** Слой: пикеры поверх форм, подтверждения поверх всего. */
  z?: string;
}) {
  useBackClose(true, onClose);

  const width = { sm: "lg:max-w-sm", md: "lg:max-w-md", lg: "lg:max-w-lg" }[size];

  // Закрывать только по НАСТОЯЩЕМУ клику мимо: и нажатие, и отпускание — на фоне.
  // Иначе выделение текста в поле, отпущенное на затемнении, роняет модалку
  // (click срабатывает на общем предке = фон) и стирает всё введённое.
  const downOnBackdrop = useRef(false);

  return (
    <div
      className={`fixed inset-0 ${z} flex flex-col justify-end bg-black/50 lg:items-center lg:justify-center`}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={[
          "mx-auto w-full max-w-md bg-surface-2",
          // телефон: шторка снизу, нижний отступ под системную полосу
          "rounded-t-3xl",
          padded
            ? "p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
            : "pb-[env(safe-area-inset-bottom)]",
          // десктоп: карточка по центру, углы кругом, тень, safe-area не нужна
          "lg:rounded-3xl lg:shadow-[var(--shadow-strong)]",
          padded ? "lg:pb-5" : "lg:pb-0",
          width,
          scroll ? `${scroll} overflow-y-auto` : "",
        ].join(" ")}
      >
        {/* «Хваталка» шторки — только на телефоне: у диалога по центру её тянуть некуда. */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border lg:hidden" />
        {children}
      </div>
    </div>
  );
}
