import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchMock, etag, json, problem, type FetchMock } from "@/api/testing/fetch-mock";
import { makeDraft, makeTheme, makeVersion, makeVersionSummary } from "@/api/testing/fixtures";
import { createTestQueryClient } from "@/api/testing/query";
import { useToastStore } from "@/components/ui/toast";
import { ensureSession, peekSession, resetSessions } from "@/features/editor/autosave/sessions";
import { fx } from "@/lib/fx";
import { VersionsPage } from "../VersionsPage";

vi.mock(
  "@/features/editor/components/DiffView",
  () => import("@/features/editor/__tests__/mocks/diff-view"),
);

const v1 = makeVersionSummary({
  version_number: 1,
  is_live: false,
  message: "Eerste versie",
  size_bytes: 600,
});
const v2 = makeVersionSummary({
  version_number: 2,
  is_live: true,
  message: "Accent",
  source: "manual",
  size_bytes: 700,
});
const theme = makeTheme({
  name: "Grafana Nord",
  slug: "grafana-nord",
  lock_version: 6,
  latest_version_number: 2,
  published_version: v2,
  draft_dirty: true,
});
const ID = theme.id;
const css = { 1: "a{color:red}", 2: "a{color:blue}" } as Record<number, string>;

function setup(configure?: (server: FetchMock) => void, path = `/editor/${ID}/versions`) {
  const server = createFetchMock()
    .on("GET", "/api/v1/themes/:id", json(theme, { headers: etag(6) }))
    .on("GET", "/api/v1/themes/:id/versions", json({ items: [v2, v1], next_cursor: null }))
    .on("GET", "/api/v1/themes/:id/versions/:n", ({ params }) =>
      json(
        makeVersion({ version_number: Number(params.n), css_source: css[Number(params.n)] ?? "" }),
      ),
    )
    .on(
      "GET",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ css: "a{color:green}", lock_version: 6 })),
    )
    .on("GET", "/api/v1/themes/:id/diff", ({ url }) =>
      json({
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        unified: "",
        stats: { added: 3, removed: 1 },
      }),
    );
  configure?.(server);
  vi.stubGlobal("fetch", server.fetch);
  const router = createMemoryRouter(
    [
      { path: "/editor/:themeId/versions", element: <VersionsPage /> },
      { path: "/editor/:themeId", element: <p>editor page</p> },
      { path: "/themes", element: <p>themes page</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { server, router };
}

/** Het (nagebootste) diff-venster met dit label. */
async function diffView(label: string) {
  return waitFor(() => {
    const pre = screen.queryAllByLabelText(label).find((element) => element.tagName === "PRE");
    if (!pre) throw new Error(`geen diff met label ${label}`);
    return pre;
  });
}

const toasts = () => useToastStore.getState().toasts.map((item) => item.message);

afterEach(() => {
  cleanup();
  resetSessions();
});

describe("VersionsPage", () => {
  it("lists versions with live badge, source, message, author and size", async () => {
    setup();
    const list = await screen.findByRole("region", { name: "Versies, nieuwste eerst" });
    await within(list).findByRole("button", { name: /^v1\b/ });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/draft.*wijkt af van live/),
      expect.stringMatching(/v2.*live.*handmatig.*“Accent”.*Beheerder.*700 B/),
      expect.stringMatching(/v1.*handmatig.*“Eerste versie”.*600 B/),
    ]);
    expect(screen.getByText("2 versies")).toBeInTheDocument();
    expect(screen.getByText("v2 live")).toBeInTheDocument();
  });

  it("compares the live version with the previous one by default", async () => {
    setup();
    const diff = await diffView("Verschil v1 → v2");
    await waitFor(() => expect(diff).toHaveTextContent("--- a{color:red} +++ a{color:blue}"));
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^v2\b/ })).toHaveAttribute("aria-pressed", "true");
    // Live kan je niet terugzetten.
    expect(screen.getByRole("button", { name: "↺ Terugzetten naar v2" })).toBeDisabled();
  });

  it("switches to inline and to another left side via the URL", async () => {
    const { router } = setup();
    await diffView("Verschil v1 → v2");
    fireEvent.click(screen.getByRole("button", { name: "Inline" }));
    expect(screen.getByRole("button", { name: "Inline" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(async () =>
      expect(await diffView("Verschil v1 → v2")).toHaveAttribute("data-side-by-side", "false"),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Vergelijken met" }), {
      target: { value: "draft" },
    });
    expect(router.state.location.search).toBe("?from=draft&to=2");
    await waitFor(async () =>
      expect(await diffView("Verschil draft → v2")).toHaveTextContent("--- a{color:green}"),
    );
  });

  it("compares the draft with live from the editor's Diff link", async () => {
    setup(undefined, `/editor/${ID}/versions?from=live&to=draft`);
    const diff = await diffView("Verschil v2 → draft");
    await waitFor(() => expect(diff).toHaveTextContent("--- a{color:blue} +++ a{color:green}"));
    expect(screen.getByRole("link", { name: "Draft bewerken" })).toHaveAttribute(
      "href",
      `/editor/${ID}`,
    );
  });

  it("rolls back after confirmation, with blue sparks and the new version selected", async () => {
    const rollbackSpy = vi.spyOn(fx, "rollback");
    const { server, router } = setup((mock) =>
      mock.on("POST", "/api/v1/themes/:id/rollback", ({ body, headers }) => {
        expect(headers.get("If-Match")).toBe('"lv-6"');
        expect(body).toEqual({ version_number: 1, message: "Terug naar rood" });
        return json(
          makeVersion({ version_number: 3, source: "rollback", source_version_number: 1 }),
          {
            status: 201,
            headers: etag(7),
          },
        );
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^v1\b/ }));
    expect(router.state.location.search).toBe("?from=empty&to=1");
    fireEvent.click(await screen.findByRole("button", { name: "↺ Terugzetten naar v1" }));
    const dialog = await screen.findByRole("dialog", { name: "Terugzetten naar v1?" });
    expect(dialog).toHaveTextContent("nieuwe versie v3");
    expect(dialog).toHaveTextContent("De draft heeft niet-gepubliceerde wijzigingen");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Terug naar rood" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Terugzetten naar v1" }));
    await waitFor(() => expect(toasts()).toContain("v1 staat weer live als v3."));
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(router.state.location.search).toBe("?from=2&to=3");
    expect(server.callsTo("POST", "/api/v1/themes/:id/rollback")).toHaveLength(1);
    // De rollbackknop (opener van de dialoog) is nu uitgeschakeld: focus op de vergelijking.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: /⟷ v3$/ })).toHaveFocus(),
    );
  });

  it("rollback 412 → reloads and explains", async () => {
    setup((mock) =>
      mock.on("POST", "/api/v1/themes/:id/rollback", problem(412, "precondition_failed")),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^v1\b/ }));
    fireEvent.click(await screen.findByRole("button", { name: "↺ Terugzetten naar v1" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Terugzetten naar v1" }));
    await waitFor(() =>
      expect(toasts()).toContain(
        "Het thema is intussen gewijzigd. Opnieuw geladen; probeer het nog eens.",
      ),
    );
  });

  it("open in editor: confirms (draft has changes), resets the draft, updates an open editor session", async () => {
    const reset = makeDraft({ css: "a{color:red}", lock_version: 7 });
    const { server, router } = setup((mock) =>
      mock.on("POST", "/api/v1/themes/:id/draft/reset", json(reset, { headers: etag(7) })),
    );
    // Een open editortab voor dit thema (zonder lokale wijzigingen).
    const session = ensureSession(ID, {
      draft: makeDraft({ css: "a{color:green}", lock_version: 6 }),
      save: vi.fn(),
    });
    fireEvent.click(await screen.findByRole("button", { name: /^v1\b/ }));
    fireEvent.click(await screen.findByRole("button", { name: "In editor openen" }));
    const dialog = await screen.findByRole("dialog", { name: "v1 in de editor laden?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Draft vervangen" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/editor/${ID}`));
    const call = server.callsTo("POST", "/api/v1/themes/:id/draft/reset")[0]!;
    expect(call.body).toEqual({ version_number: 1 });
    expect(call.headers.get("If-Match")).toBe('"lv-6"');
    expect(peekSession(ID)).toBe(session);
    expect(session.getSnapshot()).toMatchObject({
      css: "a{color:red}",
      lockVersion: 7,
      dirty: false,
    });
    expect(toasts()).toContain("Draft teruggezet naar v1.");
  });

  it("downloads a version as CSS", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { server } = setup((mock) =>
      mock.on(
        "GET",
        "/api/v1/themes/:id/export",
        () =>
          new Response("a{color:blue}", {
            headers: {
              "Content-Type": "text/css",
              "Content-Disposition": 'attachment; filename="grafana-nord@2.css"',
            },
          }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "⤓ v2 downloaden" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = server.callsTo("GET", "/api/v1/themes/:id/export")[0]!;
    expect(call.url.searchParams.get("format")).toBe("css");
    expect(call.url.searchParams.get("version")).toBe("2");
  });

  it("a never-published draft is 'not published yet', not 'differs from live'", async () => {
    setup((mock) =>
      mock
        .on(
          "GET",
          "/api/v1/themes/:id",
          json(
            { ...theme, published_version: null, latest_version_number: 0, draft_dirty: true },
            { headers: etag(6) },
          ),
        )
        .on("GET", "/api/v1/themes/:id/versions", json({ items: [], next_cursor: null })),
    );
    const draft = await screen.findByRole("button", { name: /^draft/ });
    expect(within(draft).getByText("nog niet gepubliceerd")).toBeInTheDocument();
    expect(within(draft).queryByText("wijkt af van live")).toBeNull();
  });

  it("shows a readable error instead of a browser message", async () => {
    setup((mock) =>
      mock.on("GET", "/api/v1/themes/:id/versions", () =>
        Promise.reject(new TypeError("Failed to fetch")),
      ),
    );
    expect(
      await screen.findByText(
        "De server is niet bereikbaar. Controleer je verbinding en probeer opnieuw.",
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("shows a not-found message", async () => {
    setup((mock) => mock.on("GET", "/api/v1/themes/:id", problem(404, "theme_not_found")));
    expect(await screen.findByText("Thema niet gevonden")).toBeInTheDocument();
  });
});
