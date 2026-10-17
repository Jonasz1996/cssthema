import type { HostHealth } from "@/api/types";
import { Details } from "@/components/ui";
import { formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { healthLabelKey, LEVEL_DOT, missingParts } from "../lib/hosts";

export interface HostStatusProps {
  /** `undefined` zolang de gezondheid laadt (of niet te laden was). */
  health: HostHealth | undefined;
  /** Uit de koppeling zelf (die is na een wissel eerder bij dan de gezondheid). */
  enabled: boolean;
  /** Naam voor de tooltip (`Standaard (*)` voor `*`). */
  name: string;
}

/**
 * Statuscel: gekleurd bolletje met een korte tekst (code van de controle of het niveau). Open
 * geklapt: de uitleg van de server, wat ontbreekt en wanneer een browser de regel laatst laadde.
 */
export function HostStatus({ health, enabled, name }: HostStatusProps) {
  const { t, locale } = useI18n();
  if (!health) return <span className="text-[12px] text-dim">–</span>;

  const lines: string[] = [];
  if (health.excluded) lines.push(t("hosts.excludedLine"));
  if (health.check) {
    lines.push(health.check.detail);
    if (health.check.content_encoding) {
      lines.push(t("hosts.encodingLine", { encoding: health.check.content_encoding }));
    }
    lines.push(
      t("hosts.checkedAgo", { time: formatRelativeTime(health.check.checked_at, locale) }),
    );
  }
  const missing = missingParts(health);
  if (missing.length) lines.push(t("hosts.missing", { names: missing.join(", ") }));
  if (health.stale) lines.push(t("hosts.staleLine"));
  lines.push(
    health.last_seen
      ? t("hosts.lastSeen", { time: formatRelativeTime(health.last_seen, locale) })
      : t("hosts.neverSeen"),
  );

  const off = !enabled && !health.excluded;
  const label = off ? t("hosts.statusOff") : t(healthLabelKey(health));
  const dot = off || health.excluded ? "text-dim" : LEVEL_DOT[health.level];

  return (
    <Details
      className="min-w-[13ch]"
      summary={
        <span
          data-level={health.excluded ? "excluded" : enabled ? health.level : "off"}
          title={`${t("hosts.statusTitle", { host: name })}\n${lines.join("\n")}`}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg"
        >
          <span aria-hidden className={dot}>
            ●
          </span>
          {label}
        </span>
      }
    >
      <ul className="m-0 max-w-[40ch] list-none p-0 pl-1 text-[11.5px] leading-[1.5] text-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Details>
  );
}
