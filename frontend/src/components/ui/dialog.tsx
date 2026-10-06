import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Card, CardBody, TerminalBar } from "./card";

/**
 * Modale dialoog zoals de vensters in aiverslag: donkere overlay, een kaart met terminalbalk
 * die licht meekantelt met de muis. Toegankelijk: `role="dialog"` + `aria-modal`, titel en
 * beschrijving gekoppeld, focus blijft in de dialoog (Tab/Shift+Tab), Esc en een klik op de
 * overlay sluiten (tenzij `dismissible={false}`, bv. tijdens een actie), en de focus gaat
 * terug naar het element dat de dialoog opende. De rest van de app is ondertussen `inert`.
 */

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "summary",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true",
  );
}

/** Open dialogen, bovenste laatst: alleen die reageert op Esc en houdt de focus vast. */
const stack: symbol[] = [];
let lockCount = 0;
let savedOverflow = "";

function lockApp(): void {
  if (lockCount++ > 0) return;
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.getElementById("root")?.setAttribute("inert", "");
}

function unlockApp(): void {
  if (--lockCount > 0) return;
  document.body.style.overflow = savedOverflow;
  document.getElementById("root")?.removeAttribute("inert");
}

export type DialogSize = "sm" | "md" | "lg";

const sizes: Record<DialogSize, string> = {
  sm: "max-w-[520px]",
  md: "max-w-[760px]",
  lg: "max-w-[980px]",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Commando in de terminalbalk, bv. `cssthema publish proxmox`. */
  command?: string;
  description?: ReactNode;
  /** Knoppen onderaan (rij, links uitgelijnd zoals aiverslag). */
  footer?: ReactNode;
  size?: DialogSize;
  /** Element dat bij openen de focus krijgt (anders het eerste focusbare element). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Esc, overlay-klik en de sluitknop toestaan (standaard aan). */
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Dialog(props: DialogProps) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<DialogPanel {...props} />, document.body);
}

function DialogPanel({
  onClose,
  title,
  command = "dialog",
  description,
  footer,
  size = "md",
  initialFocus,
  dismissible = true,
  className,
  children,
}: DialogProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const token = useRef(Symbol("dialog"));
  const pointerDownOnOverlay = useRef(false);
  const latest = useRef({ onClose, dismissible });

  useLayoutEffect(() => {
    latest.current = { onClose, dismissible };
  });

  // Openen: app vergrendelen, focus naar binnen; sluiten: focus terug naar de opener.
  useEffect(() => {
    const me = token.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push(me);
    lockApp();
    const panel = panelRef.current;
    if (panel) {
      const first = initialFocus?.current ?? focusables(panel)[0] ?? panel;
      first.focus();
    }

    const isTop = () => stack[stack.length - 1] === me;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !isTop()) return;
      event.stopPropagation();
      if (latest.current.dismissible) latest.current.onClose();
    };
    const onFocusIn = (event: FocusEvent) => {
      const panelEl = panelRef.current;
      if (!isTop() || !panelEl || !(event.target instanceof Node)) return;
      if (!panelEl.contains(event.target)) (focusables(panelEl)[0] ?? panelEl).focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const index = stack.indexOf(me);
      if (index >= 0) stack.splice(index, 1);
      unlockApp();
      if (opener?.isConnected) opener.focus();
    };
    // Alleen bij openen/sluiten; initialFocus wordt bewust niet opnieuw toegepast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus binnen de dialoog houden bij Tab / Shift+Tab.
  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = focusables(panelRef.current);
    if (!items.length) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-dialog-overlay=""
      className="fixed inset-0 z-[65] flex items-start justify-center overflow-auto bg-black/60 px-3.5 py-[6vh]"
      onPointerDown={(event) => {
        pointerDownOnOverlay.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const fromOverlay = pointerDownOnOverlay.current && event.target === event.currentTarget;
        pointerDownOnOverlay.current = false;
        if (fromOverlay && dismissible) onClose();
      }}
    >
      <Card
        ref={panelRef}
        tilt
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={cn("ui-pop w-full outline-none", sizes[size], className)}
      >
        <TerminalBar command={command} />
        <CardBody>
          <div className="flex items-start gap-3">
            <h2 id={titleId} className="m-0 mb-1 min-w-0 flex-1 text-base font-bold text-heading">
              {title}
            </h2>
            {dismissible && (
              <Button
                variant="mini"
                size="icon"
                tone="danger"
                aria-label={t("common.close")}
                title={t("common.close")}
                onClick={onClose}
                className="-mt-0.5 flex-none"
              >
                ✕
              </Button>
            )}
          </div>
          {description && (
            <p id={descriptionId} className="m-0 text-[12.5px] leading-[1.55] text-muted">
              {description}
            </p>
          )}
          {children && <div className="mt-3 text-[13px] leading-[1.6]">{children}</div>}
          {footer && <div className="mt-[18px] flex flex-wrap items-center gap-2.5">{footer}</div>}
        </CardBody>
      </Card>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  command?: string;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` = rode hover op de bevestigknop (verwijderen e.d.). */
  tone?: "primary" | "danger";
  /** Bezig: knoppen uit, niet sluitbaar. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bevestigingsvraag met annuleer- en bevestigknop (vervangt `window.confirm`). */
export function ConfirmDialog({
  open,
  title,
  children,
  command = "confirm",
  confirmLabel,
  cancelLabel,
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      command={command}
      size="sm"
      dismissible={!busy}
      initialFocus={cancelRef}
      footer={
        <>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="alt" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
