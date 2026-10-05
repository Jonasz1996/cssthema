import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { json, problem } from "@/api/testing/fetch-mock";
import {
  makeDashboard,
  makeLocalFile,
  makeTheme,
  makeVersionSummary,
  testId,
} from "@/api/testing/fixtures";
import type { ImportedTheme } from "@/api/types";
import { useUiStore } from "@/app/ui-store";
import { createServer, currentUrl, renderPage, toastTexts } from "@/features/themes/testing";
import { fx } from "@/lib/fx";
import { setLocale } from "@/lib/i18n";
import { ImportPage } from "./ImportPage";

const files = [
  makeLocalFile({ name: "grafana.css", size_bytes: 3482 }),
  makeLocalFile({ name: "proxmox.css" }),
  makeLocalFile({
    name: "Fout Naam.css",
    slug: null,
    importable: false,
    reason: "Bestandsnaam is geen geldige slug.",
  }),
  makeLocalFile({
    name: "jellyfin.css",
    importable: false,
    reason: "Er bestaat al een thema met slug 'jellyfin'.",
    theme_id: testId(60),
  }),
];

function imported(name: string, overrides: Partial<ImportedTheme> = {}): ImportedTheme {
  const slug = name.replace(/\.css$/, "");
  return {
    ...makeTheme({
      id: testId(slug.length + 500),
      slug,
      name: slug[0]!.toUpperCase() + slug.slice(1),
      status: "published",
      published_version: makeVersionSummary({ version_number: 1, source: "import" }),
    }),
    source_file: name,
    archive_error: null,
    ...overrides,
  };
}

function localServer() {
  return createServer()
    .on("GET", "/api/v1/themes/local-files", () => json(files))
    .on("GET", "/api/v1/dashboard", () =>
      json(makeDashboard({ local_files: { dir: "/srv/css-files", total: 4, importable: 2 } })),
    )
    .on("POST", "/api/v1/themes/local-files/import", ({ body }) => {
      const { names } = body as { names: string[] };
      return json({
        imported: names.filter((n) => n !== "proxmox.css").map((n) => imported(n)),
        skipped: names
          .filter((n) => n === "proxmox.css")
          .map((n) => ({ name: n, reason: "CSS bevat fouten (lint)." })),
      });
    });
}

function row(name: string) {
  const cell = screen.getByText(name, { selector: "code" });
  const tr = cell.closest("tr");
  if (!tr) throw new Error(`geen rij ${name}`);
  return within(tr);
}

describe("Import: CSS-bestanden op de server", () => {
  it("toont de bestanden met hun status en de map", async () => {
    renderPage(<ImportPage />, { path: "/import", server: localServer() });
    await screen.findByRole("table", { name: "Handgemaakte CSS-bestanden op de server" });
    expect(screen.getByText("/srv/css-files")).toBeInTheDocument();
    expect(screen.getByText("4 bestanden, 2 importeerbaar.")).toBeInTheDocument();

    expect(row("grafana.css").getByText("importeerbaar")).toBeInTheDocument();
    expect(row("grafana.css").getByText("3,4 KB")).toBeInTheDocument();
    expect(row("grafana.css").getByText("→ /grafana.css")).toBeInTheDocument();

    const bad = row("Fout Naam.css");
    expect(bad.getByText("niet importeerbaar")).toBeInTheDocument();
    expect(bad.getByText("Bestandsnaam is geen geldige slug.")).toBeInTheDocument();
    expect(bad.getByRole("checkbox")).toBeDisabled();

    const shadow = row("jellyfin.css");
    expect(shadow.getByText("gaat voor op thema")).toBeInTheDocument();
    expect(
      shadow.getByText(/nginx serveert dit bestand in plaats van dat thema/),
    ).toBeInTheDocument();
    // De serverreden zegt hetzelfde als de uitleg: niet dubbel tonen.
    expect(shadow.queryByText(/Er bestaat al een thema met slug/)).toBeNull();
    expect(shadow.getByRole("link", { name: "Thema openen" })).toHaveAttribute(
      "href",
      `/editor/${testId(60)}`,
    );
    expect(useUiStore.getState().commandOverride).toBe("cssthema import --local");
  });

  it("selecteert importeerbare bestanden (alles, per rij, kop-vakje)", async () => {
    renderPage(<ImportPage />, { path: "/import", server: localServer() });
    await screen.findByRole("table");
    const submit = screen.getByRole("button", { name: "0 bestanden importeren" });
    expect(submit).toBeDisabled();

    fireEvent.click(row("grafana.css").getByRole("checkbox", { name: "grafana.css selecteren" }));
    expect(screen.getByRole("button", { name: "1 bestand importeren" })).toBeEnabled();
    const all = screen.getByRole("checkbox", { name: "Alle importeerbare bestanden selecteren" });
    expect(all).toHaveProperty("indeterminate", true);

    fireEvent.click(screen.getByRole("button", { name: "Alle 2 importeerbare selecteren" }));
    expect(screen.getByRole("button", { name: "2 bestanden importeren" })).toBeEnabled();
    expect(all).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Selectie wissen" }));
    expect(screen.getByRole("button", { name: "0 bestanden importeren" })).toBeDisabled();
  });

  it("archiveren kan alleen als er gepubliceerd wordt", async () => {
    const api = localServer();
    renderPage(<ImportPage />, { path: "/import", server: api });
    await screen.findByRole("table");
    const publish = screen.getByRole("checkbox", { name: "Meteen publiceren (v1 live)" });
    const archive = screen.getByRole("checkbox", { name: "Daarna archiveren naar .geimporteerd/" });
    expect(publish).toBeChecked();
    expect(archive).toBeChecked();

    fireEvent.click(publish);
    expect(archive).toBeDisabled();
    expect(archive).not.toBeChecked();
    expect(
      screen.getByText("Alleen live thema's worden gearchiveerd: anders zou de URL 404 geven."),
    ).toBeInTheDocument();

    fireEvent.click(row("grafana.css").getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "1 bestand importeren" }));
    await waitFor(() =>
      expect(api.callsTo("POST", "/api/v1/themes/local-files/import")).toHaveLength(1),
    );
    expect(api.callsTo("POST", "/api/v1/themes/local-files/import")[0]?.body).toEqual({
      names: ["grafana.css"],
      publish: false,
      archive: false,
    });
  });

  it("importeert, toont het resultaat en vuurt het publiceer-effect", async () => {
    const publishFx = vi.spyOn(fx, "publish");
    const api = localServer();
    renderPage(<ImportPage />, { path: "/import", server: api });
    await screen.findByRole("table");
    fireEvent.click(row("grafana.css").getByRole("checkbox"));
    const submit = screen.getByRole("button", { name: "1 bestand importeren" });
    fireEvent.click(submit);

    const result = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-imported="grafana.css"]');
      if (!el) throw new Error("nog geen resultaat");
      return within(el);
    });
    expect(api.callsTo("POST", "/api/v1/themes/local-files/import")[0]?.body).toEqual({
      names: ["grafana.css"],
      publish: true,
      archive: true,
    });
    expect(result.getByText("v1 live")).toBeInTheDocument();
    expect(result.getByText("gearchiveerd")).toBeInTheDocument();
    expect(result.getByRole("link", { name: "Grafana openen in de editor" })).toBeInTheDocument();
    expect(publishFx).toHaveBeenCalledWith(submit);
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Klaar: 1 thema geïmporteerd." });
  });

  it("meldt overgeslagen bestanden en houdt eerdere resultaten bij", async () => {
    const api = localServer();
    renderPage(<ImportPage />, { path: "/import", server: api });
    await screen.findByRole("table");

    fireEvent.click(row("grafana.css").getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "1 bestand importeren" }));
    await waitFor(() => expect(document.querySelector("[data-imported]")).not.toBeNull());

    fireEvent.click(row("proxmox.css").getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "1 bestand importeren" }));
    const skipped = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-skipped="proxmox.css"]');
      if (!el) throw new Error("nog niet");
      return within(el);
    });
    expect(skipped.getByText("CSS bevat fouten (lint).")).toBeInTheDocument();
    // Het eerste resultaat staat er nog.
    expect(document.querySelector('[data-imported="grafana.css"]')).not.toBeNull();
    expect(screen.getByText("Resultaat").parentElement).toHaveTextContent("Resultaat (2)");
    expect(toastTexts()).toContainEqual({
      tone: "mid",
      text: "Klaar: 0 thema's, 1 bestand overgeslagen.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Resultaten wissen" }));
    expect(document.querySelector("[data-imported], [data-skipped]")).toBeNull();
  });

  it("toont een archiveerfout bij het thema", async () => {
    const api = localServer().on("POST", "/api/v1/themes/local-files/import", () =>
      json({
        imported: [imported("grafana.css", { archive_error: "Geen schrijfrechten op de map." })],
        skipped: [],
      }),
    );
    renderPage(<ImportPage />, { path: "/import", server: api });
    await screen.findByRole("table");
    fireEvent.click(row("grafana.css").getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "1 bestand importeren" }));
    expect(await screen.findByText("Geen schrijfrechten op de map.")).toBeInTheDocument();
    expect(screen.queryByText("gearchiveerd")).toBeNull();
  });

  it("toont een fout van de server als toast", async () => {
    const api = localServer().on("POST", "/api/v1/themes/local-files/import", () =>
      problem(500, "internal_error", { detail: "Database weg." }),
    );
    renderPage(<ImportPage />, { path: "/import", server: api });
    await screen.findByRole("table");
    fireEvent.click(row("grafana.css").getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "1 bestand importeren" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({ tone: "err", text: "Database weg." }),
    );
  });

  it("lege map en leesfout", async () => {
    const { unmount } = renderPage(<ImportPage />, { path: "/import" });
    expect(await screen.findByText("Geen .css-bestanden in de map.")).toBeInTheDocument();
    unmount();
    const failing = createServer().on("GET", "/api/v1/themes/local-files", () =>
      problem(500, "internal_error", { detail: "Map onleesbaar." }),
    );
    renderPage(<ImportPage />, { path: "/import", server: failing });
    expect(await screen.findByText("De bestanden konden niet gelezen worden")).toBeInTheDocument();
    expect(screen.getByText("Map onleesbaar.")).toBeInTheDocument();
  });
});

/** Kiest bestanden zoals de browser: een live FileList die leeg wordt als het veld gewist wordt. */
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
 * Een `.css`-bestand. jsdom + undici verliezen de bestandsnaam in multipart onderweg (de browser
 * niet), dus de inhoud is standaard de naam: zo herkent de nep-server het bestand.
 */
function cssFile(name: string, content = `/* ${name} */`) {
  return new File([content], name, { type: "text/css", lastModified: 1 });
}

/** Naam van het geüploade bestand, uit de inhoud (zie `cssFile`). */
async function uploadedName(form: FormData): Promise<string> {
  const text = await (form.get("file") as Blob).text();
  return /\/\* (.+) \*\//.exec(text)?.[1] ?? "";
}

function uploadServer() {
  return createServer().on("POST", "/api/v1/themes/import", async ({ body }) => {
    const form = body as FormData;
    const slug = (await uploadedName(form)).replace(/\.(cssthema\.zip|css)$/, "");
    if (slug === "kapot") {
      return problem(422, "theme_lint_failed", {
        detail: "De CSS bevat fouten.",
        errors: [
          {
            line: 1,
            column: 24,
            rule: "external-url",
            severity: "error",
            message: "Externe URL's zijn niet toegestaan.",
          },
        ],
      });
    }
    return json(
      makeTheme({ id: testId(800 + slug.length), slug, name: String(form.get("name") ?? slug) }),
      { status: slug === "bestaand" ? 200 : 201, headers: { ETag: '"lv-1"' } },
    );
  });
}

function uploadInput() {
  return screen.getByTestId("upload-input");
}

function uploadButton(count: number) {
  return screen.getByRole("button", {
    name: `${count} ${count === 1 ? "bestand" : "bestanden"} importeren`,
  });
}

describe("Import: uploaden", () => {
  it("de tab staat in de URL", () => {
    const { router } = renderPage(<ImportPage />, { path: "/import", server: uploadServer() });
    fireEvent.click(screen.getByRole("tab", { name: "⬆️ Uploaden" }));
    expect(currentUrl(router)).toBe("/import?tab=upload");
    expect(screen.getByRole("tab", { name: "⬆️ Uploaden" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useUiStore.getState().commandOverride).toBe("cssthema import --upload");
  });

  it("toont gekozen bestanden met soort en problemen", () => {
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: uploadServer() });
    pick(uploadInput(), [
      cssFile("proxmox.css"),
      new File(["PK"], "nord.cssthema.zip", { lastModified: 1 }),
      new File(["x"], "notities.txt", { lastModified: 1 }),
      new File([], "leeg.css", { lastModified: 1 }),
    ]);
    const list = within(screen.getByRole("list", { name: "Gekozen bestanden" }));
    expect(list.getAllByRole("listitem")).toHaveLength(4);
    const item = (name: string) =>
      within(document.querySelector<HTMLElement>(`[data-upload-file="${name}"]`)!);
    expect(item("proxmox.css").getByText("CSS")).toBeInTheDocument();
    expect(item("nord.cssthema.zip").getByText("bundel")).toBeInTheDocument();
    expect(item("notities.txt").getByText("geen .css of .zip")).toBeInTheDocument();
    expect(item("leeg.css").getByText("leeg bestand")).toBeInTheDocument();
    // Alleen de twee geldige tellen mee; de naam kan alleen bij één bestand.
    expect(uploadButton(2)).toBeEnabled();
    expect(screen.getByLabelText("Naam (optioneel)")).toBeDisabled();
    expect(screen.getByText("Alleen bij één bestand.")).toBeInTheDocument();
  });

  it("hetzelfde bestand opnieuw kiezen na verwijderen werkt (live FileList)", () => {
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: uploadServer() });
    pick(uploadInput(), [cssFile("proxmox.css")]);
    expect(document.querySelector('[data-upload-file="proxmox.css"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "proxmox.css uit de lijst halen" }));
    expect(document.querySelector('[data-upload-file="proxmox.css"]')).toBeNull();
    pick(uploadInput(), [cssFile("proxmox.css")]);
    expect(document.querySelector('[data-upload-file="proxmox.css"]')).not.toBeNull();
    // Dubbel kiezen voegt niets toe.
    pick(uploadInput(), [cssFile("proxmox.css")]);
    expect(document.querySelectorAll("[data-upload-file]")).toHaveLength(1);
  });

  it("slepen voegt bestanden toe", () => {
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: uploadServer() });
    const zone = document.querySelector<HTMLElement>("[data-dropzone]")!;
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(zone, { dataTransfer: { files: [cssFile("grafana.css")] } });
    expect(zone).not.toHaveAttribute("data-dragging");
    expect(document.querySelector('[data-upload-file="grafana.css"]')).not.toBeNull();
  });

  it("uploadt één .css met naam, conflictkeuze en publiceren", async () => {
    const publishFx = vi.spyOn(fx, "publish");
    const api = uploadServer().on("POST", "/api/v1/themes/import", () =>
      json(
        makeTheme({
          id: testId(901),
          slug: "mijn-proxmox",
          name: "Mijn Proxmox",
          status: "published",
          published_version: makeVersionSummary({ version_number: 1 }),
        }),
        { status: 201 },
      ),
    );
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: api });
    pick(uploadInput(), [cssFile("proxmox.css")]);
    fireEvent.change(screen.getByLabelText("Als de slug al bestaat"), {
      target: { value: "new_version" },
    });
    expect(
      screen.getByText("Vervangt de draft van het bestaande thema en maakt een versie."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Publiceren"), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Naam (optioneel)"), {
      target: { value: "Mijn Proxmox" },
    });
    fireEvent.click(uploadButton(1));

    const result = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-upload-result="proxmox.css"]');
      if (!el) throw new Error("nog niet");
      return within(el);
    });
    const form = api.callsTo("POST", "/api/v1/themes/import")[0]?.body as FormData;
    expect(await uploadedName(form)).toBe("proxmox.css");
    expect(form.get("on_conflict")).toBe("new_version");
    expect(form.get("publish")).toBe("true");
    expect(form.get("name")).toBe("Mijn Proxmox");

    expect(result.getByText("nieuw thema")).toBeInTheDocument();
    expect(result.getByText("v1 live")).toBeInTheDocument();
    expect(result.getByRole("link", { name: "Mijn Proxmox openen in de editor" })).toHaveAttribute(
      "href",
      `/editor/${testId(901)}`,
    );
    // Gelukte bestanden verdwijnen uit de lijst, het naamveld wordt leeg.
    expect(document.querySelector("[data-upload-file]")).toBeNull();
    expect(screen.getByLabelText("Naam (optioneel)")).toHaveValue("");
    expect(publishFx).toHaveBeenCalled();
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Klaar: 1 thema geïmporteerd." });
  });

  it("standaard stuurt het geen publish mee en geen naam bij meerdere bestanden", async () => {
    const api = uploadServer();
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: api });
    pick(uploadInput(), [cssFile("proxmox.css"), cssFile("bestaand.css")]);
    fireEvent.click(uploadButton(2));
    await waitFor(() => expect(document.querySelectorAll("[data-upload-result]")).toHaveLength(2));
    const forms = api.callsTo("POST", "/api/v1/themes/import").map((call) => call.body as FormData);
    expect(await Promise.all(forms.map(uploadedName))).toEqual(["proxmox.css", "bestaand.css"]);
    for (const form of forms) {
      expect(form.get("on_conflict")).toBe("rename");
      expect(form.has("publish")).toBe(false);
      expect(form.has("name")).toBe(false);
    }
    const existing = within(
      document.querySelector<HTMLElement>('[data-upload-result="bestaand.css"]')!,
    );
    expect(existing.getByText("nieuwe versie")).toBeInTheDocument();
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Klaar: 2 thema's geïmporteerd." });
  });

  it("een mislukte upload toont de lint-meldingen en blijft in de lijst", async () => {
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: uploadServer() });
    pick(uploadInput(), [cssFile("kapot.css"), cssFile("goed.css")]);
    fireEvent.click(uploadButton(2));
    const failed = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-upload-result="kapot.css"]');
      if (!el) throw new Error("nog niet");
      return within(el);
    });
    expect(failed.getByText("mislukt")).toBeInTheDocument();
    expect(failed.getByText(/De CSS bevat fouten\./)).toBeInTheDocument();
    expect(failed.getByText(/regel 1:24/)).toBeInTheDocument();
    expect(failed.getByText("external-url")).toBeInTheDocument();
    expect(failed.getByText(/Externe URL's zijn niet toegestaan\./)).toBeInTheDocument();

    expect(document.querySelector('[data-upload-file="kapot.css"]')).not.toBeNull();
    expect(document.querySelector('[data-upload-file="goed.css"]')).toBeNull();
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "mid",
        text: "Klaar: 1 thema geïmporteerd, 1 bestand mislukt.",
      }),
    );
  });

  it("in het Engels legt de naamhint uit wat er bij een bundel gebeurt", () => {
    setLocale("en");
    renderPage(<ImportPage />, { path: "/import?tab=upload", server: uploadServer() });
    pick(uploadInput(), [new File(["PK"], "nord.cssthema.zip", { lastModified: 1 })]);
    expect(
      screen.getByText(
        "Instead of the file name. For a .css it also sets the slug; for a bundle the slug comes from the bundle.",
      ),
    ).toBeInTheDocument();
    expect(uploadButton1En()).toBeEnabled();
  });
});

function uploadButton1En() {
  return screen.getByRole("button", { name: "Import 1 file" });
}
