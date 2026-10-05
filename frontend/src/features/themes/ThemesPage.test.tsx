import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { json, problem } from "@/api/testing/fetch-mock";
import { makePalette, makeTheme, makeVersionSummary, testId } from "@/api/testing/fixtures";
import { setLocale } from "@/lib/i18n";
import { fx } from "@/lib/fx";
import { ThemesPage } from "./ThemesPage";
import { createServer, currentUrl, PUBLIC_BASE, renderPage, toastTexts } from "./testing";

const live = makeVersionSummary({ version_number: 3 });
const nord = makePalette({ id: testId(900), slug: "nord", name: "Nord" });

function themes() {
  return [
    makeTheme({
      id: testId(1),
      slug: "proxmox",
      name: "Proxmox",
      status: "published",
      published_version: live,
      palette_id: nord.id,
    }),
    makeTheme({
      id: testId(2),
      slug: "grafana",
      name: "Grafana",
      status: "published",
      published_version: live,
      draft_dirty: true,
    }),
    makeTheme({ id: testId(3), slug: "jellyfin", name: "Jellyfin", shadowed_by_file: true }),
  ];
}

function page(items: unknown[], next: string | null = null) {
  return json({ items, next_cursor: next });
}

function cards() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-theme-card]")).map(
    (el) => el.dataset.themeCard,
  );
}

function card(slug: string) {
  const el = document.querySelector<HTMLElement>(`[data-theme-card="${slug}"]`);
  if (!el) throw new Error(`geen kaart ${slug}`);
  return el;
}

function server() {
  return createServer()
    .on("GET", "/api/v1/palettes", () => json([nord]))
    .on("GET", "/api/v1/themes", () => page(themes()));
}

describe("ThemesPage", () => {
  it("toont een kaart per thema met status, palet en acties", async () => {
    const { server: api } = renderPage(<ThemesPage />, { path: "/themes", server: server() });
    await screen.findByRole("heading", { name: "Proxmox" });
    expect(cards()).toEqual(["proxmox", "grafana", "jellyfin"]);

    const proxmox = within(card("proxmox"));
    expect(proxmox.getByText("v3 live")).toBeInTheDocument();
    expect(proxmox.getByText("Nord")).toBeInTheDocument();
    expect(proxmox.getByRole("link", { name: "Proxmox openen in de editor" })).toHaveAttribute(
      "href",
      `/editor/${testId(1)}`,
    );
    expect(within(card("grafana")).getByText("draft gewijzigd")).toBeInTheDocument();
    const jellyfin = within(card("jellyfin"));
    expect(jellyfin.getByText("nooit gepubliceerd")).toBeInTheDocument();
    expect(jellyfin.getByText("⚠ bestand gaat voor")).toBeInTheDocument();
    expect(jellyfin.getByText(/jellyfin\.css op de server gaat voor/)).toBeInTheDocument();

    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("3 thema's");
    const query = api.callsTo("GET", "/api/v1/themes")[0]?.url.searchParams;
    expect(query?.get("sort")).toBe("-updated_at");
    expect(query?.get("limit")).toBe("24");
  });

  it("zoeken komt in de URL en (vertraagd) in de API-aanvraag", async () => {
    const { router, server: api } = renderPage(<ThemesPage />, {
      path: "/themes",
      server: server(),
    });
    await screen.findByRole("heading", { name: "Proxmox" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Thema's zoeken" }), {
      target: { value: "graf" },
    });
    expect(currentUrl(router)).toBe("/themes?q=graf");
    await waitFor(() =>
      expect(api.callsTo("GET", "/api/v1/themes").at(-1)?.url.searchParams.get("q")).toBe("graf"),
    );
  });

  it("leest de filters uit de URL en vertaalt 'live' naar status=published", async () => {
    const { server: api } = renderPage(<ThemesPage />, {
      path: `/themes?status=live&palette=${nord.id}&sort=name`,
      server: server(),
    });
    await screen.findByRole("heading", { name: "Proxmox" });
    const query = api.callsTo("GET", "/api/v1/themes")[0]?.url.searchParams;
    expect(query?.get("status")).toBe("published");
    expect(query?.get("palette_id")).toBe(nord.id);
    expect(query?.get("sort")).toBe("name");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("live");
    expect(screen.getByRole("combobox", { name: "Palet" })).toHaveValue(nord.id);
  });

  it("'draft gewijzigd' filtert in de browser", async () => {
    renderPage(<ThemesPage />, { path: "/themes?status=dirty", server: server() });
    await screen.findByRole("heading", { name: "Grafana" });
    expect(cards()).toEqual(["grafana"]);
  });

  it("'verwijderd' vraagt include_deleted en herstelt vanaf de kaart", async () => {
    const gone = makeTheme({
      id: testId(7),
      slug: "oud",
      name: "Oud",
      deleted_at: "2026-10-04T10:00:00Z",
    });
    const api = server()
      .on("GET", "/api/v1/themes", () => page([...themes(), gone]))
      .on("POST", "/api/v1/themes/:id/restore", () =>
        json({ ...gone, deleted_at: null }, { headers: { ETag: '"lv-2"' } }),
      );
    renderPage(<ThemesPage />, { path: "/themes?status=deleted", server: api });
    await screen.findByRole("heading", { name: "Oud" });
    expect(api.callsTo("GET", "/api/v1/themes")[0]?.url.searchParams.get("include_deleted")).toBe(
      "true",
    );
    expect(cards()).toEqual(["oud"]);
    expect(within(card("oud")).getByText("verwijderd")).toBeInTheDocument();

    const rollback = vi.spyOn(fx, "rollback");
    fireEvent.click(screen.getByRole("button", { name: "Oud herstellen" }));
    await waitFor(() => expect(api.callsTo("POST", "/api/v1/themes/:id/restore")).toHaveLength(1));
    await waitFor(() => expect(toastTexts()).toContainEqual({ tone: "ok", text: "Oud hersteld." }));
    expect(rollback).toHaveBeenCalled();
    // De kaart valt uit het filter: de focus gaat naar de resultaten, niet naar <body>.
    await waitFor(() => expect(screen.getByRole("region", { name: "Resultaten" })).toHaveFocus());
  });

  it("'meer laden' haalt de volgende pagina met de cursor", async () => {
    const first = Array.from({ length: 24 }, (_, i) =>
      makeTheme({ id: testId(100 + i), slug: `t-${i}`, name: `Thema ${i}` }),
    );
    const extra = makeTheme({ id: testId(200), slug: "laatste", name: "Laatste" });
    const api = server().on("GET", "/api/v1/themes", ({ url }) =>
      url.searchParams.get("cursor") === "c2" ? page([extra]) : page(first, "c2"),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    await screen.findByRole("heading", { name: "Thema 0" });
    expect(cards()).toHaveLength(24);
    expect(screen.getByText(/24 thema's · er zijn er meer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "↓ Meer laden" }));
    await screen.findByRole("heading", { name: "Laatste" });
    expect(cards()).toHaveLength(25);
    expect(api.callsTo("GET", "/api/v1/themes").at(-1)?.url.searchParams.get("cursor")).toBe("c2");
    expect(screen.queryByRole("button", { name: "↓ Meer laden" })).toBeNull();
  });

  it("laadt zelf pagina's bij als een browserfilter te weinig overhoudt", async () => {
    const clean = Array.from({ length: 24 }, (_, i) =>
      makeTheme({ id: testId(300 + i), slug: `c-${i}`, name: `Schoon ${i}` }),
    );
    const dirty = makeTheme({
      id: testId(400),
      slug: "vuil",
      name: "Vuil",
      draft_dirty: true,
    });
    const api = server().on("GET", "/api/v1/themes", ({ url }) =>
      url.searchParams.get("cursor") === "p2" ? page([dirty]) : page(clean, "p2"),
    );
    renderPage(<ThemesPage />, { path: "/themes?status=dirty", server: api });
    await screen.findByRole("heading", { name: "Vuil" });
    expect(cards()).toEqual(["vuil"]);
    expect(api.callsTo("GET", "/api/v1/themes")).toHaveLength(2);
  });

  it("lege lijst: uitnodiging om te maken of te importeren; met filters: filters wissen", async () => {
    const api = createServer();
    const { router } = renderPage(<ThemesPage />, { path: "/themes", server: api });
    expect(await screen.findByText("Nog geen thema's")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CSS-bestanden importeren" })).toHaveAttribute(
      "href",
      "/import",
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "live" },
    });
    expect(await screen.findByText("Geen thema's gevonden voor deze filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters wissen" }));
    expect(currentUrl(router)).toBe("/themes");
  });

  it("toont een fout met opnieuw proberen", async () => {
    let fail = true;
    const api = createServer().on("GET", "/api/v1/themes", () =>
      fail ? problem(500, "internal_error", { title: "Er ging iets mis op de server." }) : page([]),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    expect(await screen.findByText("De thema's konden niet geladen worden")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "⟳ Opnieuw proberen" }));
    expect(await screen.findByText("Nog geen thema's")).toBeInTheDocument();
  });

  it("verwijderen: bevestigen, bliksem op de kaart, DELETE en een toast met ongedaan maken", async () => {
    const remove = vi.spyOn(fx, "remove").mockResolvedValue();
    const api = server().on("POST", "/api/v1/themes/:id/restore", ({ params }) =>
      json(themes().find((theme) => theme.id === params.id)),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    await screen.findByRole("heading", { name: "Proxmox" });

    fireEvent.click(screen.getByRole("button", { name: "Acties voor Proxmox" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "⚡ Verwijderen…" }));
    const dialog = screen.getByRole("dialog", { name: "Proxmox verwijderen?" });
    expect(dialog).toHaveTextContent("/proxmox.css geeft daarna 404.");
    fireEvent.click(within(dialog).getByRole("button", { name: "⚡ Verwijderen" }));

    await waitFor(() => expect(api.callsTo("DELETE", "/api/v1/themes/:id")).toHaveLength(1));
    expect(api.callsTo("DELETE", "/api/v1/themes/:id")[0]?.path).toBe(
      `/api/v1/themes/${testId(1)}`,
    );
    expect(api.callsTo("DELETE", "/api/v1/themes/:id")[0]?.url.searchParams.has("hard")).toBe(
      false,
    );
    expect(remove).toHaveBeenCalledWith(card("proxmox"));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "Proxmox verwijderd.↺ Ongedaan maken",
      }),
    );
  });

  it("verwijderen dat mislukt toont de fout en zet de kaart terug", async () => {
    vi.spyOn(fx, "remove").mockResolvedValue();
    const unzap = vi.spyOn(fx, "unzap");
    const api = server().on("DELETE", "/api/v1/themes/:id", () =>
      problem(409, "state_conflict", { detail: "Thema is vergrendeld." }),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    await screen.findByRole("heading", { name: "Proxmox" });
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Proxmox" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "⚡ Verwijderen…" }));
    fireEvent.click(screen.getByRole("button", { name: "⚡ Verwijderen" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({ tone: "err", text: "Thema is vergrendeld." }),
    );
    expect(unzap).toHaveBeenCalledWith(card("proxmox"));
  });

  it("export (.css) staat uit zonder live versie en legt uit waarom", async () => {
    renderPage(<ThemesPage />, { path: "/themes", server: server() });
    await screen.findByRole("heading", { name: "Jellyfin" });
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Jellyfin" }));
    const item = screen.getByRole("menuitem", { name: /Exporteren \(\.css\)/ });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleName(
      "⤓ Exporteren (.css) (Nog geen live versie: publiceer eerst, of exporteer de bundel.)",
    );
  });

  it("bundel exporteren downloadt <slug>.cssthema.zip", async () => {
    // jsdom kent geen object-URL's; het opslaan zelf (klik op een <a download>) faken we.
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const api = server().on(
      "GET",
      "/api/v1/themes/:id/export",
      () =>
        new Response(new TextEncoder().encode("PK"), {
          headers: { "Content-Type": "application/zip" },
        }),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    await screen.findByRole("heading", { name: "Grafana" });
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Grafana" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Bundel exporteren/ }));
    await waitFor(() => expect(toastTexts()).toHaveLength(1));
    expect(toastTexts()).toEqual([{ tone: "ok", text: "Gedownload: grafana.cssthema.zip" }]);
    expect(api.callsTo("GET", "/api/v1/themes/:id/export")[0]?.url.searchParams.get("format")).toBe(
      "bundle",
    );
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = urls.revoke;
  });

  it("URL kopiëren gebruikt het klembord", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.stubGlobal("isSecureContext", true);
    renderPage(<ThemesPage />, { path: "/themes", server: server() });
    await screen.findByRole("heading", { name: "Proxmox" });
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Proxmox" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /URL kopiëren/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost/proxmox.css"));
    expect(toastTexts()).toContainEqual({
      tone: "ok",
      text: "Gekopieerd: http://localhost/proxmox.css",
    });
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("dupliceren vraagt een naam en maakt een kopie", async () => {
    const api = server().on("POST", "/api/v1/themes/:id/duplicate", ({ body }) =>
      json(
        makeTheme({ id: testId(50), slug: "proxmox-kopie", name: (body as { name: string }).name }),
        { status: 201 },
      ),
    );
    renderPage(<ThemesPage />, { path: "/themes", server: api });
    await screen.findByRole("heading", { name: "Proxmox" });
    fireEvent.click(screen.getByRole("button", { name: "Acties voor Proxmox" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Dupliceren/ }));
    const dialog = screen.getByRole("dialog", { name: "Proxmox dupliceren" });
    expect(within(dialog).getByLabelText("Naam")).toHaveValue("Proxmox (kopie)");
    expect(within(dialog).getByLabelText("Slug (URL)")).toHaveValue("proxmox-kopie");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dupliceren" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "Kopie Proxmox (kopie) aangemaakt. Openen",
      }),
    );
    expect(api.callsTo("POST", "/api/v1/themes/:id/duplicate")[0]?.body).toMatchObject({
      name: "Proxmox (kopie)",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("in het Engels", async () => {
    setLocale("en");
    renderPage(<ThemesPage />, { path: "/themes", server: server() });
    await screen.findByRole("heading", { name: "Proxmox" });
    expect(screen.getByRole("heading", { level: 1, name: "Themes" })).toBeInTheDocument();
    expect(within(card("grafana")).getByText("draft changed")).toBeInTheDocument();
  });
});

describe("Nieuw thema", () => {
  function openNew(extra?: (api: ReturnType<typeof server>) => void) {
    const api = server();
    extra?.(api);
    const result = renderPage(<ThemesPage />, { path: "/themes?new=1", server: api });
    const dialog = screen.getByRole("dialog", { name: "Nieuw thema" });
    return { ...result, api, dialog: within(dialog) };
  }

  it("opent via de knop en zet ?new=1 in de URL; annuleren sluit", async () => {
    const { router } = renderPage(<ThemesPage />, { path: "/themes", server: server() });
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuw" }));
    expect(currentUrl(router)).toBe("/themes?new=1");
    expect(screen.getByRole("dialog", { name: "Nieuw thema" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Annuleren" }));
    expect(currentUrl(router)).toBe("/themes");
  });

  it("stelt de slug voor uit de naam en toont de live-URL", async () => {
    const { dialog } = openNew();
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "Proxmox (Nord)" } });
    const slug = dialog.getByLabelText("Slug (URL)");
    expect(slug).toHaveValue("proxmox-nord");
    expect(await dialog.findByText(`${PUBLIC_BASE}/proxmox-nord.css`)).toBeInTheDocument();

    fireEvent.change(slug, { target: { value: "eigen" } });
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "Iets anders" } });
    expect(slug).toHaveValue("eigen");
  });

  it("meldt een gereserveerde slug al voor het versturen", () => {
    const { dialog, api } = openNew();
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "API" } });
    expect(dialog.getByLabelText("Slug (URL)")).toHaveAccessibleDescription(
      /„api” is gereserveerd voor cssthema zelf\./,
    );
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    expect(api.callsTo("POST", "/api/v1/themes")).toHaveLength(0);
  });

  it("vraagt een naam", () => {
    const { dialog, api } = openNew();
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    expect(dialog.getByText("Geef een naam op.")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/v1/themes")).toHaveLength(0);
  });

  it("toont een slug-conflict (409) bij het slugveld", async () => {
    const { dialog } = openNew((api) =>
      api.on("POST", "/api/v1/themes", () =>
        problem(409, "slug_conflict", { detail: "Slug 'proxmox' bestaat al." }),
      ),
    );
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "Proxmox" } });
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    await waitFor(() =>
      expect(dialog.getByLabelText("Slug (URL)")).toHaveAccessibleDescription(
        /Slug 'proxmox' bestaat al\./,
      ),
    );
    expect(dialog.getByLabelText("Slug (URL)")).toHaveAttribute("aria-invalid", "true");
  });

  it("maakt een thema met palet en basissjabloon en opent de editor", async () => {
    const created = makeTheme({ id: testId(77), slug: "grafana-nord", name: "Grafana Nord" });
    const { router, api, dialog } = openNew((server) =>
      server.on("POST", "/api/v1/themes", () =>
        json(created, { status: 201, headers: { ETag: '"lv-1"' } }),
      ),
    );
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "Grafana Nord" } });
    await dialog.findByRole("option", { name: "Nord" });
    fireEvent.change(dialog.getByLabelText("Palet"), { target: { value: nord.id } });
    fireEvent.click(dialog.getByRole("radio", { name: /Basissjabloon/ }));
    fireEvent.change(dialog.getByLabelText("Beschrijving (optioneel)"), {
      target: { value: "Donker" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));

    await screen.findByTestId("editor-stub");
    expect(currentUrl(router)).toBe(`/editor/${testId(77)}`);
    const body = api.callsTo("POST", "/api/v1/themes")[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Grafana Nord",
      slug: "grafana-nord",
      palette_id: nord.id,
      description: "Donker",
    });
    expect(body.css).toContain("var(--ct-bg, ");
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Grafana Nord aangemaakt." });
  });

  it("kopie van een thema: kiest uit de lijst en stuurt een sjabloon", async () => {
    const { api, dialog } = openNew((server) =>
      server.on("POST", "/api/v1/themes", () =>
        json(makeTheme({ id: testId(78) }), { status: 201 }),
      ),
    );
    fireEvent.change(dialog.getByLabelText("Naam"), { target: { value: "Kopie" } });
    fireEvent.click(dialog.getByRole("radio", { name: /Kopie van een thema/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    expect(dialog.getByText("Kies een thema om te kopiëren.")).toBeInTheDocument();

    await dialog.findByRole("option", { name: /Grafana/ });
    fireEvent.change(dialog.getByLabelText("Thema om te kopiëren"), {
      target: { value: testId(2) },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    await waitFor(() => expect(api.callsTo("POST", "/api/v1/themes")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/v1/themes")[0]?.body).toMatchObject({
      template: { kind: "theme", id: testId(2) },
    });
    const listCall = api
      .callsTo("GET", "/api/v1/themes")
      .find((call) => call.url.searchParams.get("sort") === "name");
    expect(listCall?.url.searchParams.get("limit")).toBe("200");
  });
});
