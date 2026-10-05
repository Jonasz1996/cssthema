import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Pil-label (`.tag` uit aiverslag). Tonen: `default` grijs, `ok` groen, `warn` rode rand
 * ("actie nodig"), `err` rood gevuld (fout), `mid` oranje (gemiddeld / gewijzigd).
 */
export const tagVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-[7px] py-px text-[11px] leading-[1.5] whitespace-nowrap",
  {
    variants: {
      tone: {
        default: "border-line-strong text-muted",
        ok: "border-ok/60 text-ok",
        warn: "border-err text-err",
        err: "border-err bg-err/15 text-err",
        mid: "border-mid/70 text-mid",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export type TagTone = NonNullable<VariantProps<typeof tagVariants>["tone"]>;
export type TagProps = ComponentProps<"span"> & VariantProps<typeof tagVariants>;

export function Tag({ className, tone, ...props }: TagProps) {
  return <span className={cn(tagVariants({ tone }), className)} {...props} />;
}
