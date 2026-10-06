import type { Theme } from "@/api/types";
import type { TagTone } from "@/components/ui";
import type { MessageKey } from "@/lib/i18n";

export interface StatusTag {
  tone: TagTone;
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * Wat er live is, altijd zichtbaar (docs/04 § 1): `v7 live`, `draft gewijzigd`,
 * `nooit gepubliceerd`, `verwijderd`, plus een waarschuwing als een handgemaakt bestand met
 * dezelfde naam voorgaat.
 */
export function themeStatusTags(
  theme: Pick<Theme, "published_version" | "draft_dirty" | "deleted_at" | "shadowed_by_file">,
  { localDirty = false }: { localDirty?: boolean } = {},
): StatusTag[] {
  const tags: StatusTag[] = [];
  if (theme.deleted_at) tags.push({ tone: "err", key: "editor.statusDeleted" });
  if (theme.published_version) {
    tags.push({
      tone: "ok",
      key: "editor.statusLive",
      params: { n: theme.published_version.version_number },
    });
  } else {
    tags.push({ tone: "default", key: "editor.statusNeverPublished" });
  }
  if (theme.published_version && (theme.draft_dirty || localDirty)) {
    tags.push({ tone: "mid", key: "editor.statusDraftChanged" });
  }
  if (theme.shadowed_by_file) tags.push({ tone: "warn", key: "editor.statusShadowed" });
  return tags;
}
