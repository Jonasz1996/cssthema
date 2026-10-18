import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SplitterProps {
  /** `vertical` = verticale balk tussen kolommen (sleept horizontaal). */
  orientation: "vertical" | "horizontal";
  /** Huidige waarde (px of fractie, zie `min`/`max`). */
  value: number;
  min: number;
  max: number;
  /** Stapgrootte voor de pijltjestoetsen (Shift = 4×). */
  step: number;
  /** Nieuwe waarde uit een sleepafstand in px t.o.v. de startwaarde. */
  fromDelta: (start: number, deltaPx: number) => number;
  onChange: (value: number) => void;
  /** Dubbelklik / Enter: terug naar de standaardwaarde. */
  onReset?: () => void;
  /** Tijdens het slepen (bv. iframes geen muis laten opvangen). */
  onDraggingChange?: (dragging: boolean) => void;
  label: string;
  /** Id van het paneel dat groter/kleiner wordt. */
  controls?: string;
  /** Waarde voor schermlezers (bv. "230 px" of "42 %"). */
  valueText?: string;
  /**
   * De waarde hoort bij het paneel ná de splitter (bv. de preview rechts/onder): dan maakt
   * pijl links/omhoog dat paneel groter, zodat de toetsen de balk visueel volgen.
   */
  reversed?: boolean;
  className?: string;
}

/**
 * Versleepbare splitter tussen twee panelen, toegankelijk volgens het WAI-ARIA
 * "window splitter"-patroon: `role="separator"` met waarde, focusbaar, pijltjes verschuiven
 * (Shift = grotere stap), Home/End naar minimum/maximum, Enter of dubbelklik zet terug.
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  step,
  fromDelta,
  onChange,
  onReset,
  onDraggingChange,
  label,
  controls,
  valueText,
  reversed = false,
  className,
}: SplitterProps) {
  const drag = useRef<{ start: number; origin: number; pointerId: number } | null>(null);
  const clampValue = (next: number) => Math.min(max, Math.max(min, next));
  const vertical = orientation === "vertical";

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      start: value,
      origin: vertical ? event.clientX : event.clientY,
      pointerId: event.pointerId,
    };
    onDraggingChange?.(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const delta = (vertical ? event.clientX : event.clientY) - state.origin;
    onChange(clampValue(fromDelta(state.start, delta)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onDraggingChange?.(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? step * 4 : step;
    const towardsStart = vertical ? "ArrowLeft" : "ArrowUp";
    const towardsEnd = vertical ? "ArrowRight" : "ArrowDown";
    const decrease = reversed ? towardsEnd : towardsStart;
    const increase = reversed ? towardsStart : towardsEnd;
    let next: number | null = null;
    if (event.key === decrease) next = value - amount;
    else if (event.key === increase) next = value + amount;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else if (event.key === "Enter" && onReset) {
      event.preventDefault();
      onReset();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onChange(clampValue(next));
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative z-[2] flex-none touch-none bg-line outline-none select-none",
        "hover:bg-white/30 focus-visible:bg-white/60",
        vertical ? "w-[5px] cursor-col-resize" : "h-[5px] cursor-row-resize",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute rounded-full bg-white/25 group-hover:bg-white/70",
          vertical
            ? "top-1/2 left-1/2 h-8 w-[3px] -translate-1/2"
            : "top-1/2 left-1/2 h-[3px] w-8 -translate-1/2",
        )}
      />
    </div>
  );
}
