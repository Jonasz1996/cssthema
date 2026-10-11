import { useId } from "react";
import { useForgetSeenHost, useHostHealth } from "@/api/queries/hosts";
import { Button, ItemRow, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { HOST_ERROR_KEYS, unboundHosts } from "../lib/hosts";

export interface UnboundHostsProps {
  /** "Koppeling maken": opent de dialoog met deze hostnaam. */
  onBind: (hostname: string) => void;
}

/**
 * Hosts die `/host/<host>.css` laadden zonder eigen koppeling (ze volgen `*`). Verborgen als er
 * geen zijn.
 */
export function UnboundHosts({ onBind }: UnboundHostsProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const titleId = useId();
  const health = useHostHealth();
  const forget = useForgetSeenHost();
  const hosts = unboundHosts(health.data?.hosts);
  if (!hosts.length) return null;

  const onForget = (hostname: string) =>
    forget.mutate(hostname, {
      onSuccess: () => toast.ok(t("hosts.forgotten", { host: hostname })),
      onError: (error) => toast.err(errorText(error, i18n, HOST_ERROR_KEYS)),
    });

  return (
    <section aria-labelledby={titleId} className="mt-6">
      <h2 id={titleId} className="m-0 mb-1 text-[13px] font-bold text-heading">
        {t("hosts.unboundTitle")}
      </h2>
      <p className="mt-0 mb-2 text-[12px] text-muted">{t("hosts.unboundText")}</p>
      <ul className="m-0 max-w-[90ch] list-none p-0">
        {hosts.map((host) => (
          <li key={host.hostname}>
            <ItemRow
              severity="mid"
              title={host.hostname}
              meta={
                host.last_seen ? (
                  <time dateTime={host.last_seen} title={formatDateTime(host.last_seen, locale)}>
                    {t("hosts.lastSeen", { time: formatRelativeTime(host.last_seen, locale) })}
                  </time>
                ) : (
                  t("hosts.neverSeen")
                )
              }
              actions={
                <>
                  <Button
                    variant="mini"
                    aria-label={t("hosts.bindNamed", { host: host.hostname })}
                    onClick={() => onBind(host.hostname)}
                  >
                    + {t("hosts.bind")}
                  </Button>
                  <Button
                    variant="mini"
                    tone="danger"
                    aria-label={t("hosts.forgetNamed", { host: host.hostname })}
                    disabled={forget.isPending && forget.variables === host.hostname}
                    onClick={() => onForget(host.hostname)}
                  >
                    {t("hosts.forget")}
                  </Button>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
