import { isRouteErrorResponse, useLocation, useRouteError } from "react-router";
import { Button, ButtonLink, PageHeader, Terminal } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isChunkLoadError } from "./stale-chunk";

function technicalText(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

/**
 * Foutscherm van de router (`errorElement`) in de stijl van de app, in plaats van de kale
 * ontwikkelaarsmelding van React Router. Herkent een chunk van een oudere build (de app is
 * bijgewerkt terwijl de tab openstond) en biedt dan "Herladen" aan. Binnen de shell blijven
 * navigatie en terminalbalk staan; `standalone` is voor een fout in de shell zelf.
 */
export function RouteError({ standalone = false }: { standalone?: boolean }) {
  const { t } = useI18n();
  const error = useRouteError();
  const { pathname } = useLocation();
  const stale = isChunkLoadError(error);

  return (
    <section className={cn(standalone && "mx-auto max-w-[980px] px-4 py-10")}>
      <PageHeader
        title={stale ? t("common.staleTitle") : t("common.routeErrorTitle")}
        hint={stale ? t("common.staleHint") : t("common.routeErrorHint")}
      />
      <Terminal
        className="mb-4"
        lines={[
          { kind: "cmd", text: `$ cssthema open ${pathname}` },
          {
            kind: "err",
            text: stale ? t("common.staleError") : t("common.routeErrorLine"),
          },
          { kind: "dim", text: `# ${technicalText(error)}` },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <Button variant="primary" onClick={() => globalThis.location.reload()}>
          {t("common.reload")}
        </Button>
        <ButtonLink to="/">{t("common.notFoundBack")}</ButtonLink>
      </div>
    </section>
  );
}
