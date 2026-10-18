import type { Palette } from "@/api/types";
import { cn } from "@/lib/utils";
import { SWATCH_TOKENS, tokenValue } from "../lib/tokens";

export interface PaletteSwatchesProps {
  palette: Pick<Palette, "tokens"> | null | undefined;
  /** `sm` = kleine stippen (kaarten), `md` = grotere blokjes (lijsten). */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Kleine kleurstrook van een palet (achtergrond, oppervlak, tekst, accent, gevaar). Decoratief:
 * de naam van het palet staat er altijd als tekst naast.
 */
export function PaletteSwatches({ palette, size = "sm", className }: PaletteSwatchesProps) {
  return (
    <span
      aria-hidden
      data-swatches=""
      className={cn(
        "inline-flex flex-none overflow-hidden rounded-[5px] border border-white/15",
        size === "sm" ? "h-3" : "h-4",
        !palette && "border-dashed opacity-60",
        className,
      )}
    >
      {SWATCH_TOKENS.map((token) => (
        <i
          key={token}
          className={cn("block h-full", size === "sm" ? "w-2.5" : "w-4")}
          style={{ background: palette ? tokenValue(palette, token) : "transparent" }}
        />
      ))}
    </span>
  );
}
