import type { RouteObject } from "react-router";
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

/** Route table (docs/04 §2). Kept separate from the router instance so tests can use a memory router. */
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
