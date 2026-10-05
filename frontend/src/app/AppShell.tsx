import { Moon, Sun } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { type NavItem, primaryNav, secondaryNav } from "./nav";
import { useUiStore } from "./ui-store";

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          isActive && "bg-accent-muted text-foreground",
        )
      }
    >
      <Icon className="size-4" aria-hidden />
      <span>{t(item.labelKey)}</span>
    </NavLink>
  );
}

function Header() {
  const colorMode = useUiStore((s) => s.colorMode);
  const toggleColorMode = useUiStore((s) => s.toggleColorMode);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-panel px-4">
      <div className="flex w-52 items-center gap-2 font-semibold">
        <span className="text-accent" aria-hidden>
          ◆
        </span>
        {t("app.name")}
      </div>
      {/* Placeholder: the command palette arrives in a later phase. */}
      <button
        type="button"
        className="flex h-9 w-full max-w-md items-center justify-between rounded-md border border-border bg-background px-3 text-sm text-muted-foreground hover:border-input"
        aria-label={t("app.search")}
      >
        <span>{t("app.search")}</span>
        <kbd className="rounded border border-border px-1.5 font-mono text-xs">⌘K</kbd>
      </button>
      <div className="ml-auto">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleColorMode}
          aria-label={t("app.toggleTheme")}
          title={t("app.toggleTheme")}
        >
          {colorMode === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Main"
          className="flex w-56 shrink-0 flex-col justify-between border-r border-border bg-panel p-2"
        >
          <ul className="flex flex-col gap-0.5">
            {primaryNav.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-0.5 border-t border-border pt-2">
            {secondaryNav.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} />
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
