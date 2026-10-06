import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, noContent, problem } from "@/api/testing/fetch-mock";
import { makeDashboard, makeScript } from "@/api/testing/fixtures";
import type { ScriptFile } from "@/api/types";
import { useUiStore } from "@/app/ui-store";
import { createServer, currentUrl, renderPage, toastTexts } from "@/features/themes/testing";
import { fx } from "@/lib/fx";
import { ImportPage } from "./ImportPage";

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

/** Nep-api met een veranderlijke lijst scripts (uploaden en verwijderen werken hem bij). */
function scriptsServer(initial: ScriptFile[] = defaultScripts()) {
  let scripts = [...initial];
  const api = createServer()
    .on("GET", "/api/v1/dashboard", () =>
      json(makeDashboard({ local_files: { dir: "/srv/css-files", total: 0, importable: 0 } })),
    )
    .on("GET", "/api/v1/scripts", () => json(scripts))
    .on(
      "GET",
      "/api/v1/scripts/:name",
      ({ params }) =>
        new Response(`/* ${params.name} */\nconsole.log(1);\n`, {
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        }),
    )
    .on("DELETE", "/api/v1/scripts/:name", ({ params }) => {
      scripts = scripts.filter((script) => script.name !== params.name);
      return noContent();
    })
    .on("POST", "/api/v1/scripts", async ({ body }) => {
      const form = body as FormData;
      // jsdom verliest de bestandsnaam onderweg: de inhoud is de naam (`/* naam */`).
      const text = await (form.get("file") as Blob).text();
      const name = String(form.get("name") ?? "") || (/\/\* (.+)\.js \*\//.exec(text)?.[1] ?? "");
      const exists = scripts.some((script) => script.name === name);
      if (exists && form.get("replace") !== "true") {
        return problem(409, "script_conflict", {
          detail: `Er staat al een script ${name}.js.`,
          name,
        });
      }
      const script = makeScript({ name, size_bytes: text.length });
      scripts = [...scripts.filter((item) => item.name !== name), script];
      return json(script, { status: exists ? 200 : 201 });
    });
  return api;
}

function defaultScripts(): ScriptFile[] {
  return [
    makeScript(),
    makeScript({ name: "handmatig", size_bytes: 26, world_readable: false }),
    makeScript({ name: "klok-widget", size_bytes: 254, sha256: null }),
  ];
}

function jsFile(name: string) {
  return new File([`/* ${name} */`], name, { type: "text/javascript", lastModified: 1 });
}

/** Kiest bestanden zoals de browser (zie ImportPage.test.tsx). */
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
 * Zoals de browser het doet als een knop met focus uit (disabled) gaat: de focus valt naar
 * <body>. jsdom doet dat niet, en `blur()` werkt er niet op een knop die uit staat.
 */
function loseFocus() {
  const probe = document.createElement("input");
  document.body.append(probe);
  probe.focus();
  probe.remove();
}

async function row(name: string) {
  const el = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-script="${name}"]`);
    if (!found) throw new Error(`geen rij ${name}`);
    return found;
  });
  return { el, ...within(el) };
}

describe("Import: tab Scripts", () => {
  it("de tab staat in de URL en zet het commando", async () => {
    const { router } = renderPage(<ImportPage />, { path: "/import", server: scriptsServer() });
    fireEvent.click(screen.getByRole("tab", { name: "📜 Scripts" }));
    expect(currentUrl(router)).toBe("/import?tab=scripts");
    expect(useUiStore.getState().commandOverride).toBe("cssthema scripts");
    await row("algemeen");
  });

  it("toont de scripts met URL, grootte, hash en een waarschuwing voor nginx", async () => {
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: scriptsServer() });
    const algemeen = await row("algemeen");
    expect(screen.getByText("3 scripts, publiek op /<naam>.js.")).toBeInTheDocument();
    expect(algemeen.getByText("algemeen.js")).toBeInTheDocument();
    expect(algemeen.getByText("live")).toBeInTheDocument();
    expect(algemeen.getByText("https://css.example/algemeen.js")).toBeInTheDocument();
    expect(algemeen.getByText(/1,5 KB/)).toBeInTheDocument();
    expect(algemeen.getByText(/sha256 a5e330f6b1a4/)).toBeInTheDocument();
    expect(algemeen.queryByText(/chmod/)).toBeNull();

    const hand = await row("handmatig");
    expect(hand.getByText("niet leesbaar voor nginx")).toBeInTheDocument();
    expect(
      hand.getByText(
        /nginx kan dit bestand niet lezen, dus \/handmatig\.js geeft 403\. Op de server: chmod 0644 \/srv\/css-files\/handmatig\.js/,
      ),
    ).toBeInTheDocument();

    // Zonder hash (te groot of onleesbaar voor de api) geen hash-regel.
    expect((await row("klok-widget")).queryByText(/sha256/)).toBeNull();
  });

  it("kopieert de publieke URL", async () => {
    const writeText = stubClipboard();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: scriptsServer() });
    const algemeen = await row("algemeen");
    fireEvent.click(algemeen.getByRole("button", { name: "URL van algemeen.js kopiëren" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "Gekopieerd: https://css.example/algemeen.js",
      }),
    );
    expect(writeText).toHaveBeenCalledWith("https://css.example/algemeen.js");
  });

  it("bekijken toont de inhoud; sluiten zet de focus terug", async () => {
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const algemeen = await row("algemeen");
    const open = algemeen.getByRole("button", { name: "algemeen.js bekijken" });
    open.focus();
    fireEvent.click(open);

    const dialog = await screen.findByRole("dialog", { name: "algemeen.js" });
    await waitFor(() =>
      expect(dialog.querySelector("[data-script-content]")).toHaveTextContent(
        "/* algemeen */ console.log(1);",
      ),
    );
    expect(dialog).toHaveTextContent("2 regels");
    expect(dialog).toHaveTextContent("https://css.example/algemeen.js");
    expect(api.callsTo("GET", "/api/v1/scripts/:name")[0]?.path).toBe("/api/v1/scripts/algemeen");

    fireEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
    expect(api.callsTo("GET", "/api/v1/scripts/:name")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveFocus();
  });

  it("downloaden vraagt de bijlage op", async () => {
    // jsdom kent geen object-URL's; het opslaan zelf faken we.
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const api = scriptsServer();
      renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
      const algemeen = await row("algemeen");
      fireEvent.click(algemeen.getByRole("button", { name: "algemeen.js downloaden" }));
      await waitFor(() =>
        expect(toastTexts()).toContainEqual({ tone: "ok", text: "Gedownload: algemeen.js" }),
      );
      const call = api.callsTo("GET", "/api/v1/scripts/:name")[0]!;
      expect(call.url.searchParams.get("download")).toBe("true");
      expect(click).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = urls.create;
      URL.revokeObjectURL = urls.revoke;
    }
  });

  it("na Vervangen… staat de focus weer op de knop van de rij", async () => {
    const api = scriptsServer();
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => (finish = resolve));
    api.on("POST", "/api/v1/scripts", async () => {
      await gate;
      return json(makeScript(), { status: 200 });
    });
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const algemeen = await row("algemeen");
    const input = screen.getByTestId("script-replace-input");
    vi.spyOn(input, "click").mockImplementation(() => {});
    const replace = algemeen.getByRole("button", {
      name: "algemeen.js vervangen door een ander bestand",
    });
    replace.focus();
    fireEvent.click(replace);
    pick(input, [jsFile("nieuwe-versie.js")]);
    await waitFor(() => expect(replace).toBeDisabled());
    act(() => loseFocus());
    expect(document.activeElement).toBe(document.body);

    finish();
    await waitFor(() => expect(replace).toBeEnabled());
    await waitFor(() => expect(replace).toHaveFocus());
  });

  it("vervangen uploadt onder dezelfde naam met replace=true", async () => {
    const publishFx = vi.spyOn(fx, "publish");
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const algemeen = await row("algemeen");
    const input = screen.getByTestId("script-replace-input");
    const chooser = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(
      algemeen.getByRole("button", { name: "algemeen.js vervangen door een ander bestand" }),
    );
    expect(chooser).toHaveBeenCalled();
    pick(input, [jsFile("nieuwe-versie.js")]);

    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "algemeen.js vervangen; de vorige versie staat in .scripts-archief/.",
      }),
    );
    const form = api.callsTo("POST", "/api/v1/scripts")[0]!.body as FormData;
    expect(form.get("name")).toBe("algemeen");
    expect(form.get("replace")).toBe("true");
    // Geen vraag: wie "Vervangen…" kiest, wil vervangen.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishFx).toHaveBeenCalledWith(algemeen.el);
  });

  it("een ander bestandstype vervangt niets", async () => {
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const algemeen = await row("algemeen");
    vi.spyOn(screen.getByTestId("script-replace-input"), "click").mockImplementation(() => {});
    fireEvent.click(
      algemeen.getByRole("button", { name: "algemeen.js vervangen door een ander bestand" }),
    );
    pick(screen.getByTestId("script-replace-input"), [
      new File(["body{}"], "thema.css", { lastModified: 1 }),
    ]);
    expect(toastTexts()).toContainEqual({
      tone: "err",
      text: "thema.css: Geen JavaScript: upload een .js-bestand.",
    });
    expect(api.callsTo("POST", "/api/v1/scripts")).toHaveLength(0);
  });

  it("verwijderen: bevestigen, bliksem, DELETE, rij weg en focus op de lijst", async () => {
    const remove = vi.spyOn(fx, "remove").mockResolvedValue();
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const klok = await row("klok-widget");
    fireEvent.click(klok.getByRole("button", { name: "klok-widget.js verwijderen" }));

    const dialog = screen.getByRole("dialog", { name: "klok-widget.js verwijderen?" });
    expect(dialog).toHaveTextContent(
      "Het bestand gaat naar .scripts-archief/ op de server (het wordt niet gewist). https://css.example/klok-widget.js geeft daarna 404: apps die het script laden, missen het tot je het opnieuw uploadt.",
    );
    expect(within(dialog).getByRole("button", { name: "Annuleren" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "⚡ Verwijderen" }));

    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "klok-widget.js verwijderd; het staat in .scripts-archief/.",
      }),
    );
    expect(api.callsTo("DELETE", "/api/v1/scripts/:name")[0]?.path).toBe(
      "/api/v1/scripts/klok-widget",
    );
    expect(remove).toHaveBeenCalledWith(klok.el);
    await waitFor(() => expect(document.querySelector('[data-script="klok-widget"]')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: /Scripts op de server/ }),
      ),
    );
  });

  it("verwijderen dat mislukt toont de fout en laat de rij staan", async () => {
    vi.spyOn(fx, "remove").mockResolvedValue();
    const unzap = vi.spyOn(fx, "unzap");
    const api = scriptsServer().on("DELETE", "/api/v1/scripts/:name", () =>
      problem(500, "storage_error", { detail: "algemeen.js kon niet gearchiveerd worden." }),
    );
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const algemeen = await row("algemeen");
    fireEvent.click(algemeen.getByRole("button", { name: "algemeen.js verwijderen" }));
    fireEvent.click(screen.getByRole("button", { name: "⚡ Verwijderen" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "err",
        text: "algemeen.js kon niet gearchiveerd worden.",
      }),
    );
    expect(unzap).toHaveBeenCalledWith(algemeen.el);
    expect(document.querySelector('[data-script="algemeen"]')).not.toBeNull();
  });

  it("verwijderen van een script dat al weg is (404): rij weg, rustige melding", async () => {
    vi.spyOn(fx, "remove").mockResolvedValue();
    const unzap = vi.spyOn(fx, "unzap");
    // Met de hand verwijderd (scp/rm): de server kent het niet meer, de lijst nog wel.
    let listed = defaultScripts();
    const api = scriptsServer()
      .on("GET", "/api/v1/scripts", () => json(listed))
      .on("DELETE", "/api/v1/scripts/:name", () =>
        problem(404, "not_found", { detail: "Er staat geen script algemeen.js in de map." }),
      );
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    await row("algemeen");
    listed = listed.filter((script) => script.name !== "algemeen");
    fireEvent.click(screen.getByRole("button", { name: "algemeen.js verwijderen" }));
    fireEvent.click(screen.getByRole("button", { name: "⚡ Verwijderen" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "default",
        text: "algemeen.js staat niet meer in de map (met de hand verwijderd?); de lijst is bijgewerkt.",
      }),
    );
    await waitFor(() => expect(document.querySelector('[data-script="algemeen"]')).toBeNull());
    expect(unzap).not.toHaveBeenCalled();
    expect(toastTexts().filter((item) => item.tone === "err")).toEqual([]);
    expect(screen.getByText("2 scripts, publiek op /<naam>.js.")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: /Scripts op de server/ }),
      ),
    );
  });

  it("downloaden of bekijken van een script dat al weg is: fout en de rij verdwijnt", async () => {
    // Met de hand verwijderd: de server kent ze niet meer, de lijst in het dashboard nog wel.
    let listed = defaultScripts();
    const api = scriptsServer()
      .on("GET", "/api/v1/scripts", () => json(listed))
      .on("GET", "/api/v1/scripts/:name", ({ params }) =>
        problem(404, "not_found", { detail: `Er staat geen script ${params.name}.js in de map.` }),
      );
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    const klok = await row("klok-widget");
    listed = listed.filter((script) => script.name !== "klok-widget");

    fireEvent.click(klok.getByRole("button", { name: "klok-widget.js downloaden" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "err",
        text: "klok-widget.js staat niet meer in de map (met de hand verwijderd?); de lijst is bijgewerkt.",
      }),
    );
    await waitFor(() => expect(document.querySelector('[data-script="klok-widget"]')).toBeNull());

    // Bekijken: de dialoog toont de fout en de rij verdwijnt; sluiten zet de focus op de lijst
    // (de knop "Bekijken" die de dialoog opende, is weg).
    const view = (await row("handmatig")).getByRole("button", { name: "handmatig.js bekijken" });
    listed = listed.filter((script) => script.name !== "handmatig");
    view.focus();
    fireEvent.click(view);
    const dialog = await screen.findByRole("dialog", { name: "handmatig.js" });
    expect(
      await within(dialog).findByText("Er staat geen script handmatig.js in de map."),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-script="handmatig"]')).toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: "Sluiten" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("region", { name: /Scripts op de server/ }),
      ),
    );
    expect(screen.getByText("1 script, publiek op /<naam>.js.")).toBeInTheDocument();
  });

  it("uploaden vanuit de tab, met de vervangvraag bij een bestaande naam", async () => {
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    await row("algemeen");
    const input = screen.getByTestId("script-upload-input");
    pick(input, [jsFile("algemeen.js"), jsFile("nieuw.js")]);

    const dialog = await screen.findByRole("dialog", { name: "algemeen.js bestaat al" });
    fireEvent.click(within(dialog).getByRole("button", { name: "⟳ Vervangen" }));
    await row("nieuw");
    const calls = api.callsTo("POST", "/api/v1/scripts");
    expect(calls).toHaveLength(3);
    expect((calls[1]!.body as FormData).get("replace")).toBe("true");
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Klaar: 2 scripts geïmporteerd." });
    expect(screen.getByText("4 scripts, publiek op /<naam>.js.")).toBeInTheDocument();
  });

  it("na de vervangvraag staat de focus weer op de uploadknop", async () => {
    const api = scriptsServer();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    await row("algemeen");
    const button = screen.getByRole("button", { name: /Script uploaden/ });
    button.focus();
    pick(screen.getByTestId("script-upload-input"), [jsFile("algemeen.js")]);

    const dialog = await screen.findByRole("dialog", { name: "algemeen.js bestaat al" });
    // De dialoog onthoudt de uploadknop als opener, maar die staat uit tot de upload klaar is.
    expect(button).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "⟳ Vervangen" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "algemeen.js vervangen; de vorige versie staat in .scripts-archief/.",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Script uploaden/ })).toHaveFocus(),
    );
  });

  it("lege map: uitleg, uploadknop en het snippet met /algemeen.js als voorbeeld", async () => {
    const api = scriptsServer([]);
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    expect(await screen.findByText("Nog geen scripts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Script uploaden/ })).toBeEnabled();
    await waitFor(() =>
      expect(document.querySelector("[data-snippet-code]")).toHaveTextContent(
        '<script src="https://css.example/algemeen.js" defer></script>',
      ),
    );

    pick(screen.getByTestId("script-upload-input"), [jsFile("algemeen.js")]);
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "ok",
        text: "algemeen.js staat live op https://css.example/algemeen.js",
      }),
    );
    await row("algemeen");
  });

  it("leesfout van de map, en opnieuw proberen", async () => {
    let broken = true;
    const api = scriptsServer().on("GET", "/api/v1/scripts", () =>
      broken
        ? problem(503, "storage_unavailable", {
            title: "CSS_FILES_DIR is geen map",
            detail: "/srv/css-files is geen map.",
          })
        : json([makeScript()]),
    );
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: api });
    expect(await screen.findByText("De scripts konden niet gelezen worden")).toBeInTheDocument();
    expect(screen.getByText("/srv/css-files is geen map.")).toBeInTheDocument();
    expect(document.querySelector("[data-snippet]")).toBeNull();

    broken = false;
    fireEvent.click(screen.getByRole("button", { name: /Vernieuwen/ }));
    await row("algemeen");
    expect(document.querySelector("[data-snippet]")).not.toBeNull();
  });

  it("snippet: thema vrij te kiezen, script te kiezen, kopiëren en de waarschuwing", async () => {
    const writeText = stubClipboard();
    renderPage(<ImportPage />, { path: "/import?tab=scripts", server: scriptsServer() });
    await row("algemeen");
    const code = () => document.querySelector("[data-snippet-code]")?.textContent ?? "";
    expect(code()).toContain(
      `sub_filter '</head>' '<link rel="stylesheet" href="https://css.example/algemeen.css">` +
        `<script src="https://css.example/algemeen.js" defer></script></head>';`,
    );
    expect(code()).toContain('proxy_set_header Accept-Encoding "";');
    expect(code()).toContain("sub_filter_once on;");

    fireEvent.change(screen.getByLabelText("Thema (slug)"), { target: { value: "Nord Donker" } });
    expect(code()).toContain('href="https://css.example/nord-donker.css"');
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "klok-widget" } });
    expect(code()).toContain('<script src="https://css.example/klok-widget.js" defer>');
    fireEvent.change(screen.getByLabelText("Thema (slug)"), { target: { value: "" } });
    expect(code()).not.toContain("<link");

    fireEvent.click(screen.getByRole("button", { name: /Snippet kopiëren/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code()));
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Snippet gekopieerd." });
    expect(
      screen.getByText(/injecteer ze niet in wachtwoordkluizen \(Vaultwarden, …\)/),
    ).toBeInTheDocument();
  });
});
