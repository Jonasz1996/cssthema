import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  to: string;
  emoji: string;
  labelKey: MessageKey;
  /** Extra padvoorvoegsels waarop dit item actief is (bv. de editor hoort bij Thema's). */
  alsoActiveOn?: readonly string[];
}

/**
 * Navigatieknoppen bovenaan de app-kaart. Routes van latere fases (services, discovery, ai,
 * jobs, settings) bestaan wel, maar staan hier (nog) niet in.
 */
export const mainNav: readonly NavItem[] = [
  { to: "/", emoji: "📊", labelKey: "nav.dashboard" },
  { to: "/themes", emoji: "🎨", labelKey: "nav.themes", alsoActiveOn: ["/editor"] },
  { to: "/palettes", emoji: "🖌️", labelKey: "nav.palettes" },
  { to: "/hosts", emoji: "🌐", labelKey: "nav.hosts" },
  { to: "/import", emoji: "📥", labelKey: "nav.import" },
];

function underPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Of een navigatie-item actief is voor dit pad (dashboard alleen exact op `/`). */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  return [item.to, ...(item.alsoActiveOn ?? [])].some((prefix) => underPath(pathname, prefix));
}

/** De editor krijgt bijna de volle breedte en een stilstaande achtergrond (CPU voor Monaco). */
export function isWideRoute(pathname: string): boolean {
  return pathname.startsWith("/editor/");
}
