import { type ReactNode, type SyntheticEvent, useState } from "react";
import { readJson, writeJson } from "@/lib/storage";
import { cn } from "@/lib/utils";

/** Opgeslagen open/dicht-toestand per `storageKey` (zoals `open` in aiverslag). */
const OPEN_STATE_KEY = "open";

function readOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  const saved = readJson<Record<string, boolean>>(OPEN_STATE_KEY, {});
  return typeof saved[storageKey] === "boolean" ? saved[storageKey] : fallback;
}

function writeOpen(storageKey: string | undefined, open: boolean): void {
  if (!storageKey) return;
  const saved = readJson<Record<string, boolean>>(OPEN_STATE_KEY, {});
  writeJson(OPEN_STATE_KEY, { ...saved, [storageKey]: open });
}

/** Open/dicht van een `<details>`: gecontroleerd (`open` + `onOpenChange`) of zelfstandig. */
function useDetailsState(
  open: boolean | undefined,
  defaultOpen: boolean,
  storageKey: string | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [own, setOwn] = useState(() => readOpen(storageKey, defaultOpen));
  const isOpen = open ?? own;
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    if (next === isOpen) return;
    if (open === undefined) setOwn(next);
    writeOpen(storageKey, next);
    onOpenChange?.(next);
  };
  return { isOpen, onToggle };
}

interface DetailsBaseProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Bewaar open/dicht in localStorage onder deze sleutel. */
  storageKey?: string;
  className?: string;
  children?: ReactNode;
}

export interface CategoryProps extends DetailsBaseProps {
  title: ReactNode;
  /** Aantal achter de titel, bv. `(12)`. */
  count?: ReactNode;
  /** Kleine grijze tekst rechts in de kop. */
  meta?: ReactNode;
}

/** Uitklapbare categorie met rand (`details.cat`): ▸/▾, titel, aantal en meta rechts. */
export function Category({
  title,
  count,
  meta,
  open,
  defaultOpen = true,
  onOpenChange,
  storageKey,
  className,
  children,
}: CategoryProps) {
  const state = useDetailsState(open, defaultOpen, storageKey, onOpenChange);
  return (
    <details
      open={state.isOpen}
      onToggle={state.onToggle}
      className={cn("mb-2.5 rounded-xl border border-line bg-white/3", className)}
    >
      <summary className="ui-summary flex flex-wrap items-baseline gap-2.5 rounded-xl px-3.5 py-3">
        <span className="text-heading">
          <b>{title}</b>
          {count !== undefined && <span className="text-fg"> ({count})</span>}
        </span>
        {meta && (
          <span className="ml-auto text-[11.5px] text-dim max-[520px]:ml-0 max-[520px]:w-full">
            {meta}
          </span>
        )}
      </summary>
      <div className="px-2.5 pb-2.5">{children}</div>
    </details>
  );
}

export interface DetailsProps extends DetailsBaseProps {
  summary: ReactNode;
}

/** Lichte uitklapper zonder rand (`details.more` / `.ond`), bv. "Toon alle 12". */
export function Details({
  summary,
  open,
  defaultOpen = false,
  onOpenChange,
  storageKey,
  className,
  children,
}: DetailsProps) {
  const state = useDetailsState(open, defaultOpen, storageKey, onOpenChange);
  return (
    <details
      open={state.isOpen}
      onToggle={state.onToggle}
      className={cn("text-[12.5px]", className)}
    >
      <summary className="ui-summary flex items-baseline gap-2 rounded-md px-1 py-1.5 text-muted hover:text-fg">
        {summary}
      </summary>
      <div className="mt-1.5">{children}</div>
    </details>
  );
}
