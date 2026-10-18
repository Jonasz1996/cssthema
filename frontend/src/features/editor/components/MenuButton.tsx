import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface MenuItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  onSelect: () => void;
}

export interface MenuButtonProps {
  label: ReactNode;
  /** Toegankelijke naam als `label` alleen een icoon is. */
  ariaLabel?: string;
  title?: string;
  items: readonly MenuItem[];
  variant?: "alt" | "mini";
  align?: "start" | "end";
}

/**
 * Knop met een klein menu (WAI-ARIA menu button): Enter/Spatie/↓ opent en focust het eerste
 * item, ↑/↓/Home/End verplaatsen, Esc sluit en geeft de focus terug, klik buiten sluit.
 */
export function MenuButton({
  label,
  ariaLabel,
  title,
  items,
  variant = "alt",
  align = "end",
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const menuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [],
    ).filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") next = list[(index + 1) % list.length];
    else if (event.key === "ArrowUp") next = list[(index - 1 + list.length) % list.length];
    else if (event.key === "Home") next = list[0];
    else if (event.key === "End") next = list[list.length - 1];
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    } else if (event.key === "Tab") {
      close(false);
      return;
    }
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        ref={buttonRef}
        variant={variant}
        size={variant === "mini" ? "default" : "sm"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </Button>
      {open && (
        <ul
          id={menuId}
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "ui-pop absolute top-full z-30 mt-1.5 min-w-[230px] list-none rounded-[10px] border border-line-strong bg-[#181818] p-1 shadow-card",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className="flex w-full flex-col items-start rounded-md px-3 py-1.5 text-left text-[12.5px] text-fg outline-none hover:bg-white/10 focus:bg-white/12 disabled:cursor-default disabled:opacity-45"
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-[11px] text-dim">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
