import type { Theme } from "@/api/types";
import { Tag } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { themeBadges, type ThemeBadge } from "../lib/status";

type TagSource = Pick<
  Theme,
  "slug" | "deleted_at" | "status" | "published_version" | "draft_dirty" | "shadowed_by_file"
>;

/** Status-badges van een thema: `v7 live`, `draft gewijzigd`, `nooit gepubliceerd`, … */
export function ThemeStatusTags({ theme }: { theme: TagSource }) {
  const { t } = useI18n();
  const label = (badge: ThemeBadge): string => {
    switch (badge.kind) {
      case "live":
        return t("themes.badgeLive", { version: badge.version ?? 0 });
      case "dirty":
        return t("themes.badgeDirty");
      case "never":
        return t("themes.badgeNever");
      case "deleted":
        return t("themes.badgeDeleted");
      case "archived":
        return t("themes.badgeArchived");
      case "shadowed":
        return t("themes.badgeShadowed");
    }
  };
  return (
    <>
      {themeBadges(theme).map((badge) => (
        <Tag
          key={badge.kind}
          tone={badge.tone}
          data-badge={badge.kind}
          title={
            badge.kind === "shadowed"
              ? t("themes.shadowedNote", { file: `${theme.slug}.css` })
              : undefined
          }
        >
          {label(badge)}
        </Tag>
      ))}
    </>
  );
}
