import type { ItemSeverity, TagTone } from "@/components/ui";
import type { Theme } from "@/api/types";

/**
 * Status-badges van een thema, overal hetzelfde (docs/04 § 1: "altijd zichtbaar wat live is"):
 * `v7 live` · `draft gewijzigd` · `nooit gepubliceerd` · `verwijderd`, plus de waarschuwing dat
 * een handgemaakt bestand voorgaat (`shadowed_by_file`).
 */

export type ThemeBadgeKind = "deleted" | "live" | "dirty" | "never" | "archived" | "shadowed";

export interface ThemeBadge {
  kind: ThemeBadgeKind;
  tone: TagTone;
  /** Versienummer bij `live`. */
  version?: number;
}

type BadgeSource = Pick<
  Theme,
  "deleted_at" | "status" | "published_version" | "draft_dirty" | "shadowed_by_file"
>;

export function isDeleted(theme: Pick<Theme, "deleted_at">): boolean {
  return Boolean(theme.deleted_at);
}

export function themeBadges(theme: BadgeSource): ThemeBadge[] {
  if (isDeleted(theme)) return [{ kind: "deleted", tone: "err" }];
  const badges: ThemeBadge[] = [];
  const live = theme.published_version;
  if (live) {
    badges.push({ kind: "live", tone: "ok", version: live.version_number });
    if (theme.draft_dirty) badges.push({ kind: "dirty", tone: "mid" });
  } else {
    badges.push({ kind: "never", tone: "default" });
  }
  if (theme.status === "archived") badges.push({ kind: "archived", tone: "default" });
  if (theme.shadowed_by_file) badges.push({ kind: "shadowed", tone: "warn" });
  return badges;
}

/** Kleur van de linkerrand: verwijderd rood, draft gewijzigd oranje, live groen, anders grijs. */
export function themeSeverity(theme: BadgeSource): ItemSeverity {
  if (isDeleted(theme)) return "err";
  if (theme.published_version) return theme.draft_dirty ? "mid" : "ok";
  return "default";
}
