import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Cursor } from "./card";

/** Lege toestand of korte melding in een lijst (`.empty`). */
export function Empty({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("m-0 px-1.5 py-2.5 text-[13px] text-muted", className)} {...props} />;
}

/** "Laden…" (of `label`) met knipperende cursor, als statusregio. */
export function Loading({ label, className }: { label?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <p role="status" className={cn("m-0 px-1.5 py-2.5 text-[13px] text-muted", className)}>
      {label ?? t("common.loading")}
      <Cursor />
    </p>
  );
}

export const calloutVariants = cva(
  "mb-3.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-[1.6] whitespace-pre-line text-heading",
  {
    variants: {
      tone: {
        default: "border-white/12 bg-white/4",
        ok: "border-ok/50 bg-ok/8",
        mid: "border-mid/60 bg-mid/8",
        err: "border-err/60 bg-err/8",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export type CalloutProps = Omit<ComponentProps<"div">, "title"> &
  VariantProps<typeof calloutVariants> & {
    title?: ReactNode;
    /** Knoppen onder de tekst. */
    actions?: ReactNode;
  };

/** Opvallend tekstblok (`.sam` uit aiverslag), bv. een samenvatting of een oproep tot actie. */
export function Callout({ tone, title, actions, className, children, ...props }: CalloutProps) {
  return (
    <div className={cn(calloutVariants({ tone }), className)} {...props}>
      {title && <p className="m-0 mb-1 font-bold">{title}</p>}
      {children}
      {actions && <div className="mt-3 flex flex-wrap gap-2.5 whitespace-normal">{actions}</div>}
    </div>
  );
}
