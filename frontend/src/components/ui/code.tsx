import { type ComponentProps, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Codeblok (`pre` in aiverslag): donker vlak, lichtblauwe tekst, regels lopen door. */
export function Pre({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      className={cn(
        "m-0 rounded-lg border border-white/10 bg-black/45 px-3 py-2.5 font-mono text-xs leading-[1.55]",
        "break-all whitespace-pre-wrap text-code",
        className,
      )}
      {...props}
    />
  );
}

/** Inline code in lichtblauw. */
export function Code({ className, ...props }: ComponentProps<"code">) {
  return <code className={cn("font-mono text-[0.93em] text-code", className)} {...props} />;
}

export type TerminalLineKind = "out" | "cmd" | "dim" | "ok" | "err";

export interface TerminalLine {
  text: string;
  kind?: TerminalLineKind;
}

const lineClass: Record<TerminalLineKind, string> = {
  out: "",
  cmd: "text-white",
  dim: "text-dim",
  ok: "text-ok",
  err: "text-err",
};

export interface TerminalProps {
  lines: readonly TerminalLine[];
  /** Toegankelijke naam van het logvenster. */
  label?: string;
  className?: string;
}

/**
 * Zwart terminalvenster met groene tekst (`.term`), bv. voor de uitvoer van een import.
 * Scrollt automatisch naar de laatste regel; nieuwe regels worden voorgelezen (`role="log"`).
 */
export function Terminal({ lines, label, className }: TerminalProps) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <pre
      ref={ref}
      role="log"
      aria-label={label}
      aria-live="polite"
      className={cn(
        "m-0 max-h-[38vh] min-h-[70px] overflow-auto rounded-lg border border-white/10 bg-black px-3 py-2.5",
        "font-mono text-xs leading-[1.55] break-all whitespace-pre-wrap text-term",
        className,
      )}
    >
      {lines.map((line, index) => (
        <span key={index} className={cn("block", lineClass[line.kind ?? "out"])}>
          {line.text}
        </span>
      ))}
    </pre>
  );
}
