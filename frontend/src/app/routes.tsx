import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router";
import { Loading } from "@/components/ui";
import { AiStudioPage } from "@/features/ai-studio/AiStudioPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DiscoveryPage } from "@/features/discovery/DiscoveryPage";
import { EditorWorkspace } from "@/features/editor/EditorWorkspace";
import { ImportPage } from "@/features/import/ImportPage";
import { JobsPage } from "@/features/jobs/JobsPage";
import { PalettesPage } from "@/features/palettes/PalettesPage";
import { ServicesPage } from "@/features/services/ServicesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ThemesPage } from "@/features/themes/ThemesPage";
import { AppShell } from "./AppShell";
import { NotFoundPage } from "./NotFoundPage";

/**
 * Alleen in de dev-server: overzicht van alle UI-componenten op `/dev/ui`. In een productie-
 * build is `import.meta.env.DEV` false, dus deze tak (en de chunk) valt weg.
 */
function devRoutes(): RouteObject[] {
  if (!import.meta.env.DEV) return [];
  const StyleguidePage = lazy(() =>
    import("@/features/dev/StyleguidePage").then((m) => ({ default: m.StyleguidePage })),
  );
  return [
    {
      path: "dev/ui",
      element: (
        <Suspense fallback={<Loading />}>
          <StyleguidePage />
        </Suspense>
      ),
    },
  ];
}

/** Routetabel (docs/04 §2), los van de router zodat tests een memory-router gebruiken. */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "services", element: <ServicesPage /> },
      { path: "themes", element: <ThemesPage /> },
      { path: "editor/:themeId", element: <EditorWorkspace /> },
      { path: "import", element: <ImportPage /> },
      { path: "discovery", element: <DiscoveryPage /> },
      { path: "ai", element: <AiStudioPage /> },
      { path: "palettes", element: <PalettesPage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "settings", element: <SettingsPage /> },
      ...devRoutes(),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
