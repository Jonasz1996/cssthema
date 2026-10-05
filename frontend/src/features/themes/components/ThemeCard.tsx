import { useId, useState } from "react";
import { useNavigate } from "react-router";
import type { Palette, Theme } from "@/api/types";
import { Button, ButtonLink, Tag } from "@/components/ui";
import { itemRowVariants } from "@/components/ui/item-row";
import { PaletteSwatches } from "@/features/palettes/components/PaletteSwatches";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { editorPath, type ThemeAction } from "../lib/actions";
import { formatBytes, formatDateTime, formatRelativeTime } from "../lib/format";
import { isDeleted, themeSeverity } from "../lib/status";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { ThemeStatusTags } from "./ThemeStatusTags";

export interface ThemeCardProps {
  theme: Theme;
  /** Het gekoppelde palet (als het geladen is). */
  palette?: Palette | null;
  /** Er loopt een actie op dit thema: knoppen uit. */
  busy?: boolean;
  onAction: (action: ThemeAction, theme: Theme, card: HTMLElement | null) => void;
}

/**
 * Kaart in de themabrowser (docs/04 § 3.5, zonder screenshot): naam, URL, status-badges,
 * palet, laatste wijziging en grootte, met `Openen` en een actiemenu (`⋯`).
 */
export function ThemeCard({ theme, palette, busy = false, onAction }: ThemeCardProps) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  // Het element zelf (voor de effecten bij verwijderen/herstellen), als state zodat de
  // handlers het mogen gebruiken.
  const [card, setCard] = useState<HTMLElement | null>(null);
  const titleId = useId();
  const deleted = isDeleted(theme);
  const run = (action: ThemeAction) => () => onAction(action, theme, card);

  const items: ActionMenuItem[] = deleted
    ? [
        { id: "restore", label: `↺ ${t("themes.actionRestore")}`, onSelect: run("restore") },
        {
          id: "purge",
          label: `✕ ${t("themes.actionPurge")}`,
          onSelect: run("purge"),
          tone: "danger",
        },
      ]
    : [
        {
          id: "open",
          label: `✎ ${t("themes.actionOpen")}`,
          onSelect: () => navigate(editorPath(theme.id)),
        },
        { id: "duplicate", label: `⧉ ${t("themes.actionDuplicate")}`, onSelect: run("duplicate") },
        {
          id: "export-css",
          label: `⤓ ${t("themes.actionExportCss")}`,
          onSelect: run("export-css"),
          disabled: !theme.published_version,
          hint: theme.published_version ? undefined : t("themes.exportCssNeedsLive"),
        },
        {
          id: "export-bundle",
          label: `⤓ ${t("themes.actionExportBundle")}`,
          onSelect: run("export-bundle"),
        },
        { id: "copy-url", label: `🔗 ${t("themes.actionCopyUrl")}`, onSelect: run("copy-url") },
        {
          id: "delete",
          label: `⚡ ${t("themes.actionDelete")}`,
          onSelect: run("delete"),
          tone: "danger",
        },
      ];

  const updated = theme.draft_updated_at ?? theme.updated_at;

  return (
    <article
      ref={setCard}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-theme-card={theme.slug}
      className={cn(
        itemRowVariants({ severity: themeSeverity(theme) }),
        "mb-0 flex h-full min-w-0 flex-col py-3",
        deleted && "opacity-80",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="m-0 text-[14px] leading-snug font-bold break-words text-heading"
          >
            {theme.name}
          </h3>
          <p className="m-0 mt-0.5 truncate text-[12px] text-code" title={theme.public_url}>
            /{theme.slug}.css
          </p>
        </div>
        <ActionMenu
          label={t("themes.actionsFor", { name: theme.name })}
          items={items}
          disabled={busy}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <ThemeStatusTags theme={theme} />
        {theme.tags.map((tag) => (
          <Tag key={tag}>#{tag}</Tag>
        ))}
      </div>

      {theme.shadowed_by_file && !deleted && (
        <p className="m-0 mt-2 text-[12px] leading-[1.5] text-err">
          <span aria-hidden>⚠ </span>
          {t("themes.shadowedNote", { file: `${theme.slug}.css` })}
        </p>
      )}
      {theme.description && (
        <p className="m-0 mt-2 line-clamp-2 text-[12.5px] leading-[1.5] text-body">
          {theme.description}
        </p>
      )}

      <p className="m-0 mt-2 flex min-w-0 items-center gap-2 text-[12px] text-muted">
        <PaletteSwatches palette={theme.palette_id ? palette : null} />
        <span className="truncate">
          {theme.palette_id ? (palette?.name ?? t("themes.paletteUnknown")) : t("themes.noPalette")}
        </span>
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11.5px] text-dim">
        <span className="min-w-0 truncate">
          {deleted && theme.deleted_at ? (
            <time dateTime={theme.deleted_at} title={formatDateTime(theme.deleted_at, locale)}>
              {t("themes.deletedAgo", { time: formatRelativeTime(theme.deleted_at, locale) })}
            </time>
          ) : (
            <time dateTime={updated} title={formatDateTime(updated, locale)}>
              {t("themes.updatedAgo", { time: formatRelativeTime(updated, locale) })}
            </time>
          )}
          {" · "}
          {formatBytes(theme.draft_size_bytes, locale)}
        </span>
        {deleted ? (
          <Button
            variant="mini"
            className="flex-none"
            onClick={run("restore")}
            disabled={busy}
            aria-label={t("themes.restoreNamed", { name: theme.name })}
          >
            ↺ {t("themes.actionRestore")}
          </Button>
        ) : (
          <ButtonLink
            variant="mini"
            className="flex-none"
            to={editorPath(theme.id)}
            aria-label={t("themes.openNamed", { name: theme.name })}
          >
            ✎ {t("themes.actionOpen")}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}
