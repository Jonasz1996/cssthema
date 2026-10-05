import { type ComponentProps, type ReactNode, type RefObject, useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn, mergeRefs } from "@/lib/utils";

/** Prompt in de terminalbalk van elke kaart. */
export const TERMINAL_PROMPT = "root@jbogaert:~#";

/** Licht 3D-kantelen van een element op muisbeweging (zoals de dialogen in aiverslag). */
function useTilt(ref: RefObject<HTMLElement | null>, enabled: boolean, degrees = 3): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || prefersReducedMotion()) return;
    let frame = 0;
    let target = { x: 0, y: 0 };
    const apply = () => {
      frame = 0;
      el.style.transform = `perspective(1400px) rotateY(${target.x * degrees}deg) rotateX(${-target.y * degrees}deg)`;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      target = {
        x: event.clientX / window.innerWidth - 0.5,
        y: event.clientY / window.innerHeight - 0.5,
      };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      el.style.transform = "";
    };
  }, [ref, enabled, degrees]);
}

export type CardProps = ComponentProps<"section"> & {
  /** Kantel licht mee met de muis (dialogen). */
  tilt?: boolean;
};

/** Glazen kaart met blur, diepe schaduw en een draaiende conic-gradient-rand. */
export function Card({ className, tilt = false, ref, ...props }: CardProps) {
  const own = useRef<HTMLElement>(null);
  useTilt(own, tilt);
  return <section ref={mergeRefs(own, ref)} className={cn("ui-card", className)} {...props} />;
}

export type TerminalBarProps = ComponentProps<"div"> & {
  /** Commando achter de prompt, bv. `cssthema themes`. */
  command: string;
  prompt?: string;
};

/** Terminalbalk bovenaan een kaart: drie bolletjes en `root@jbogaert:~# <command>`. */
export function TerminalBar({
  command,
  prompt = TERMINAL_PROMPT,
  className,
  children,
  ...props
}: TerminalBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-hidden rounded-t-2xl border-b border-line bg-white/4",
        "px-4 py-[11px] text-[12.5px] whitespace-nowrap text-muted",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="flex flex-none gap-2">
        <i className="block size-2.5 rounded-full bg-[#7a7a7a]" />
        <i className="block size-2.5 rounded-full bg-[#5f5f5f]" />
        <i className="block size-2.5 rounded-full bg-[#444]" />
      </span>
      <span aria-hidden className="ml-2 min-w-0 flex-1 truncate" data-terminal-command={command}>
        {prompt} {command}
      </span>
      {children}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("px-7 pt-[26px] pb-[22px] max-[520px]:px-3 max-[520px]:py-[18px]", className)}
      {...props}
    />
  );
}

export type CardTitleProps = ComponentProps<"h1"> & { as?: "h1" | "h2" | "h3" };

/** Hoofdtitel met glanzende gradient-animatie. */
export function CardTitle({ as: Tag = "h1", className, ...props }: CardTitleProps) {
  return <Tag className={cn("ui-shine", className)} {...props} />;
}

/** Knipperende tekstcursor. */
export function Cursor({ className }: { className?: string }) {
  return <span aria-hidden className={cn("ui-cursor", className)} />;
}

export type HintProps = ComponentProps<"p"> & { cursor?: boolean };

/** Grijze toelichtingsregel onder een titel, optioneel met knipperende cursor. */
export function Hint({ cursor = false, className, children, ...props }: HintProps) {
  return (
    <p className={cn("mt-2.5 mb-4 text-[13px] leading-[1.6] text-muted", className)} {...props}>
      {children}
      {cursor && <Cursor />}
    </p>
  );
}

export interface PageHeaderProps {
  /** Paginatitel; zet ook de venstertitel (`<titel> · cssthema`). */
  title: string;
  hint?: ReactNode;
  /** Knipperende cursor achter de hint (standaard aan). */
  cursor?: boolean;
  /** Knoppenrij onder de hint. */
  actions?: ReactNode;
  className?: string;
}

/** Kop van een pagina in de app-kaart: glanzende titel, hint met cursor, knoppenrij. */
export function PageHeader({ title, hint, cursor = true, actions, className }: PageHeaderProps) {
  useDocumentTitle(title);
  return (
    <header className={cn("mb-1", className)}>
      <CardTitle>{title}</CardTitle>
      {hint !== undefined ? <Hint cursor={cursor}>{hint}</Hint> : <div className="mb-4" />}
      {actions && <div className="mb-3.5 flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}
