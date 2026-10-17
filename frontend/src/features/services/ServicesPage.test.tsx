import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, noContent, problem } from "@/api/testing/fetch-mock";
import { serviceKeys } from "@/api/queries/keys";
import {
  makeCaptureImportResult,
  makeServiceSummary,
  makeSnapshotDocument,
  makeSnapshotSummary,
  testId,
} from "@/api/testing/fixtures";
import type { ServiceSummary } from "@/api/types";
import { createServer, renderPage, toastTexts } from "@/features/themes/testing";
import { ServicesPage } from "./ServicesPage";

/** ISO-tijd zoveel minuten geleden. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const proxmox = makeServiceSummary({
  id: testId(1),
  name: "Proxmox",
  slug: "proxmox",
  hostname: "proxmox.example",
  snapshots: [
    makeSnapshotSummary({
      id: testId(11),
      status: "ok",
      frameworks: ["ExtJS", "jQuery"],
      class_count: 1234,
      theme_links: ["https://css.example/algemeen.css"],
      captured_at: minutesAgo(5),
    }),
    makeSnapshotSummary({
      id: testId(12),
      page: "opslag",
      page_kind: "custom",
      title: "Opslag",
      status: "inlogpagina",
      captured_at: minutesAgo(90),
    }),
  ],
});
const vault = makeServiceSummary({
  id: testId(2),
  name: "Vaultwarden",
  slug: "vaultwarden",
  hostname: "vault.example",
  snapshots: [
    makeSnapshotSummary({
      id: testId(21),
      status: "http-502",
      has_document: false,
      title: null,
      screenshots: { origineel: `/api/v1/assets/${testId(210)}` },
      captured_at: null,
    }),
  ],
});
const grafana = makeServiceSummary({
  id: testId(3),
  name: "Grafana",
  slug: "grafana",
  hostname: "grafana.example",
  snapshots: [makeSnapshotSummary({ id: testId(31), status: "authentik-login" })],
});

function server(services: ServiceSummary[] = [proxmox, vault, grafana]) {
  return createServer().on("GET", "/api/v1/services", () => json(services));
}

function card(name: string) {
  return within(screen.getByRole("article", { name }));
}

/** Kiest bestanden in een `<input type="file">` (jsdom laat `files` niet zomaar zetten). */
function pick(input: HTMLElement, chosen: File[]) {
  const list = [...chosen];
  Object.defineProperty(input, "files", { configurable: true, get: () => list });
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => (list.length ? `C:\\fakepath\\${list[0]!.name}` : ""),
    set: () => {
      list.length = 0;
    },
  });
  fireEvent.change(input);
}

/**
 * Een zip-deel. jsdom + undici verliezen de bestandsnaam in multipart onderweg (de browser
 * niet), dus de inhoud is standaard de naam: zo herkent de nep-server het bestand.
 */
function zipFile(name: string, content = name) {
  return new File([content], name, { type: "application/zip", lastModified: 1 });
}

function uploadRow(name: string) {
  const row = document.querySelector<HTMLElement>(`[data-capture-file="${name}"]`);
  if (!row) throw new Error(`geen rij voor ${name}`);
  return row;
}

describe("ServicesPage", () => {
  it("toont per service status, frameworks, tijd, screenshots en pagina's", async () => {
    renderPage(<ServicesPage />, { path: "/services", server: server() });
    expect(await screen.findByRole("article", { name: "Proxmox" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Services" })).toBeInTheDocument();
    expect(screen.getByText("3 services")).toBeInTheDocument();
    // Geen uitleg in de uploadkaart zolang die in de lege toestand staat; hier wel.
    expect(screen.getByText("Hoe maak ik zo'n zip?")).toBeInTheDocument();

    const first = card("Proxmox");
    const link = first.getByRole("link", { name: /proxmox\.example/ });
    expect(link).toHaveAttribute("href", "https://proxmox.example/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(first.getAllByText("ok")[0]).toHaveAttribute("data-tone", "ok");
    expect(
      within(first.getByRole("list", { name: "Frameworks" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["ExtJS", "jQuery"]);
    expect(first.getByText(/^Vastgelegd 5 min/)).toBeInTheDocument();
    expect(first.getByText(/1\.234 classes/)).toBeInTheDocument();

    const original = first.getByAltText("Screenshot van Proxmox: Origineel");
    expect(original).toHaveAttribute("loading", "lazy");
    expect(original).toHaveAttribute("src", proxmox.snapshots[0]!.screenshots.origineel);
    expect(first.getByAltText("Screenshot van Proxmox: Met thema")).toHaveAttribute(
      "loading",
      "lazy",
    );

    // Meer pagina's: compact in een uitklapper.
    expect(first.getByText("2 pagina's")).toBeInTheDocument();
    const pages = [...document.querySelectorAll<HTMLElement>("[data-snapshot]")];
    expect(pages.map((row) => row.dataset.snapshot)).toEqual(["start", "opslag"]);
    expect(within(pages[1]!).getByText("inlogpagina")).toHaveAttribute("data-tone", "default");

    // Zonder snapshot.html, http-502 rood, zonder screenshot met thema, importtijd.
    const second = card("Vaultwarden");
    expect(second.getByText("http-502")).toHaveAttribute("data-tone", "err");
    expect(second.getByText("zonder snapshot")).toBeInTheDocument();
    expect(second.getByText("geen screenshot")).toBeInTheDocument();
    expect(second.getByText(/^Geïmporteerd/)).toBeInTheDocument();
    expect(second.queryByText(/pagina's/)).not.toBeInTheDocument();

    expect(card("Grafana").getByText("authentik-login")).toHaveAttribute("data-tone", "default");
  });

  it("zoekt op naam en hostnaam en filtert op met of zonder snapshot", async () => {
    renderPage(<ServicesPage />, { path: "/services", server: server() });
    await screen.findByRole("article", { name: "Proxmox" });
    const search = screen.getByRole("searchbox", { name: "Services zoeken" });

    fireEvent.change(search, { target: { value: "VAULT.example" } });
    expect(screen.getAllByRole("article").map((el) => el.getAttribute("data-service"))).toEqual([
      "vaultwarden",
    ]);
    expect(screen.getByText("1 van 3")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "graf" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "nergens" } });
    expect(screen.getByText("Geen service gevonden voor “nergens”.")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "" } });

    const filters = within(screen.getByRole("group", { name: "Filter op snapshot" }));
    expect(filters.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(filters.getByRole("button", { name: "Zonder snapshot" }));
    expect(filters.getByRole("button", { name: "Zonder snapshot" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("article").map((el) => el.getAttribute("data-service"))).toEqual([
      "vaultwarden",
    ]);
    expect(screen.getByText("1 van 3")).toBeInTheDocument();

    fireEvent.click(filters.getByRole("button", { name: "Met snapshot" }));
    expect(screen.getAllByRole("article").map((el) => el.getAttribute("data-service"))).toEqual([
      "proxmox",
      "grafana",
    ]);
    expect(screen.getByText("2 van 3")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "vault" } });
    expect(screen.getByText("Geen service gevonden voor “vault”.")).toBeInTheDocument();
  });

  it("toont de screenshots groot, per stuk en naast elkaar", async () => {
    renderPage(<ServicesPage />, { path: "/services", server: server() });
    await screen.findByRole("article", { name: "Proxmox" });
    fireEvent.click(
      card("Proxmox").getByRole("button", { name: "Met thema van Proxmox groot bekijken" }),
    );

    const dialog = within(await screen.findByRole("dialog", { name: "Screenshots van Proxmox" }));
    const shots = proxmox.snapshots[0]!.screenshots;
    expect(dialog.getByRole("tab", { name: "Met thema" })).toHaveAttribute("aria-selected", "true");
    expect(dialog.getByAltText("Screenshot van Proxmox: Met thema")).toHaveAttribute(
      "src",
      shots.met_thema,
    );
    expect(dialog.getByRole("link", { name: /Ware grootte/ })).toHaveAttribute(
      "href",
      shots.met_thema,
    );
    expect(dialog.getByText("https://css.example/algemeen.css")).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("tab", { name: "Mobiel" }));
    expect(dialog.getByAltText("Screenshot van Proxmox: Mobiel")).toHaveAttribute(
      "src",
      shots.mobiel,
    );

    fireEvent.click(dialog.getByRole("tab", { name: "Naast elkaar" }));
    expect(dialog.getByRole("tabpanel").querySelectorAll("img").length).toBe(3);

    fireEvent.click(dialog.getByRole("button", { name: "Sluiten" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Een andere pagina van dezelfde service, vanuit de lijst met pagina's.
    fireEvent.click(
      card("Proxmox").getByRole("button", { name: "Screenshots van opslag (Proxmox)" }),
    );
    const other = within(await screen.findByRole("dialog", { name: "Screenshots van Proxmox" }));
    expect(other.getByText(/^Pagina opslag · “Opslag”/)).toBeInTheDocument();
    expect(other.getByRole("tab", { name: "Origineel" })).toHaveAttribute("aria-selected", "true");
  });

  it("uploadt de gekozen zips één voor één en toont per zip het resultaat", async () => {
    const api = server().on("POST", "/api/v1/captures", async ({ body }) => {
      const name = await ((body as FormData).get("file") as Blob).text();
      if (name === "kapot.zip") {
        return problem(422, "validation_error", {
          title: "Geen geldige capture-zip",
          detail: "Dit is geen zip-bestand.",
        });
      }
      return json(
        makeCaptureImportResult({
          services_created: ["nas.example", "git.example"],
          services_updated: ["proxmox.example"],
          snapshots: 3,
          without_snapshot: ["vault.example"],
          skipped: [{ path: "vastgelegd/x/info.json", reason: "Geen geldige JSON." }],
        }),
      );
    });
    renderPage(<ServicesPage />, { path: "/services", server: api });
    await screen.findByRole("article", { name: "Proxmox" });

    const input = screen.getByTestId("capture-input");
    expect(input).toHaveAttribute("multiple");
    pick(input, [zipFile("vastgelegd-deel1.zip"), zipFile("kapot.zip"), zipFile("notities.txt")]);

    // Geen zip: staat in de lijst, maar wordt niet verstuurd.
    expect(uploadRow("notities.txt")).toHaveAttribute("data-state", "invalid");
    expect(within(uploadRow("notities.txt")).getByText("Geen .zip-bestand.")).toBeInTheDocument();
    expect(uploadRow("vastgelegd-deel1.zip")).toHaveAttribute("data-state", "queued");

    fireEvent.click(screen.getByRole("button", { name: "2 zips uploaden" }));
    await waitFor(() => expect(uploadRow("kapot.zip")).toHaveAttribute("data-state", "failed"));

    const calls = api.callsTo("POST", "/api/v1/captures");
    expect(calls).toHaveLength(2);
    expect(await ((calls[0]!.body as FormData).get("file") as Blob).text()).toBe(
      "vastgelegd-deel1.zip",
    );
    expect(calls[0]!.headers.get("Content-Type")).toContain("multipart/form-data");

    const done = within(uploadRow("vastgelegd-deel1.zip"));
    expect(uploadRow("vastgelegd-deel1.zip")).toHaveAttribute("data-state", "done");
    expect(done.getByText("geïmporteerd")).toBeInTheDocument();
    expect(
      uploadRow("vastgelegd-deel1.zip").querySelector("[data-capture-counts]"),
    ).toHaveTextContent(
      "2 nieuwe services · 1 bijgewerkt · 3 snapshots · 1 zonder snapshot · 1 bestand overgeslagen",
    );
    expect(done.getByText("nas.example")).toBeInTheDocument();
    expect(done.getByText("vault.example")).toBeInTheDocument();
    expect(done.getByText("vastgelegd/x/info.json: Geen geldige JSON.")).toBeInTheDocument();

    expect(
      within(uploadRow("kapot.zip")).getByText("Dit is geen zip-bestand."),
    ).toBeInTheDocument();
    expect(toastTexts()).toContainEqual({
      tone: "mid",
      text: "1 zip geïmporteerd, 1 zip mislukt.",
    });
    // Na een import wordt de lijst opnieuw opgehaald.
    await waitFor(() => expect(api.callsTo("GET", "/api/v1/services").length).toBeGreaterThan(1));

    expect(screen.getByRole("button", { name: "Uploaden" })).toBeDisabled();
    // Opnieuw proberen zet de zip terug in de wachtrij.
    fireEvent.click(screen.getByRole("button", { name: "kapot.zip opnieuw proberen" }));
    expect(uploadRow("kapot.zip")).toHaveAttribute("data-state", "queued");
    expect(screen.getByRole("button", { name: "1 zip uploaden" })).toBeEnabled();
  });

  it("toont welke pagina's hun vorige snapshot hielden en haalt de documenten opnieuw op", async () => {
    const api = server().on("POST", "/api/v1/captures", () =>
      json(
        makeCaptureImportResult({
          services_updated: ["proxmox.example", "vault.example"],
          snapshots: 1,
          kept_previous: ["vault.example", "proxmox.example/opslag"],
        }),
      ),
    );
    const { queryClient } = renderPage(<ServicesPage />, { path: "/services", server: api });
    await screen.findByRole("article", { name: "Proxmox" });
    queryClient.setQueryData(serviceKeys.document(testId(11)), makeSnapshotDocument());

    pick(screen.getByTestId("capture-input"), [zipFile("vastgelegd-deel1.zip")]);
    fireEvent.click(screen.getByRole("button", { name: "1 zip uploaden" }));
    await waitFor(() =>
      expect(uploadRow("vastgelegd-deel1.zip")).toHaveAttribute("data-state", "done"),
    );

    const row = uploadRow("vastgelegd-deel1.zip");
    expect(row.querySelector("[data-capture-counts]")).toHaveTextContent(
      "0 nieuwe services · 2 bijgewerkt · 1 snapshot · 0 zonder snapshot · 2 vorige snapshots behouden · 0 bestanden overgeslagen",
    );
    const kept = row.querySelector<HTMLElement>('[data-group="kept"]');
    expect(kept).not.toBeNull();
    expect(within(kept!).getByText("vault.example")).toBeInTheDocument();
    expect(within(kept!).getByText("proxmox.example/opslag")).toBeInTheDocument();
    expect(kept).toHaveTextContent("De vorige, goede snapshot blijft staan");
    // Bijgewerkte snapshots houden hun id: de documenten in de cache zijn niet meer geldig.
    expect(queryClient.getQueryState(serviceKeys.document(testId(11)))?.isInvalidated).toBe(true);
  });

  it("toont geen teller voor behouden snapshots als er geen zijn", async () => {
    const api = server().on("POST", "/api/v1/captures", () =>
      json(makeCaptureImportResult({ snapshots: 2 })),
    );
    renderPage(<ServicesPage />, { path: "/services", server: api });
    await screen.findByRole("article", { name: "Proxmox" });
    pick(screen.getByTestId("capture-input"), [zipFile("vastgelegd-deel1.zip")]);
    fireEvent.click(screen.getByRole("button", { name: "1 zip uploaden" }));
    await waitFor(() =>
      expect(uploadRow("vastgelegd-deel1.zip")).toHaveAttribute("data-state", "done"),
    );
    const row = uploadRow("vastgelegd-deel1.zip");
    expect(row.querySelector("[data-capture-counts]")).not.toHaveTextContent("behouden");
    expect(row.querySelector('[data-group="kept"]')).toBeNull();
  });

  it("verwijdert een service na bevestiging", async () => {
    let services = [proxmox, vault, grafana];
    const api = createServer()
      .on("GET", "/api/v1/services", () => json(services))
      .on("DELETE", "/api/v1/services/:id", ({ params }) => {
        services = services.filter((service) => service.id !== params.id);
        return noContent();
      });
    renderPage(<ServicesPage />, { path: "/services", server: api });
    await screen.findByRole("article", { name: "Proxmox" });

    fireEvent.click(card("Proxmox").getByRole("button", { name: "Proxmox verwijderen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Proxmox verwijderen?" }));
    expect(
      dialog.getByText(
        "proxmox.example en zijn 2 snapshots verdwijnen uit de lijst. Een nieuwe import van vastleggen.py zet hem terug.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "⚡ Verwijderen" }));

    await waitFor(() => expect(api.callsTo("DELETE")).toHaveLength(1));
    expect(api.callsTo("DELETE")[0]?.path).toBe(`/api/v1/services/${proxmox.id}`);
    await waitFor(() =>
      expect(screen.queryByRole("article", { name: "Proxmox" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("2 services")).toBeInTheDocument();
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Proxmox verwijderd." });
  });

  it("legt zonder services uit hoe je een zip maakt", async () => {
    renderPage(<ServicesPage />, { path: "/services", server: server([]) });
    expect(await screen.findByText("Nog geen services")).toBeInTheDocument();
    const help = document.querySelector<HTMLElement>("[data-capture-help]");
    expect(help).toHaveTextContent("python vastleggen.py alles");
    expect(help).toHaveTextContent("vastgelegd-deel1.zip");
    expect(screen.getByText("0 services")).toBeInTheDocument();
    expect(screen.queryByText("Hoe maak ik zo'n zip?")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    // De uploadkaart staat er ook.
    expect(screen.getByRole("button", { name: "Zips kiezen" })).toBeInTheDocument();
  });

  it("toont een fout als de lijst niet laadt", async () => {
    const api = createServer().on("GET", "/api/v1/services", () =>
      problem(500, "internal_error", { detail: "Database onbereikbaar." }),
    );
    renderPage(<ServicesPage />, { path: "/services", server: api });
    expect(await screen.findByText("De services konden niet geladen worden")).toBeInTheDocument();
    expect(screen.getByText("Database onbereikbaar.")).toBeInTheDocument();
  });
});
