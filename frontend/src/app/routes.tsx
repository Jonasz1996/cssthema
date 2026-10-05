import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router";
import { Loading } from "@/components/ui";
import { AiStudioPage } from "@/features/ai-studio/AiStudioPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DiscoveryPage } from "@/features/discovery/DiscoveryPage";
import { ImportPage } from "@/features/import/ImportPage";
import { JobsPage } from "@/features/jobs/JobsPage";
import { PalettesPage } from "@/features/palettes/PalettesPage";
import { ServicesPage } from "@/features/services/ServicesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { ThemesPage } from "@/features/themes/ThemesPage";
import { AppShell } from "./AppShell";
import { NotFoundPage } from "./NotFoundPage";
import { RouteError } from "./RouteError";

/**
 * Editor en versies: lazy, zodat Monaco (enkele MB) alleen op deze routes geladen wordt en niet
 * in de hoofdbundel zit. De shell blijft staan; tijdens het laden toont de pagina "Laden…".
 */
function editorRoutes(): RouteObject[] {
  const EditorPage = lazy(() =>
    import("@/features/editor/EditorPage").then((m) => ({ default: m.EditorPage })),
  );
  const VersionsPage = lazy(() =>
    import("@/features/versions/VersionsPage").then((m) => ({ default: m.VersionsPage })),
  );
  return [
    {
      path: "editor/:themeId",
      element: (
        <Suspense fallback={<Loading />}>
          <EditorPage />
        </Suspense>
      ),
    },
    {
      path: "editor/:themeId/versions",
      element: (
        <Suspense fallback={<Loading />}>
          <VersionsPage />
        </Suspense>
      ),
    },
  ];
}

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

/**
 * Routetabel (docs/04 §2), los van de router zodat tests een memory-router gebruiken.
 *
 * Fouten tijdens het renderen (bv. een lazy chunk van een oudere build die niet meer bestaat)
 * vangt `RouteError` op: voor de pagina's binnen de shell (navigatie blijft staan) via de
 * padloze tussenroute, en voor een fout in de shell zelf op de bovenste route.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteError standalone />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "services", element: <ServicesPage /> },
          { path: "themes", element: <ThemesPage /> },
          ...editorRoutes(),
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
    ],
  },
];
