import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

interface Ripple {
  id: number;
  left: number;
  top: number;
  size: number;
}

const RIPPLE_MS = 600;

/**
 * Ripple-effect bij klik (zoals `.btn` in aiverslag). Geeft een click-handler en de te renderen
 * ripple-spans terug; het element moet `position: relative; overflow: hidden` hebben.
 * Geen ripple bij `prefers-reduced-motion` of als `enabled` false is. Een klik via het
 * toetsenbord (Enter/Spatie, `detail === 0`) start de ripple in het midden.
 */
export function useRipple(enabled: boolean): {
  trigger: (event: MouseEvent<HTMLElement>) => void;
  ripples: ReactNode;
} {
  const [items, setItems] = useState<Ripple[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const trigger = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!enabled || prefersReducedMotion()) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) / 4;
      const fromKeyboard = event.detail === 0;
      const x = fromKeyboard ? rect.width / 2 : event.clientX - rect.left;
      const y = fromKeyboard ? rect.height / 2 : event.clientY - rect.top;
      const id = nextId.current++;
      setItems((current) => [...current, { id, left: x - size / 2, top: y - size / 2, size }]);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setItems((current) => current.filter((r) => r.id !== id));
      }, RIPPLE_MS);
      timers.current.add(timer);
    },
    [enabled],
  );

  const ripples = items.map((r) => (
    <span
      key={r.id}
      aria-hidden
      data-ripple=""
      className="ui-ripple"
      style={{ left: r.left, top: r.top, width: r.size, height: r.size }}
    />
  ));

  return { trigger, ripples };
}
