import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Rij in een lijst (`.item`): gekleurde linkerrand per ernst. */
export const itemRowVariants = cva(
  [
    "mb-1.5 rounded-lg border border-white/6 border-l-[3px] bg-white/5 px-3.5 py-2.5",
    "transition-[background-color,border-color] duration-200 hover:border-white/18 hover:bg-white/9",
  ],
  {
    variants: {
      severity: {
        default: "border-l-[#666] hover:border-l-[#666]",
        ok: "border-l-ok hover:border-l-ok",
        mid: "border-l-mid hover:border-l-mid",
        err: "border-l-err hover:border-l-err",
      },
    },
    defaultVariants: { severity: "default" },
  },
);

const labelTone = {
  default: "text-[#888]",
  ok: "text-ok",
  mid: "text-mid",
  err: "text-err",
} as const;

export type ItemSeverity = NonNullable<VariantProps<typeof itemRowVariants>["severity"]>;

export type ItemRowProps = Omit<ComponentProps<"div">, "title"> &
  VariantProps<typeof itemRowVariants> & {
    title: ReactNode;
    /** Klein label in hoofdletters vóór de titel (bv. `hoog`, `live`). */
    label?: ReactNode;
    /** Tags achter de titel. */
    tags?: ReactNode;
    /** Grijze regel linksonder (tijd, aantallen). */
    meta?: ReactNode;
    /** Knoppen rechtsonder (meestal `Button variant="mini"`). */
    actions?: ReactNode;
  };

/**
 * Lijstrij: kop (label, titel, tags), toelichting (`children`, regels behouden) en een
 * voetregel met meta links en acties rechts. Geef een `ref` door voor `fx.remove(el)`.
 */
export function ItemRow({
  severity,
  title,
  label,
  tags,
  meta,
  actions,
  className,
  children,
  ...props
}: ItemRowProps) {
  const tone = labelTone[severity ?? "default"];
  return (
    <div className={cn(itemRowVariants({ severity }), className)} {...props}>
      <div className="flex flex-wrap items-baseline gap-2 text-[13.5px]">
        {label && (
          <span className={cn("text-[11px] tracking-[.06em] uppercase", tone)}>{label}</span>
        )}
        <b className="min-w-0 break-words text-heading">{title}</b>
        {tags}
      </div>
      {children && (
        <div className="mt-1.5 text-[12.5px] leading-[1.55] whitespace-pre-line text-body">
          {children}
        </div>
      )}
      {(meta || actions) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5 text-[11.5px] text-dim">
          <span className="min-w-0">{meta}</span>
          {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
        </div>
      )}
    </div>
  );
}
