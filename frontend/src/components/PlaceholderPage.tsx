import type { ReactNode } from "react";
import { Callout, PageHeader } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export interface PlaceholderPageProps {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}

/** Pagina voor een scherm dat in een volgende versie komt: titel, hint en een melding. */
export function PlaceholderPage({ title, hint, children }: PlaceholderPageProps) {
  const { t } = useI18n();
  return (
    <section>
      <PageHeader title={title} hint={hint} />
      <Callout>
        <span aria-hidden>🚧 </span>
        {t("common.comingLater")}
      </Callout>
      {children}
    </section>
  );
}
