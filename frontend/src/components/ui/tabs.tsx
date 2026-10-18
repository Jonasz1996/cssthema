import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

/** Ids van een tab en zijn paneel, zodat `Tabs` en `TabPanel` elkaar vinden. */
export function tabIds(id: string, value: string): { tab: string; panel: string } {
  return { tab: `${id}-tab-${value}`, panel: `${id}-panel-${value}` };
}

export interface TabsProps<V extends string> {
  /** Basis-id, gedeeld met de `TabPanel`s. */
  id: string;
  items: readonly TabItem<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Toegankelijke naam van de tablijst. */
  label: string;
  className?: string;
}

/**
 * Tabs als mini-knoppen (`.tabs .mini`, actieve tab lichter). Toetsenbord: pijltjes
 * links/rechts, Home en End verplaatsen de focus én de selectie (WAI-ARIA tabs-patroon).
 */
export function Tabs<V extends string>({
  id,
  items,
  value,
  onValueChange,
  label,
  className,
}: TabsProps<V>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((item) => !item.disabled);
    const index = enabled.findIndex((item) => item.value === value);
    let next: TabItem<V> | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onValueChange(next.value);
    document.getElementById(tabIds(id, next.value).tab)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("mt-3 mb-1 flex flex-wrap gap-1.5", className)}
    >
      {items.map((item) => {
        const ids = tabIds(id, item.value);
        const selected = item.value === value;
        return (
          <Button
            key={item.value}
            id={ids.tab}
            variant="mini"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? ids.panel : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  /** Dezelfde basis-id als bij `Tabs`. */
  id: string;
  value: string;
  /** De op dit moment gekozen tab. */
  selected: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Paneel bij een tab; alleen het gekozen paneel wordt gerenderd. Het paneel zit in de
 * tabvolgorde (WAI-ARIA) en krijgt dan hetzelfde witte focuskader als de knoppen.
 */
export function TabPanel({ id, value, selected, className, children }: TabPanelProps) {
  if (value !== selected) return null;
  const ids = tabIds(id, value);
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={0}
      className={cn(
        "rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        className,
      )}
    >
      {children}
    </div>
  );
}
