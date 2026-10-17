import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { json } from "@/api/testing/fetch-mock";
import { makeTheme, makeVersionSummary, testId } from "@/api/testing/fixtures";
import type { ImportOutcome } from "@/api/types";
import { createServer, renderPage, toastTexts } from "@/features/themes/testing";
import { fx } from "@/lib/fx";
import { zipFile } from "../testing";
import { UploadPanel } from "./UploadPanel";

/** Kiest bestanden zoals de browser (een live FileList, zie ImportPage.test). */
function pick(chosen: File[]) {
  const input = screen.getByTestId("upload-input");
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

/** De inhoud is de naam: jsdom verliest de bestandsnaam in multipart (zie ImportPage.test). */
function cssFile(name: string) {
  return new File([`/* ${name} */`], name, { type: "text/css", lastModified: 1 });
}

async function uploadedName(form: FormData): Promise<string> {
  const text = await (form.get("file") as Blob).text();
  return /\/\* (.+) \*\//.exec(text)?.[1] ?? "";
}

/** Bestaande thema's `existing`; de import geeft per slug de `outcomes` terug (standaard nieuw). */
function server(existing: string[] = [], outcomes: Record<string, ImportOutcome> = {}) {
  return createServer()
    .on("GET", "/api/v1/themes", () =>
      json({ items: existing.map((slug) => makeTheme({ slug })), next_cursor: null }),
    )
    .on("POST", "/api/v1/themes/import", async ({ body }) => {
      const slug = (await uploadedName(body as FormData)).replace(/\.css$/, "");
      const outcome = outcomes[slug] ?? "created";
      return json(
        {
          ...makeTheme({
            id: testId(700 + slug.length),
            slug,
            name: slug,
            status: "published",
            published_version: makeVersionSummary({ version_number: 2 }),
          }),
          outcome,
        },
        { status: outcome === "created" ? 201 : 200, headers: { ETag: '"lv-1"' } },
      );
    });
}

const conflictSelect = () => screen.getByLabelText("Als de slug al bestaat");
const publishSelect = () => screen.getByLabelText("Publiceren");
const defaultsHint = () => document.querySelector<HTMLElement>("[data-upload-defaults]");

function uploadButton(count: number) {
  return screen.getByRole("button", {
    name: `${count} ${count === 1 ? "bestand" : "bestanden"} importeren`,
  });
}

function resultRow(file: string) {
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[data-upload-result="${file}"]`);
    if (!el) throw new Error(`nog geen resultaat voor ${file}`);
    return within(el);
  });
}

describe("UploadPanel: standaardkeuzes", () => {
  it("een uitgepakte zip wordt een nieuwe versie die meteen live gaat", async () => {
    const api = server();
    renderPage(<UploadPanel />, { path: "/import", server: api });
    pick([
      await zipFile("themes.zip", [
        { name: "themes/modules/alg-kern.css", data: "/* alg-kern.css */" },
        { name: "themes/apps/alg-adguard.css", data: "/* alg-adguard.css */" },
      ]),
    ]);
    await waitFor(() => expect(document.querySelectorAll("[data-upload-file]")).toHaveLength(2));
    expect(conflictSelect()).toHaveValue("new_version");
    expect(publishSelect()).toHaveValue("yes");
    expect(defaultsHint()).toHaveAttribute("data-upload-defaults", "zip");
    expect(defaultsHint()).toHaveTextContent(/^Uitgepakte zip: bij een bestaande naam/);

    fireEvent.click(uploadButton(2));
    await resultRow("alg-adguard.css");
    for (const call of api.callsTo("POST", "/api/v1/themes/import")) {
      const form = call.body as FormData;
      expect(form.get("on_conflict")).toBe("new_version");
      expect(form.get("publish")).toBe("true");
    }
  });

  it("losse bestanden met de naam van bestaande thema's: ook nieuwe versie en publiceren", async () => {
    const api = server(["alg-kern", "algemeen"]);
    renderPage(<UploadPanel />, { path: "/import", server: api });
    pick([cssFile("alg-kern.css"), cssFile("Algemeen.css")]);
    await waitFor(() => expect(conflictSelect()).toHaveValue("new_version"));
    expect(publishSelect()).toHaveValue("yes");
    expect(defaultsHint()).toHaveTextContent(/^2 bestanden hebben de naam van een bestaand thema/);
    // Eén nieuwe naam erbij: dan de gewone standaard (geen stille nieuwe versies).
    pick([cssFile("nieuw.css")]);
    await waitFor(() => expect(conflictSelect()).toHaveValue("rename"));
    expect(publishSelect()).toHaveValue("auto");
    expect(defaultsHint()).toBeNull();
    // De lijst met thema's wordt maar één keer opgehaald.
    expect(api.callsTo("GET", "/api/v1/themes")).toHaveLength(1);
    expect(api.callsTo("GET", "/api/v1/themes")[0]!.url.searchParams.get("limit")).toBe("200");
  });

  it("een eigen keuze gaat voor, en een bundel houdt de gewone standaard", async () => {
    const api = server(["proxmox"]);
    renderPage(<UploadPanel />, { path: "/import", server: api });
    pick([cssFile("proxmox.css")]);
    await waitFor(() => expect(conflictSelect()).toHaveValue("new_version"));
    fireEvent.change(publishSelect(), { target: { value: "no" } });
    expect(publishSelect()).toHaveValue("no");
    expect(conflictSelect()).toHaveValue("new_version");
    fireEvent.change(conflictSelect(), { target: { value: "rename" } });
    expect(defaultsHint()).toBeNull();
    fireEvent.click(uploadButton(1));
    await resultRow("proxmox.css");
    const form = api.callsTo("POST", "/api/v1/themes/import")[0]!.body as FormData;
    expect(form.get("on_conflict")).toBe("rename");
    expect(form.get("publish")).toBe("false");
  });

  it("een bundel in de lijst: geen andere standaard", async () => {
    renderPage(<UploadPanel />, { path: "/import", server: server(["proxmox"]) });
    pick([cssFile("proxmox.css"), new File(["PK"], "nord.cssthema.zip", { lastModified: 1 })]);
    await waitFor(() => expect(defaultsHint()).toBeNull());
    expect(conflictSelect()).toHaveValue("rename");
    expect(publishSelect()).toHaveValue("auto");
  });
});

describe("UploadPanel: ongewijzigd", () => {
  it("een bestand gelijk aan de laatste versie heet ongewijzigd, zonder publiceer-effect", async () => {
    const publishFx = vi.spyOn(fx, "publish");
    const api = server(["alg-kern"], { "alg-kern": "unchanged" });
    renderPage(<UploadPanel />, { path: "/import", server: api });
    pick([cssFile("alg-kern.css")]);
    await waitFor(() => expect(conflictSelect()).toHaveValue("new_version"));
    fireEvent.click(uploadButton(1));
    const row = await resultRow("alg-kern.css");
    expect(row.getByText("ongewijzigd")).toBeInTheDocument();
    expect(
      row.getByText("Gelijk aan de laatste versie: er is niets opgeslagen of gepubliceerd."),
    ).toBeInTheDocument();
    expect(publishFx).not.toHaveBeenCalled();
    expect(toastTexts()).toContainEqual({
      tone: "default",
      text: "Niets veranderd: het bestand is gelijk aan de laatste versie.",
    });
  });

  it("telt ongewijzigde bestanden apart in de melding", async () => {
    const api = server(["alg-kern", "algemeen"], {
      "alg-kern": "unchanged",
      algemeen: "new_version",
    });
    renderPage(<UploadPanel />, { path: "/import", server: api });
    pick([cssFile("alg-kern.css"), cssFile("algemeen.css")]);
    await waitFor(() => expect(conflictSelect()).toHaveValue("new_version"));
    fireEvent.click(uploadButton(2));
    expect((await resultRow("algemeen.css")).getByText("nieuwe versie")).toBeInTheDocument();
    expect((await resultRow("alg-kern.css")).getByText("ongewijzigd")).toBeInTheDocument();
    expect(toastTexts()).toContainEqual({
      tone: "ok",
      text: "Klaar: 1 thema geïmporteerd. 1 bestand was gelijk aan de laatste versie (ongewijzigd).",
    });
  });
});
