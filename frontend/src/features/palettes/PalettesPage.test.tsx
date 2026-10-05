import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, problem } from "@/api/testing/fetch-mock";
import { makePalette, testId } from "@/api/testing/fixtures";
import { useUiStore } from "@/app/ui-store";
import { createServer, currentUrl, renderPage, toastTexts } from "@/features/themes/testing";
import { PalettesPage } from "./PalettesPage";

const terminal = makePalette({ id: testId(1), slug: "terminal", name: "Terminal", theme_count: 0 });
const nord = makePalette({
  id: testId(2),
  slug: "nord",
  name: "Nord",
  is_builtin: false,
  theme_count: 3,
  tokens: { fg: "#eceff4", bg: "#2e3440", radius: "6px", "font-mono": "monospace" },
});

function server() {
  return createServer().on("GET", "/api/v1/palettes", () => json([terminal, nord]));
}

function detail() {
  const el = document.querySelector<HTMLElement>("[data-palette-detail]");
  if (!el) throw new Error("geen detail");
  return el;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  // jsdom kent geen execCommand; tests die het nodig hebben zetten een eigen versie.
  Reflect.deleteProperty(document, "execCommand");
});

describe("PalettesPage", () => {
  it("toont de lijst en standaard het eerste palet", async () => {
    renderPage(<PalettesPage />, { path: "/palettes", server: server() });
    const nav = within(await screen.findByRole("navigation", { name: "Paletten" }));
    const links = nav.getAllByRole("link");
    expect(links[0]).toHaveAccessibleName("Terminal");
    // Het aantal thema's is voor schermlezers een zin, visueel alleen een getal.
    expect(links[1]).toHaveAccessibleName("Nord Gebruikt door 3 thema's");
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(detail().dataset.paletteDetail).toBe("terminal");
    expect(within(detail()).getByText("ingebouwd")).toBeInTheDocument();
    expect(within(detail()).getByText(/Nog door geen enkel thema gebruikt\./)).toBeInTheDocument();
    expect(useUiStore.getState().commandOverride).toBe("cssthema palettes terminal");
  });

  it("kiest een palet via de URL en toont tokens, gebruik en CSS", async () => {
    const { router } = renderPage(<PalettesPage />, { path: "/palettes", server: server() });
    const nav = within(await screen.findByRole("navigation", { name: "Paletten" }));
    fireEvent.click(nav.getByRole("link", { name: /Nord/ }));
    await waitFor(() => expect(detail().dataset.paletteDetail).toBe("nord"));
    expect(currentUrl(router)).toBe("/palettes?palette=nord");
    expect(nav.getByRole("link", { name: /Nord/ })).toHaveAttribute("aria-current", "page");

    const view = within(detail());
    expect(view.getByRole("heading", { level: 2, name: "Nord" })).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Gebruikt door 3 thema's →" })).toHaveAttribute(
      "href",
      `/themes?palette=${nord.id}`,
    );
    const table = view.getByRole("table", { name: "Tokens van Nord" });
    const rows = within(table).getAllByRole("row").slice(1);
    // Vaste volgorde: bg, fg, radius, font-mono.
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      expect.stringContaining("--ct-bg"),
      expect.stringContaining("--ct-fg"),
      expect.stringContaining("--ct-radius"),
      expect.stringContaining("--ct-font-mono"),
    ]);
    expect(document.querySelector("[data-palette-css]")).toHaveTextContent(
      ":root { --ct-bg: #2e3440; --ct-fg: #eceff4; --ct-radius: 6px; --ct-font-mono: monospace; }",
    );
  });

  it("kopieert een variabele en de CSS naar het klembord", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPage(<PalettesPage />, { path: "/palettes?palette=nord", server: server() });
    await waitFor(() => expect(detail().dataset.paletteDetail).toBe("nord"));
    fireEvent.click(screen.getByRole("button", { name: "var(--ct-bg) kopiëren" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("var(--ct-bg)"));
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "Gekopieerd: var(--ct-bg)" });

    fireEvent.click(within(detail()).getByRole("button", { name: "⧉ Kopiëren" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("--ct-bg: #2e3440;"));
  });

  it("meldt een mislukte kopie", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("nee")) },
    });
    document.execCommand = vi.fn(() => false);
    renderPage(<PalettesPage />, { path: "/palettes", server: server() });
    await screen.findByRole("navigation", { name: "Paletten" });
    fireEvent.click(screen.getByRole("button", { name: "var(--ct-bg) kopiëren" }));
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({
        tone: "err",
        text: "Kopiëren naar het klembord lukte niet.",
      }),
    );
  });

  it("onbekend palet in de URL valt terug op het eerste", async () => {
    renderPage(<PalettesPage />, { path: "/palettes?palette=bestaat-niet", server: server() });
    await waitFor(() => expect(detail().dataset.paletteDetail).toBe("terminal"));
  });

  it("toont een fout en een lege toestand", async () => {
    const failing = createServer().on("GET", "/api/v1/palettes", () =>
      problem(500, "internal_error", { detail: "Kapot." }),
    );
    const { unmount } = renderPage(<PalettesPage />, { path: "/palettes", server: failing });
    expect(await screen.findByText("De paletten konden niet geladen worden")).toBeInTheDocument();
    unmount();

    renderPage(<PalettesPage />, { path: "/palettes" });
    expect(await screen.findByText("Geen paletten gevonden.")).toBeInTheDocument();
  });
});
