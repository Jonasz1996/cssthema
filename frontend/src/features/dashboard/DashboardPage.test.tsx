import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, problem } from "@/api/testing/fetch-mock";
import { makeDashboard, makeTheme, makeVersionSummary, testId } from "@/api/testing/fixtures";
import { createServer, currentUrl, renderPage } from "@/features/themes/testing";
import { setLocale } from "@/lib/i18n";
import { DashboardPage } from "./DashboardPage";

/** De KPI-tegel met dit label (`<dt>`), om erbinnen te zoeken. */
function kpi(label: string) {
  const tile = screen.getByText(label, { selector: "dt" }).closest("div");
  if (!tile) throw new Error(`geen KPI ${label}`);
  return within(tile);
}

const recent = [
  makeTheme({
    id: testId(1),
    slug: "proxmox",
    name: "Proxmox",
    status: "published",
    published_version: makeVersionSummary({ version_number: 4 }),
    draft_dirty: true,
  }),
  makeTheme({ id: testId(2), slug: "grafana", name: "Grafana" }),
];

describe("DashboardPage", () => {
  it("toont vier KPI's met links naar de gefilterde themalijst", async () => {
    const server = createServer().on("GET", "/api/v1/dashboard", () =>
      json(
        makeDashboard({
          themes_total: 12,
          themes_published: 8,
          themes_draft_dirty: 3,
          themes_deleted: 2,
          palettes_total: 7,
          recent,
        }),
      ),
    );
    renderPage(<DashboardPage />, { server });
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(kpi("Thema's").getByRole("link", { name: "2 verwijderd" })).toHaveAttribute(
      "href",
      "/themes?status=deleted",
    );
    expect(kpi("Thema's").getByRole("link", { name: /bekijken/ })).toHaveAttribute(
      "href",
      "/themes",
    );
    expect(kpi("Gepubliceerd").getByText("8")).toBeInTheDocument();
    expect(kpi("Gepubliceerd").getByRole("link")).toHaveAttribute("href", "/themes?status=live");
    expect(kpi("Draft gewijzigd").getByText("3")).toBeInTheDocument();
    expect(kpi("Draft gewijzigd").getByRole("link")).toHaveAttribute(
      "href",
      "/themes?status=dirty",
    );
    expect(kpi("Paletten").getByText("7")).toBeInTheDocument();
  });

  it("toont '—' zolang de cijfers er niet zijn", () => {
    renderPage(<DashboardPage />);
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("toont recent gewijzigde thema's met status en een link naar de editor", async () => {
    const server = createServer().on("GET", "/api/v1/dashboard", () =>
      json(makeDashboard({ themes_total: 2, recent })),
    );
    const { router } = renderPage(<DashboardPage />, { server });
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-recent="proxmox"]');
      if (!el) throw new Error("nog niet");
      return within(el);
    });
    expect(row.getByText("v4 live")).toBeInTheDocument();
    expect(row.getByText("draft gewijzigd")).toBeInTheDocument();
    expect(row.getByText("/proxmox.css")).toBeInTheDocument();
    fireEvent.click(row.getByRole("link", { name: "Proxmox openen in de editor" }));
    expect(await screen.findByTestId("editor-stub")).toHaveTextContent(testId(1));
    expect(currentUrl(router)).toBe(`/editor/${testId(1)}`);
  });

  it("zonder thema's: uitnodiging", async () => {
    renderPage(<DashboardPage />);
    expect(
      await screen.findByText("Nog geen thema's. Maak er een of importeer je CSS-bestanden."),
    ).toBeInTheDocument();
  });

  it("meldt importeerbare handgemaakte CSS-bestanden", async () => {
    const server = createServer().on("GET", "/api/v1/dashboard", () =>
      json(
        makeDashboard({
          local_files: { dir: "/srv/css-files", total: 4, importable: 3 },
        }),
      ),
    );
    renderPage(<DashboardPage />, { server });
    await screen.findByText("📂 3 handgemaakte CSS-bestanden gevonden");
    const callout = within(document.querySelector<HTMLElement>("[data-local-files-callout]")!);
    expect(callout.getByText(/uit \/srv\/css-files\./)).toBeInTheDocument();
    expect(callout.getByRole("link", { name: "Importeren" })).toHaveAttribute("href", "/import");

    const row = within(document.querySelector<HTMLElement>("[data-local-files]")!);
    expect(row.getByText("4 bestanden")).toBeInTheDocument();
    expect(row.getByText("3 importeerbaar")).toBeInTheDocument();
  });

  it("zonder importeerbare bestanden geen melding", async () => {
    const server = createServer().on("GET", "/api/v1/dashboard", () =>
      json(makeDashboard({ local_files: { dir: "/srv", total: 1, importable: 0 } })),
    );
    renderPage(<DashboardPage />, { server });
    await waitFor(() => expect(document.querySelector("[data-local-files]")).not.toBeNull());
    expect(document.querySelector("[data-local-files-callout]")).toBeNull();
  });

  it("toont de systeemstatus", async () => {
    const server = createServer().on("GET", "/readyz", () =>
      problem(503, "not_ready", { title: "Database niet bereikbaar" }),
    );
    renderPage(<DashboardPage />, { server });
    const live = within(document.querySelector<HTMLElement>('[data-health="/healthz"]')!);
    const ready = within(document.querySelector<HTMLElement>('[data-health="/readyz"]')!);
    expect(await live.findByText("ok")).toBeInTheDocument();
    expect(await ready.findByText("fout")).toBeInTheDocument();
    // Geen "Database en Redis zijn bereikbaar." onder een rode status.
    expect(ready.getByText("Geen gezond antwoord (HTTP 503).")).toBeInTheDocument();
    expect(ready.queryByText("Database en Redis zijn bereikbaar.")).toBeNull();
  });

  it("toont bij /readyz 503 welk onderdeel stuk is", async () => {
    const server = createServer().on("GET", "/readyz", () =>
      json({ status: "unavailable", checks: { database: "ok", redis: "error" } }, { status: 503 }),
    );
    renderPage(<DashboardPage />, { server });
    const ready = within(document.querySelector<HTMLElement>('[data-health="/readyz"]')!);
    expect(await ready.findByText("Niet klaar: Database: ok · Redis: fout.")).toBeInTheDocument();
    expect(ready.queryByText("Database en Redis zijn bereikbaar.")).toBeNull();
  });

  it("toont een fout als het overzicht niet laadt", async () => {
    const server = createServer().on("GET", "/api/v1/dashboard", () =>
      problem(500, "internal_error", { detail: "Database weg." }),
    );
    renderPage(<DashboardPage />, { server });
    expect(await screen.findByText("Het overzicht kon niet geladen worden")).toBeInTheDocument();
    expect(screen.getByText("Database weg.")).toBeInTheDocument();
  });

  it("knoppen naar een nieuw thema en alle thema's", () => {
    setLocale("en");
    renderPage(<DashboardPage />);
    expect(screen.getByRole("link", { name: "+ New theme" })).toHaveAttribute(
      "href",
      "/themes?new=1",
    );
  });
});
