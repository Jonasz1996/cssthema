import {
  Briefcase,
  Download,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  PenSquare,
  Search,
  Server,
  Settings,
  Sparkles,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  to: string;
  labelKey: MessageKey;
  icon: LucideIcon;
}

/** Primary sidebar navigation (docs/04 §3.1). */
export const primaryNav: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/services", labelKey: "nav.services", icon: Server },
  { to: "/themes", labelKey: "nav.themes", icon: PenSquare },
  { to: "/import", labelKey: "nav.import", icon: Download },
  { to: "/discovery", labelKey: "nav.discovery", icon: Search },
  { to: "/ai", labelKey: "nav.ai", icon: Sparkles },
  { to: "/palettes", labelKey: "nav.palettes", icon: Palette },
  { to: "/jobs", labelKey: "nav.jobs", icon: Briefcase },
];

/** Pinned to the bottom of the sidebar. */
export const secondaryNav: NavItem[] = [
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];
