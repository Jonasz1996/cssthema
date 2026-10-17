import { useId } from "react";
import { useForgetAllSeenHosts, useForgetSeenHost, useHostHealth } from "@/api/queries/hosts";
import type { HostHealth } from "@/api/types";
import { Button, ItemRow, type ItemSeverity, Tag, toast } from "@/components/ui";
import { errorText } from "@/features/themes/lib/errors";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { HOST_ERROR_KEYS, unboundHosts } from "../lib/hosts";
import { HostStatus } from "./HostStatus";

export interface UnboundHostsProps {
  /** "Koppeling maken": opent de dialoog met deze hostnaam. */
  onBind: (hostname: string) => void;
}

const SEVERITY: Record<HostHealth["level"], ItemSeverity> = {
  ok: "ok",
  warn: "mid",
  error: "err",
  unknown: "default",
};

/**
 * Hosts zonder eigen koppeling (ze volgen `*`): wat `/host/<host>.css` laadde, en geïmporteerde
 * diensten (die worden ook gecontroleerd, met hun status erbij). Verborgen als er geen zijn.
 */
export function UnboundHosts({ onBind }: UnboundHostsProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const titleId = useId();
  const health = useHostHealth();
  const forget = useForgetSeenHost();
  const forgetAll = useForgetAllSeenHosts();
  const hosts = unboundHosts(health.data?.hosts);
  if (!hosts.length) return null;

  const onForget = (hostname: string) =>
    forget.mutate(hostname, {
      onSuccess: () => toast.ok(t("hosts.forgotten", { host: hostname })),
      onError: (error) => toast.err(errorText(error, i18n, HOST_ERROR_KEYS)),
    });

  const onForgetAll = () =>
    forgetAll.mutate(undefined, {
      onSuccess: () => toast.ok(t("hosts.forgetAllDone")),
      onError: (error) => toast.err(errorText(error, i18n, HOST_ERROR_KEYS)),
    });

  const anySeen = hosts.some((host) => host.last_seen && !host.service);

  return (
    <section aria-labelledby={titleId} className="mt-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="m-0 text-[13px] font-bold text-heading">
          {t("hosts.unboundTitle")}
        </h2>
        {anySeen && (
          <Button
            variant="mini"
            tone="danger"
            onClick={onForgetAll}
            disabled={forgetAll.isPending}
            aria-busy={forgetAll.isPending || undefined}
          >
            {t("hosts.forgetAll")}
          </Button>
        )}
      </div>
      <p className="mt-0 mb-2 max-w-[90ch] text-[12px] text-muted">{t("hosts.unboundText")}</p>
      <ul className="m-0 max-w-[90ch] list-none p-0">
        {hosts.map((host) => (
          <li key={host.hostname}>
            <ItemRow
              severity={host.check ? SEVERITY[host.level] : "mid"}
              title={host.hostname}
              tags={
                <>
                  {host.service && <Tag>{t("hosts.serviceTag")}</Tag>}
                  {host.check && <HostStatus health={host} enabled name={host.hostname} />}
                </>
              }
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
                  {host.last_seen && !host.service && (
                    <Button
                      variant="mini"
                      tone="danger"
                      aria-label={t("hosts.forgetNamed", { host: host.hostname })}
                      disabled={forget.isPending && forget.variables === host.hostname}
                      onClick={() => onForget(host.hostname)}
                    >
                      {t("hosts.forget")}
                    </Button>
                  )}
                </>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
