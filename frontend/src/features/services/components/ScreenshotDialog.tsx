import { type CSSProperties, useId, useState } from "react";
import type { ServiceSummary, SnapshotSummary } from "@/api/types";
import { Code, Dialog, type TabItem, TabPanel, Tabs } from "@/components/ui";
import { formatDateTime, formatRelativeTime } from "@/features/themes/lib/format";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  SCREENSHOT_LABELS,
  type ScreenshotKind,
  screenshotsOf,
  snapshotTime,
} from "../lib/services";

export interface ScreenshotTarget {
  service: ServiceSummary;
  snapshot: SnapshotSummary;
  /** De screenshot die eerst getoond wordt (waarop geklikt werd). */
  kind: ScreenshotKind;
}

type View = ScreenshotKind | "side";

const SCREENSHOT_HINTS: Record<ScreenshotKind, MessageKey> = {
  origineel: "services.shotOriginalHint",
  met_thema: "services.shotThemedHint",
  mobiel: "services.shotMobileHint",
};

export interface ScreenshotDialogProps {
  target: ScreenshotTarget | null;
  onClose: () => void;
}

/**
 * Grote weergave van de screenshots van één snapshot: per screenshot een tab (origineel, met
 * thema, mobiel) en, als er meer dan één is, "Naast elkaar".
 */
export function ScreenshotDialog({ target, onClose }: ScreenshotDialogProps) {
  if (!target) return null;
  return <ScreenshotContent key={target.snapshot.id} target={target} onClose={onClose} />;
}

function ScreenshotContent({ target, onClose }: { target: ScreenshotTarget; onClose: () => void }) {
  const { t, locale } = useI18n();
  const id = useId();
  const { service, snapshot } = target;
  const kinds = screenshotsOf(snapshot);
  const [view, setView] = useState<View>(kinds.includes(target.kind) ? target.kind : "side");

  const items: TabItem<View>[] = [
    ...kinds.map((kind) => ({ value: kind, label: t(SCREENSHOT_LABELS[kind]) })),
    ...(kinds.length > 1 ? [{ value: "side" as const, label: t("services.sideBySide") }] : []),
  ];
  const time = snapshotTime(snapshot);
  const description = [
    t("services.pageLabel", { page: snapshot.page }),
    snapshot.title ? `“${snapshot.title}”` : null,
    t(time.captured ? "services.capturedAgo" : "services.importedAgo", {
      time: formatRelativeTime(time.iso, locale),
    }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t("services.shotsTitle", { name: service.name })}
      command={`cssthema services show ${service.slug}`}
      description={<span title={formatDateTime(time.iso, locale)}>{description}</span>}
    >
      <div data-screenshots={snapshot.id}>
        {items.length > 0 && (
          <Tabs
            id={id}
            items={items}
            value={view}
            onValueChange={setView}
            label={t("services.shotsTabs")}
            className="mt-0 mb-2.5"
          />
        )}
        {kinds.map((kind) => (
          <TabPanel key={kind} id={id} value={kind} selected={view}>
            <Shot snapshot={snapshot} kind={kind} name={service.name} />
          </TabPanel>
        ))}
        {kinds.length > 1 && (
          <TabPanel id={id} value="side" selected={view}>
            <SideBySide snapshot={snapshot} kinds={kinds} name={service.name} />
          </TabPanel>
        )}
        {snapshot.theme_links.length > 0 && (
          <p className="m-0 mt-2.5 text-[11.5px] text-dim">
            {t("services.themeLinks")}{" "}
            {snapshot.theme_links.map((link, index) => (
              <span key={link}>
                {index > 0 && ", "}
                <Code>{link}</Code>
              </span>
            ))}
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface ShotProps {
  snapshot: SnapshotSummary;
  kind: ScreenshotKind;
  name: string;
}

function Shot({ snapshot, kind, name }: ShotProps) {
  const { t } = useI18n();
  const url = snapshot.screenshots[kind]!;
  const label = t(SCREENSHOT_LABELS[kind]);
  return (
    <figure className="m-0">
      <div className="max-h-[68vh] overflow-auto rounded-lg border border-white/10 bg-black/40">
        <img
          src={url}
          alt={t("services.shotAlt", { shot: label, name })}
          decoding="async"
          className={cn("block h-auto w-full", kind === "mobiel" && "mx-auto max-w-[390px]")}
        />
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-dim">
        <span>{t(SCREENSHOT_HINTS[kind])}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg underline-offset-2 hover:text-white hover:underline"
        >
          {t("services.openFull")}
          <span aria-hidden> ↗</span>
        </a>
      </figcaption>
    </figure>
  );
}

/** Alle screenshots naast elkaar; mobiel (390 px) krijgt een smallere kolom. */
function SideBySide({
  snapshot,
  kinds,
  name,
}: {
  snapshot: SnapshotSummary;
  kinds: readonly ScreenshotKind[];
  name: string;
}) {
  const { t } = useI18n();
  const columns = kinds
    .map((kind) => (kind === "mobiel" ? "minmax(0,1fr)" : "minmax(0,2fr)"))
    .join(" ");
  return (
    <div
      className="grid gap-3 md:[grid-template-columns:var(--shot-columns)]"
      style={{ "--shot-columns": columns } as CSSProperties}
    >
      {kinds.map((kind) => {
        const label = t(SCREENSHOT_LABELS[kind]);
        return (
          <figure key={kind} className="m-0 min-w-0">
            <figcaption className="mb-1 text-[11.5px] text-dim">{label}</figcaption>
            <div className="max-h-[62vh] overflow-auto rounded-lg border border-white/10 bg-black/40">
              <img
                src={snapshot.screenshots[kind]}
                alt={t("services.shotAlt", { shot: label, name })}
                decoding="async"
                className="block h-auto w-full"
              />
            </div>
          </figure>
        );
      })}
    </div>
  );
}
