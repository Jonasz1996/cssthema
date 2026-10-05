import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { BackgroundCanvas } from "@/components/BackgroundCanvas";
import { ButtonLink, Card, CardBody, TerminalBar, Toaster } from "@/components/ui";
import { SHAKE_TARGET_ID } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import type { NetworkMode } from "@/lib/particles";
import { isNavItemActive, isWideRoute, mainNav } from "./nav";
import { routeCommand } from "./shell-command";
import { BackgroundToggle, LanguageToggle, SystemStatus } from "./ShellControls";
import { useUiStore } from "./ui-store";

function MainNav({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("nav.label")} className="min-w-0">
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
        {mainNav.map((item) => (
          <li key={item.to}>
            <ButtonLink to={item.to} active={isNavItemActive(item, pathname)}>
              <span aria-hidden>{item.emoji}</span>
              {t(item.labelKey)}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * App-shell zoals aiverslag: één gecentreerde glazen kaart met terminalbalk, daaronder de
 * navigatieknoppen met rechts systeemstatus, achtergrond- en taalschakelaar, en de pagina.
 */
export function AppShell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const wide = isWideRoute(pathname);
  const reducedMotion = useReducedMotion();
  const backgroundEnabled = useUiStore((state) => state.backgroundEnabled);
  const commandOverride = useUiStore((state) => state.commandOverride);
  const mode: NetworkMode =
    !backgroundEnabled || reducedMotion ? "off" : wide ? "paused" : "running";

  return (
    <div className="ui-stage">
      <BackgroundCanvas mode={mode} />
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only rounded-[10px] bg-btn px-4 py-2 font-bold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90]"
      >
        {t("common.skipToContent")}
      </a>
      <div id={SHAKE_TARGET_ID} className="ui-wrap" data-wide={wide}>
        <Card>
          <TerminalBar command={commandOverride ?? routeCommand(pathname)} />
          <CardBody>
            <header className="mb-[22px] flex flex-wrap items-center gap-x-2.5 gap-y-3 border-b border-line pb-[18px]">
              <MainNav pathname={pathname} />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <SystemStatus />
                <BackgroundToggle />
                <LanguageToggle />
              </div>
            </header>
            <main id="main" tabIndex={-1} className="min-w-0 outline-none">
              <Outlet />
            </main>
          </CardBody>
        </Card>
      </div>
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
