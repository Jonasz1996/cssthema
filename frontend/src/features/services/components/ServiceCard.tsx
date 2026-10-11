import { useId, useState } from "react";
import type { ServiceSummary, SnapshotSummary } from "@/api/types";
import { Button, Code, Details, Tag, type TagTone } from "@/components/ui";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  hasDocument,
  safeHttpUrl,
  SCREENSHOT_LABELS,
  type ScreenshotKind,
  screenshotsOf,
  snapshotTime,
  statusTone,
} from "../lib/services";
import type { ScreenshotTarget } from "./ScreenshotDialog";
import { SnapshotStatus } from "./SnapshotStatus";

/** Linkerrand van de kaart in de kleur van de status van de laatste snapshot. */
const BORDER: Record<TagTone, string> = {
  default: "border-l-[#666]",
  ok: "border-l-ok",
  mid: "border-l-mid",
  warn: "border-l-err",
  err: "border-l-err",
};

/** De twee screenshots op de kaart; mobiel staat in de grote weergave. */
const THUMB_KINDS: readonly ScreenshotKind[] = ["origineel", "met_thema"];

export interface ServiceCardProps {
  service: ServiceSummary;
  onZoom: (target: ScreenshotTarget) => void;
  onDelete: (service: ServiceSummary) => void;
}

/**
 * Eén service: naam, hostnaam (link naar de app), status van de laatste snapshot, frameworks,
 * wanneer vastgelegd en de screenshots origineel en met thema (klik = groot). Heeft de service
 * meer pagina's, dan staan die compact in een uitklapper.
 */
export function ServiceCard({ service, onZoom, onDelete }: ServiceCardProps) {
  const { t, tc, locale } = useI18n();
  const titleId = useId();
  const latest = service.snapshots[0];
  const link = safeHttpUrl(service.base_url);
  const withDocument = hasDocument(service);
  const time = latest ? snapshotTime(latest) : null;

  const meta = [
    latest?.title ? `“${latest.title}”` : null,
    latest ? tc("services.classCount", latest.class_count) : null,
  ].filter((part): part is string => part !== null);

  return (
    <article
      aria-labelledby={titleId}
      data-service={service.slug}
      className={cn(
        "rounded-lg border border-white/6 border-l-[3px] bg-white/5 px-3.5 py-3",
        "transition-[background-color,border-color] duration-200 hover:border-white/18 hover:bg-white/8",
        BORDER[statusTone(latest?.status)],
      )}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        <div className="min-w-[min(100%,30ch)] flex-1">
          <h3 id={titleId} className="m-0 text-[13.5px] font-bold break-words text-heading">
            {service.name}
          </h3>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title={link}
              className="text-[12px] break-all text-code underline-offset-2 hover:underline"
            >
              {service.hostname}
              <span aria-hidden> ↗</span>
              <span className="sr-only"> ({t("services.newTab")})</span>
            </a>
          ) : (
            <span className="text-[12px] break-all text-muted">{service.hostname}</span>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {latest ? (
              <SnapshotStatus status={latest.status} />
            ) : (
              <Tag>{t("services.noSnapshots")}</Tag>
            )}
            {latest && !withDocument && (
              <Tag tone="mid" title={t("services.noDocumentHint")}>
                {t("services.noDocumentTag")}
              </Tag>
            )}
            {latest?.has_shadow_dom && <Tag title={t("services.shadowDomHint")}>shadow DOM</Tag>}
            {latest && latest.csp_errors > 0 && (
              <Tag tone="warn" title={t("services.cspErrorsHint")}>
                {tc("services.cspErrors", latest.csp_errors)}
              </Tag>
            )}
          </div>

          {latest && latest.frameworks.length > 0 && (
            <ul
              aria-label={t("services.frameworks")}
              className="m-0 mt-1.5 flex list-none flex-wrap gap-1 p-0"
            >
              {latest.frameworks.map((framework) => (
                <li key={framework}>
                  <Tag className="text-code">{framework}</Tag>
                </li>
              ))}
            </ul>
          )}

          {time && (
            <p className="m-0 mt-2 text-[11.5px] leading-[1.5] text-dim">
              <time dateTime={time.iso} title={formatDateTime(time.iso, locale)}>
                {t(time.captured ? "services.capturedAgo" : "services.importedAgo", {
                  time: formatRelativeTime(time.iso, locale),
                })}
              </time>
              {meta.map((part) => (
                <span key={part}> · {part}</span>
              ))}
            </p>
          )}
        </div>

        {latest && <Thumbnails service={service} snapshot={latest} onZoom={onZoom} />}
      </div>

      {service.snapshots.length > 1 && <SnapshotList service={service} onZoom={onZoom} />}

      <div className="mt-2 flex justify-end">
        <Button
          variant="mini"
          tone="danger"
          aria-label={t("services.deleteNamed", { name: service.name })}
          onClick={() => onDelete(service)}
        >
          ✕ {t("services.delete")}
        </Button>
      </div>
    </article>
  );
}

interface ThumbnailsProps {
  service: ServiceSummary;
  snapshot: SnapshotSummary;
  onZoom: (target: ScreenshotTarget) => void;
}

function Thumbnails({ service, snapshot, onZoom }: ThumbnailsProps) {
  const { t } = useI18n();
  const available = screenshotsOf(snapshot);
  if (!available.length) {
    return (
      <p className="m-0 flex h-[93px] w-[148px] items-center justify-center rounded-md border border-dashed border-white/15 px-2 text-center text-[11.5px] text-dim">
        {t("services.noShots")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {THUMB_KINDS.map((kind) => (
        <Thumbnail
          key={kind}
          kind={kind}
          url={snapshot.screenshots[kind]}
          name={service.name}
          onOpen={() => onZoom({ service, snapshot, kind })}
        />
      ))}
    </div>
  );
}

interface ThumbnailProps {
  kind: ScreenshotKind;
  url: string | undefined;
  name: string;
  onOpen: () => void;
}

function Thumbnail({ kind, url, name, onOpen }: ThumbnailProps) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const label = t(SCREENSHOT_LABELS[kind]);
  return (
    <figure className="m-0 w-[148px]">
      {url && !broken ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t("services.zoomNamed", { shot: label, name })}
          data-thumb={kind}
          className={cn(
            "block w-full overflow-hidden rounded-md border border-white/12 bg-black/30",
            "transition-[border-color,transform] duration-200 hover:border-white/40 active:scale-[.98]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
          )}
        >
          <img
            src={url}
            alt={t("services.shotAlt", { shot: label, name })}
            loading="lazy"
            decoding="async"
            width={148}
            height={93}
            onError={() => setBroken(true)}
            className="block aspect-[16/10] h-auto w-full object-cover object-top"
          />
        </button>
      ) : (
        <span className="flex aspect-[16/10] w-full items-center justify-center rounded-md border border-dashed border-white/15 px-1.5 text-center text-[11px] text-dim">
          {broken ? t("services.shotBroken") : t("services.shotMissing")}
        </span>
      )}
      <figcaption className="mt-1 text-center text-[11px] text-dim">{label}</figcaption>
    </figure>
  );
}

/** Alle pagina's van de service, compact: pagina, status, titel, tijd en een knop voor de screenshots. */
function SnapshotList({
  service,
  onZoom,
}: {
  service: ServiceSummary;
  onZoom: (target: ScreenshotTarget) => void;
}) {
  const { t, tc, locale } = useI18n();
  return (
    <Details summary={tc("services.pages", service.snapshots.length)} className="mt-2">
      <ul className="m-0 list-none p-0">
        {service.snapshots.map((snapshot) => {
          const time = snapshotTime(snapshot);
          const [first] = screenshotsOf(snapshot);
          return (
            <li
              key={snapshot.id}
              data-snapshot={snapshot.page}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/6 py-1.5 text-[12px]"
            >
              <Code>{snapshot.page}</Code>
              <SnapshotStatus status={snapshot.status} />
              {!snapshot.has_document && (
                <Tag tone="mid" title={t("services.noDocumentHint")}>
                  {t("services.noDocumentTag")}
                </Tag>
              )}
              {snapshot.title && (
                <span className="min-w-0 flex-1 truncate text-muted" title={snapshot.title}>
                  {snapshot.title}
                </span>
              )}
              <time
                dateTime={time.iso}
                title={formatDateTime(time.iso, locale)}
                className="ml-auto text-[11.5px] text-dim"
              >
                {formatRelativeTime(time.iso, locale)}
              </time>
              {first && (
                <Button
                  variant="mini"
                  aria-label={t("services.showShotsNamed", {
                    page: snapshot.page,
                    name: service.name,
                  })}
                  onClick={() => onZoom({ service, snapshot, kind: first })}
                >
                  {t("services.showShots")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Details>
  );
}
