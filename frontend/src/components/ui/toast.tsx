import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Kleine meldingen rechtsonder in de kaartstijl. Overal aan te roepen met `toast("…")`,
 * `toast.ok("…")`, `toast.err("…")` of `toast.mid("…")`; `<Toaster />` (in de app-shell)
 * toont ze in vaste `aria-live`-regio's (fouten `assertive`, de rest `polite`). Fouten blijven
 * langer staan; hover/focus pauzeert.
 */

export type ToastTone = "default" | "ok" | "err" | "mid";

export interface ToastItem {
  id: number;
  message: ReactNode;
  tone: ToastTone;
  /** Milliseconden tot automatisch sluiten; 0 = blijft staan. */
  duration: number;
}

export interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
}

/** Hoogstens zoveel meldingen tegelijk; de oudste verdwijnt eerst. */
export const MAX_TOASTS = 5;
const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 7000;

interface ToastState {
  toasts: ToastItem[];
  push: (message: ReactNode, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, options = {}) => {
    const tone = options.tone ?? "default";
    const id = nextId++;
    const duration = options.duration ?? (tone === "err" ? ERROR_DURATION : DEFAULT_DURATION);
    set((state) => ({
      toasts: [...state.toasts, { id, message, tone, duration }].slice(-MAX_TOASTS),
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

type ToastFn = ((message: ReactNode, options?: ToastOptions) => number) & {
  ok: (message: ReactNode, options?: Omit<ToastOptions, "tone">) => number;
  err: (message: ReactNode, options?: Omit<ToastOptions, "tone">) => number;
  mid: (message: ReactNode, options?: Omit<ToastOptions, "tone">) => number;
  dismiss: (id: number) => void;
};

export const toast: ToastFn = Object.assign(
  (message: ReactNode, options?: ToastOptions) => useToastStore.getState().push(message, options),
  {
    ok: (message: ReactNode, options?: Omit<ToastOptions, "tone">) =>
      useToastStore.getState().push(message, { ...options, tone: "ok" }),
    err: (message: ReactNode, options?: Omit<ToastOptions, "tone">) =>
      useToastStore.getState().push(message, { ...options, tone: "err" }),
    mid: (message: ReactNode, options?: Omit<ToastOptions, "tone">) =>
      useToastStore.getState().push(message, { ...options, tone: "mid" }),
    dismiss: (id: number) => useToastStore.getState().dismiss(id),
  },
);

const toneClass: Record<ToastTone, string> = {
  default: "border-l-[#888]",
  ok: "border-l-ok",
  err: "border-l-err",
  mid: "border-l-mid",
};

const markClass: Record<ToastTone, string> = {
  default: "text-muted",
  ok: "text-ok",
  err: "text-err",
  mid: "text-mid",
};

const marks: Record<ToastTone, string> = { default: "›", ok: "✓", err: "✕", mid: "!" };

function ToastView({ item }: { item: ToastItem }) {
  const { t } = useI18n();
  const dismiss = useToastStore((state) => state.dismiss);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || item.duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [paused, item.id, item.duration, dismiss]);

  // Geen eigen role=status/alert: de omringende live-regio kondigt de melding aan.
  return (
    <div
      data-tone={item.tone}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "ui-toast pointer-events-auto flex items-start gap-2.5 rounded-[10px] border border-line-strong border-l-[3px]",
        "bg-[rgb(16_16_16/.92)] px-3 py-2.5 text-[12.5px] leading-[1.5] text-fg shadow-card backdrop-blur-md",
        toneClass[item.tone],
      )}
    >
      <span aria-hidden className={cn("flex-none font-bold", markClass[item.tone])}>
        {marks[item.tone]}
      </span>
      <div className="min-w-0 flex-1 break-words">{item.message}</div>
      <Button
        variant="mini"
        size="icon"
        className="-my-0.5 size-6 flex-none text-[11px]"
        aria-label={t("common.dismiss")}
        onClick={() => dismiss(item.id)}
      >
        ✕
      </Button>
    </div>
  );
}

/**
 * Regio met de meldingen; één keer in de app-shell renderen. Beide live-regio's staan er altijd,
 * ook leeg: een live-regio die samen met zijn inhoud in de DOM komt, lezen schermlezers vaak
 * niet voor. Fouten komen in de `assertive`-regio (onderaan, het dichtst bij de hoek).
 */
export function Toaster() {
  const { t } = useI18n();
  const toasts = useToastStore((state) => state.toasts);
  if (typeof document === "undefined") return null;
  const errors = toasts.filter((item) => item.tone === "err");
  const others = toasts.filter((item) => item.tone !== "err");
  return createPortal(
    <section
      aria-label={t("common.notifications")}
      className="pointer-events-none fixed right-3.5 bottom-3.5 z-[66] flex w-[min(360px,calc(100vw-28px))] flex-col gap-2"
    >
      <div aria-live="polite" data-live="polite" className="flex flex-col gap-2">
        {others.map((item) => (
          <ToastView key={item.id} item={item} />
        ))}
      </div>
      <div aria-live="assertive" data-live="assertive" className="flex flex-col gap-2">
        {errors.map((item) => (
          <ToastView key={item.id} item={item} />
        ))}
      </div>
    </section>,
    document.body,
  );
}
