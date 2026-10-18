import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ActionMenuItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Toelichting (bv. waarom het item uit staat); ook als `title`. */
  hint?: string;
  /** `danger` = rode hover (verwijderen). */
  tone?: "default" | "danger";
}

export interface ActionMenuProps {
  /** Toegankelijke naam van de menuknop, bv. "Acties voor Proxmox". */
  label: string;
  items: readonly ActionMenuItem[];
  disabled?: boolean;
  className?: string;
}

/**
 * Menuknop (`⋯`) met een lijst acties, volgens het WAI-ARIA menu-button-patroon: Enter, spatie
 * of ↓ opent en zet de focus op het eerste item, ↑ op het laatste; in het menu ↑/↓/Home/End,
 * Esc sluit en zet de focus terug op de knop, Tab of een klik erbuiten sluit. Een item
 * kiezen sluit het menu eerst (focus terug op de knop) zodat een dialoog die het item opent,
 * de focus daarna weer naar de knop brengt.
 */
export function ActionMenu({ label, items, disabled = false, className }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const triggerId = useId();
  const menuId = useId();

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const focusItem = useCallback((index: number) => {
    const list = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (!list.length) return;
    list[(index + list.length) % list.length]?.focus();
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Na het openen de focus in het menu zetten.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    focusItem(pendingFocus.current === "first" ? 0 : -1);
    pendingFocus.current = null;
  }, [open, focusItem]);

  // Klik buiten het menu sluit het (zonder de focus te verplaatsen).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const openWith = (focus: "first" | "last") => {
    pendingFocus.current = focus;
    if (open) {
      focusItem(focus === "first" ? 0 : -1);
      pendingFocus.current = null;
    } else setOpen(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openWith("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openWith("last");
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = menuItems().indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(-1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const select = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  return (
    <div ref={wrapperRef} className={cn("relative inline-flex", className)}>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant="mini"
        size="icon"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
      >
        <span aria-hidden>⋯</span>
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "ui-pop absolute top-full right-0 z-30 mt-1.5 flex min-w-[230px] flex-col gap-0.5 p-1",
            "rounded-[10px] border border-line-strong bg-[rgb(16_16_16/.96)] shadow-card backdrop-blur-md",
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={item.disabled || undefined}
              title={item.hint}
              data-menu-item={item.id}
              onClick={() => select(item)}
              className={cn(
                "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[7px] text-left font-mono text-[12.5px] text-fg",
                "outline-none hover:bg-white/10 focus-visible:bg-white/14 focus-visible:text-white",
                "aria-disabled:cursor-default aria-disabled:opacity-45 aria-disabled:hover:bg-transparent",
                item.tone === "danger" &&
                  "hover:text-err focus-visible:text-err aria-disabled:hover:text-fg",
              )}
            >
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.disabled && item.hint && (
                // De spatie scheidt label en uitleg in de toegankelijke naam (flex toont ze niet).
                <>
                  {" "}
                  <span className="sr-only">({item.hint})</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
