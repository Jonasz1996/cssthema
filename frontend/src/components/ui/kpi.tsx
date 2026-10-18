import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Raster van KPI-tegels (`.kgrid`): kolommen van minstens 150 px (twee naast elkaar op een telefoon). */
export function KpiGrid({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "mt-2 mb-0 grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2",
        className,
      )}
      {...props}
    />
  );
}

export type KpiTone = "default" | "ok" | "mid" | "bad";

export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  /** Kleine toelichting onder de waarde. */
  sub?: ReactNode;
  /** `ok` = groene waarde, `mid` = oranje, `bad` = rode rand en waarde. */
  tone?: KpiTone;
  className?: string;
}

const valueTone: Record<KpiTone, string> = {
  default: "text-heading",
  ok: "text-ok",
  mid: "text-mid",
  bad: "text-err",
};

/** Eén KPI-tegel (`.kpi`): label, grote waarde, optionele toelichting. */
export function Kpi({ label, value, sub, tone = "default", className }: KpiProps) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[10px] border border-line bg-white/5 px-3 py-2.5",
        tone === "bad" && "border-err",
        className,
      )}
    >
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="m-0">
        <b className={cn("mt-0.5 block text-lg tabular-nums", valueTone[tone])}>{value}</b>
        {sub && <small className="block text-[11.5px] text-muted">{sub}</small>}
      </dd>
    </div>
  );
}
