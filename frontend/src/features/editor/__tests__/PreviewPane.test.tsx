import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchMock, type FetchMock, json, problem } from "@/api/testing/fetch-mock";
import {
  makeServiceSummary,
  makeSnapshotDocument,
  makeSnapshotSummary,
  makeTheme,
} from "@/api/testing/fixtures";
import { createQueryWrapper } from "@/api/testing/query";
import { STORAGE_PREFIX } from "@/lib/storage";
import { resetBridgeCache } from "../preview/bridge";
import { PreviewPane } from "../preview/PreviewPane";
import { PREVIEW_SOURCE_STORAGE_KEY, usePreviewSourceStore } from "../preview/source";
import { DEFAULT_LAYOUT, useEditorStore, VIEWPORT_LIMITS } from "../store";
import BRIDGE from "../../../../public/preview-bridge.js?raw";

let server: FetchMock;

beforeEach(() => {
  resetBridgeCache();
  usePreviewSourceStore.setState({ choices: {} });
  server = createFetchMock().on(
    "GET",
    "/preview-bridge.js",
    () => new Response(BRIDGE, { status: 200 }),
  );
  vi.stubGlobal("fetch", server.fetch);
  useEditorStore.setState({
    layout: { ...DEFAULT_LAYOUT, viewport: "custom", customViewport: { width: 1024, height: 768 } },
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ tabs: [], layout: DEFAULT_LAYOUT });
  usePreviewSourceStore.setState({ choices: {} });
});

/** Met een eigen QueryClient (de keuzelijst haalt diensten en snapshots op). */
function renderPane(ui: ReactElement) {
  return render(ui, { wrapper: createQueryWrapper() });
}

describe("PreviewPane: eigen viewport", () => {
  it("shows the clamped value the preview really uses (Enter and blur)", () => {
    renderPane(<PreviewPane session={undefined} paletteTokens={null} />);
    const width = screen.getByRole("spinbutton", { name: "Breedte in pixels" });
    const height = screen.getByRole("spinbutton", { name: "Hoogte in pixels" });

    fireEvent.change(width, { target: { value: "100" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);
    expect(useEditorStore.getState().layout.customViewport.width).toBe(VIEWPORT_LIMITS.min);

    fireEvent.change(height, { target: { value: "99999" } });
    fireEvent.blur(height);
    expect(height).toHaveValue(VIEWPORT_LIMITS.max);
    expect(useEditorStore.getState().layout.customViewport.height).toBe(VIEWPORT_LIMITS.max);

    // Nog eens te klein terwijl de opgeslagen waarde al het minimum is: het veld volgt toch.
    fireEvent.change(width, { target: { value: "50" } });
    fireEvent.blur(width);
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);

    // Ongeldige invoer: terug naar de huidige maat.
    fireEvent.change(width, { target: { value: "" } });
    fireEvent.blur(width);
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);
  });
});

describe("PreviewPane: te grote CSS", () => {
  it("shows a notice and makes the frame visible when the bridge refuses the CSS", async () => {
    const { container } = renderPane(<PreviewPane session={undefined} paletteTokens={null} />);
    const frame = await vi.waitFor(() => {
      const element = container.querySelector("iframe");
      if (!element?.contentWindow) throw new Error("nog geen iframe");
      return element;
    });
    expect(frame).toHaveAttribute("data-ready", "false");
    const fromFrame = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
      });

    fromFrame({ type: "cssthema:too-large", kind: "css", max: 2 * 1024 * 1024 });
    expect(screen.getByText("De CSS is te groot voor de live preview")).toBeInTheDocument();
    expect(screen.getByText(/neemt CSS tot 2 MB aan/)).toBeInTheDocument();
    expect(frame).toHaveAttribute("data-ready", "true");

    // Weer klein genoeg: de melding verdwijnt.
    fromFrame({ type: "cssthema:applied", seq: 1 });
    expect(screen.queryByText("De CSS is te groot voor de live preview")).toBeNull();
    expect(frame).toHaveAttribute("data-ready", "true");
  });
});

// --- bron: demo-pagina of snapshot ----------------------------------------------------------------

const proxmoxSnapshot = makeSnapshotSummary({ page: "start", title: "Proxmox VE" });
const proxmox = makeServiceSummary({
  hostname: "proxmox.lan",
  slug: "proxmox-lan",
  snapshots: [
    proxmoxSnapshot,
    makeSnapshotSummary({ page: "oud", title: null }),
    makeSnapshotSummary({ page: "zonder-html", has_document: false }),
  ],
});
const grafanaSnapshot = makeSnapshotSummary({ page: "dashboard", title: "Grafana" });
const grafana = makeServiceSummary({
  hostname: "grafana.lan",
  slug: "grafana-lan",
  snapshots: [grafanaSnapshot],
});
/** Alleen een snapshot zonder document: staat niet in de lijst. */
const bare = makeServiceSummary({
  hostname: "kaal.lan",
  slug: "kaal-lan",
  snapshots: [makeSnapshotSummary({ has_document: false })],
});

function serve(services = [proxmox, grafana, bare]) {
  server
    .on("GET", "/api/v1/services", json(services))
    .on("GET", "/api/v1/snapshots/:id/document", ({ params }) =>
      json(
        makeSnapshotDocument({
          id: params.id,
          hostname: params.id === grafanaSnapshot.id ? "grafana.lan" : "proxmox.lan",
          html:
            '<html class="app-root"><body class="app-body" onload="evil()">' +
            `<main class="page-${params.id}">Snapshot ${params.id}</main>` +
            "<script>evil()</script></body></html>",
          stylesheets: [".app-body{margin:0}"],
        }),
      ),
    );
}

const picker = () => screen.getByRole("combobox", { name: "Bron van de preview" });

async function frameDoc(container: HTMLElement): Promise<string> {
  return vi.waitFor(() => {
    const doc = container.querySelector("iframe")?.getAttribute("srcdoc");
    if (!doc) throw new Error("nog geen srcdoc");
    return doc;
  });
}

describe("PreviewPane: bron van de preview", () => {
  it("shows the demo page without a picker when there is no theme", async () => {
    const { container } = renderPane(<PreviewPane session={undefined} paletteTokens={null} />);
    expect(await frameDoc(container)).toContain('id="ct-demo-base"');
    expect(screen.queryByRole("combobox", { name: "Bron van de preview" })).toBeNull();
    expect(server.callsTo("GET", "/api/v1/services")).toHaveLength(0);
  });

  it("starts on the newest snapshot of the service the theme is linked to", async () => {
    serve();
    const theme = makeTheme({ slug: "iets-anders", service_id: proxmox.id });
    const { container } = renderPane(
      <PreviewPane session={undefined} paletteTokens={null} theme={theme} />,
    );
    await waitFor(() => expect(picker()).toHaveValue(proxmoxSnapshot.id));
    const doc = await frameDoc(container);
    expect(doc).toContain(`Snapshot ${proxmoxSnapshot.id}`);
    expect(doc).toContain(".app-body{margin:0}");
    expect(doc).not.toContain("ct-demo-base");
    expect(doc).not.toMatch(/evil|onload/);
    expect(server.callsTo("GET", `/api/v1/snapshots/${proxmoxSnapshot.id}/document`)).toHaveLength(
      1,
    );
    expect(container.querySelector("iframe")).toHaveAttribute(
      "title",
      "Preview van het thema op proxmox.lan · start",
    );

    // Gegroepeerd per dienst (hostnaam); snapshots zonder document en lege diensten niet.
    const groups = Array.from(picker().querySelectorAll("optgroup"), (group) => group.label);
    expect(groups).toEqual(["grafana.lan", "proxmox.lan"]);
    const options = Array.from(picker().querySelectorAll("option"), (option) => option.text);
    expect(options).toEqual(["Demopagina", "dashboard · Grafana", "start · Proxmox VE", "oud"]);
  });

  it("guesses the service from the theme slug (alg-<x> or <x>)", async () => {
    serve();
    const theme = makeTheme({ slug: "alg-grafana", service_id: null });
    const { container } = renderPane(
      <PreviewPane session={undefined} paletteTokens={null} theme={theme} />,
    );
    await waitFor(() => expect(picker()).toHaveValue(grafanaSnapshot.id));
    expect(await frameDoc(container)).toContain(`Snapshot ${grafanaSnapshot.id}`);
  });

  it("falls back to the demo page, loads a chosen snapshot and remembers the choice", async () => {
    serve();
    const theme = makeTheme({ slug: "nord", service_id: null });
    const first = renderPane(
      <PreviewPane session={undefined} paletteTokens={null} theme={theme} />,
    );
    await waitFor(() => expect(picker()).toHaveValue("demo"));
    expect(await frameDoc(first.container)).toContain('id="ct-demo-base"');
    expect(server.callsTo("GET", "/api/v1/snapshots/:id/document")).toHaveLength(0);

    fireEvent.change(picker(), { target: { value: grafanaSnapshot.id } });
    expect(await screen.findByText("Snapshot laden…")).toBeInTheDocument();
    await waitFor(() =>
      expect(first.container.querySelector("iframe")?.getAttribute("srcdoc")).toContain(
        `Snapshot ${grafanaSnapshot.id}`,
      ),
    );
    const calls = server.callsTo("GET", "/api/v1/snapshots/:id/document");
    expect(calls.map((call) => call.path)).toEqual([
      `/api/v1/snapshots/${grafanaSnapshot.id}/document`,
    ]);
    expect(
      JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${PREVIEW_SOURCE_STORAGE_KEY}`) ?? "{}"),
    ).toMatchObject({ state: { choices: { [theme.id]: grafanaSnapshot.id } } });

    // Terug naar de demo, en opnieuw openen: de keuze blijft.
    fireEvent.change(picker(), { target: { value: "demo" } });
    expect(await frameDoc(first.container)).toContain('id="ct-demo-base"');
    first.unmount();
    renderPane(<PreviewPane session={undefined} paletteTokens={null} theme={theme} />);
    await waitFor(() => expect(picker()).toHaveValue("demo"));
  });

  it("says so when no service has a snapshot to preview against yet", async () => {
    serve([bare]);
    const theme = makeTheme({ slug: "kaal", service_id: null });
    renderPane(<PreviewPane session={undefined} paletteTokens={null} theme={theme} />);
    const hint = await screen.findByRole("option", {
      name: "Nog geen snapshots (importeer een capture)",
    });
    expect(hint).toBeDisabled();
    expect(picker()).toHaveValue("demo");
  });

  it("explains a missing snapshot document and offers the demo page", async () => {
    serve();
    server.on("GET", "/api/v1/snapshots/:id/document", () =>
      problem(404, "not_found", { title: "Snapshot niet gevonden" }),
    );
    const theme = makeTheme({ slug: "proxmox", service_id: null });
    const { container } = renderPane(
      <PreviewPane session={undefined} paletteTokens={null} theme={theme} />,
    );
    expect(await screen.findByText("De snapshot kon niet geladen worden")).toBeInTheDocument();
    expect(
      screen.getByText("Deze snapshot bestaat niet meer, of het bestand ontbreekt op de server."),
    ).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Demopagina tonen" }));
    await waitFor(() => expect(picker()).toHaveValue("demo"));
    expect(await frameDoc(container)).toContain('id="ct-demo-base"');
    expect(screen.queryByText("De snapshot kon niet geladen worden")).toBeNull();
  });

  it("uses the demo page when the services cannot be loaded, and works without storage", async () => {
    server.on("GET", "/api/v1/services", () => problem(503, "unavailable"));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("geen opslag");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("geen opslag");
    });
    const theme = makeTheme({ slug: "proxmox", service_id: null });
    const { container } = renderPane(
      <PreviewPane session={undefined} paletteTokens={null} theme={theme} />,
    );
    await waitFor(() => expect(picker()).toHaveValue("demo"), { timeout: 3000 });
    expect(await frameDoc(container)).toContain('id="ct-demo-base"');
    expect(screen.queryByRole("option", { name: /Nog geen snapshots/ })).toBeNull();
    // Kiezen gaat zonder opslag gewoon (alleen voor deze sessie).
    act(() => usePreviewSourceStore.getState().choose(theme.id, "demo"));
    expect(usePreviewSourceStore.getState().choices[theme.id]).toBe("demo");
  });
});
