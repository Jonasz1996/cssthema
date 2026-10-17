import { ButtonLink, Callout, Category } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/**
 * "In een app laden (NPM)": verwijst naar de regel op de pagina Hosts (één regel voor elke proxy
 * host, met `$host`) in plaats van de oude snippet met een eigen `location /` (FE-5, ROLL-7), plus
 * de waarschuwing dat een script in de app zelf draait.
 */
export function HostsRuleHint() {
  const { t } = useI18n();
  return (
    <Category title={t("import.snippetTitle")} storageKey="import.snippet" className="mt-5">
      <div data-hosts-rule-hint="" className="px-1 pt-1">
        <p className="m-0 mb-2.5 max-w-[80ch] text-[12.5px] leading-[1.6] text-muted">
          {t("import.snippetText")}
        </p>
        <ButtonLink to="/hosts" size="sm">
          {t("import.snippetHostsLink")} →
        </ButtonLink>
        <Callout tone="mid" title={`⚠ ${t("import.scriptWarningTitle")}`} className="mt-3.5 mb-1">
          {t("import.scriptWarning")}
        </Callout>
      </div>
    </Category>
  );
}
