import { useSyncExternalStore } from "react";
import { isSessionExpired, subscribeSessionExpired } from "@/api/client";
import { Button, Callout } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

/**
 * Melding in de shell zodra de login van de reverse proxy (Authentik) verlopen is: dan lukt geen
 * enkele call meer tot de pagina opnieuw geladen is (en je opnieuw inlogt). Zonder deze melding
 * leek dat "offline" of "server niet bereikbaar" (review FE-10).
 */
export function SessionExpiredBanner() {
  const { t } = useI18n();
  const expired = useSyncExternalStore(subscribeSessionExpired, isSessionExpired, isSessionExpired);
  if (!expired) return null;
  return (
    <Callout
      tone="err"
      role="alert"
      data-session-expired=""
      className="mb-4"
      title={t("common.sessionExpiredTitle")}
      actions={
        <Button size="sm" onClick={() => window.location.reload()}>
          {t("common.reload")}
        </Button>
      }
    >
      {t("common.sessionExpiredText")}
    </Callout>
  );
}
