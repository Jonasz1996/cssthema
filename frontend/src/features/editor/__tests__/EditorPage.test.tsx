import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchMock, etag, json, problem, type FetchMock } from "@/api/testing/fetch-mock";
import {
  makeDraft,
  makeLintResult,
  makePalette,
  makeTheme,
  makeVersion,
  makeVersionSummary,
} from "@/api/testing/fixtures";
import { createTestQueryClient } from "@/api/testing/query";
import type { LintIssue } from "@/api/types";
import { useToastStore } from "@/components/ui/toast";
import { fx } from "@/lib/fx";
import { draftBuffer } from "../autosave/buffer";
import { hasUnsavedChanges, peekSession, resetSessions } from "../autosave/sessions";
import { EditorPage } from "../EditorPage";
import { revealCalls } from "./mocks/reveal-calls";
import { resetBridgeCache } from "../preview/bridge";
import { DEFAULT_LAYOUT, useEditorStore } from "../store";
import BRIDGE from "../../../../public/preview-bridge.js?raw";

vi.mock("../components/CodeEditor", () => import("./mocks/code-editor"));
vi.mock("../components/DiffView", () => import("./mocks/diff-view"));

const palette = makePalette({ name: "Nord", tokens: { bg: "#2e3440", accent: "#88c0d0" } });
const theme = makeTheme({
  name: "Grafana Nord",
  slug: "grafana-nord",
  lock_version: 3,
  latest_version_number: 2,
  palette_id: palette.id,
  published_version: makeVersionSummary({ version_number: 2 }),
  draft_dirty: false,
});
const ID = theme.id;
const issue = (overrides: Partial<LintIssue>): LintIssue =>
  ({
    rule: "external-url",
    severity: "error",
    message: "Externe URL",
    line: 1,
    column: 1,
    ...overrides,
  }) as LintIssue;

function setup(configure?: (server: FetchMock) => void) {
  // Zoals de server: `draft_dirty` volgt de laatst opgeslagen draft t.o.v. live ("a{}").
  let savedCss = "a{}";
  let lock = 3;
  const server = createFetchMock()
    .on("GET", "/preview-bridge.js", () => new Response(BRIDGE, { status: 200 }))
    .on("GET", "/api/v1/themes", json({ items: [theme], next_cursor: null }))
    .on("GET", "/api/v1/themes/:id", () =>
      json(
        { ...theme, lock_version: lock, draft_dirty: savedCss !== "a{}" },
        { headers: etag(lock) },
      ),
    )
    .on(
      "GET",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ css: "a{}", lock_version: 3 }), { headers: etag(3) }),
    )
    .on("GET", "/api/v1/palettes/:id", json(palette))
    .on("POST", "/api/v1/themes/:id/lint", json(makeLintResult()))
    .on("PUT", "/api/v1/themes/:id/draft", ({ body, headers }) => {
      lock = Number(/lv-(\d+)/.exec(headers.get("If-Match") ?? "")?.[1]) + 1;
      savedCss = (body as { css: string }).css;
      return json(
        makeDraft({ css: savedCss, lock_version: lock, updated_at: "2026-10-05T10:04:31Z" }),
        { headers: etag(lock) },
      );
    });
  configure?.(server);
  vi.stubGlobal("fetch", server.fetch);
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(
    [
      { path: "/editor/:themeId", element: <EditorPage /> },
      { path: "/editor/:themeId/versions", element: <p>versions page</p> },
      { path: "/themes", element: <p>themes page</p> },
    ],
    { initialEntries: [`/editor/${ID}`] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { server, queryClient, router, view };
}

async function editorTextarea() {
  return screen.findByRole("textbox", { name: "CSS van grafana-nord" }, { timeout: 3000 });
}

const statusBar = () => screen.getByRole("group", { name: "Statusbalk" });

beforeEach(() => {
  resetBridgeCache();
});

afterEach(() => {
  // Eerst ontkoppelen: anders maakt een laatste render een nieuwe sessie aan na het opruimen.
  cleanup();
  resetSessions();
  useEditorStore.setState({ tabs: [], layout: DEFAULT_LAYOUT });
});

describe("EditorPage", () => {
  it("loads the theme: header, tab, explorer, palette, preview, status bar", async () => {
    setup();
    await editorTextarea();
    expect(screen.getByRole("heading", { name: "Grafana Nord" })).toBeInTheDocument();
    expect(screen.getByText("v2 live")).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Open thema's" });
    expect(within(tabs).getByRole("link", { name: /grafana-nord\.css/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(useEditorStore.getState().tabs).toEqual([
      { id: ID, name: "Grafana Nord", slug: "grafana-nord" },
    ]);
    expect(await screen.findByText("Palet Nord")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "var(--ct-accent) invoegen · #88c0d0" }),
    ).toBeInTheDocument();
    expect(within(statusBar()).getByText(/Opgeslagen/)).toBeInTheDocument();
    expect(within(statusBar()).getByText("palet Nord")).toBeInTheDocument();
    const frame = await screen.findByTitle("Preview van het thema op een demopagina");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
  });

  it("autosaves 1 s after typing with If-Match, then lints and shows the markers", async () => {
    const { server } = setup((mock) =>
      mock.on("POST", "/api/v1/themes/:id/lint", ({ body }) =>
        json(
          (body as { css: string }).css.includes("evil")
            ? makeLintResult({ ok: false, errors: [issue({ line: 1, column: 3 })] })
            : makeLintResult(),
        ),
      ),
    );
    const textarea = await editorTextarea();
    fireEvent.change(textarea, {
      target: { value: "a{background:url(https://evil.example/x.png)}" },
    });
    expect(within(statusBar()).getByText("Opslaan…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /grafana-nord\.css/ })).toHaveTextContent(
      "Nog niet opgeslagen",
    );

    await waitFor(() => expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(1), {
      timeout: 2500,
    });
    const put = server.callsTo("PUT", "/api/v1/themes/:id/draft")[0]!;
    expect(put.headers.get("If-Match")).toBe('"lv-3"');
    expect(put.body).toEqual({ css: "a{background:url(https://evil.example/x.png)}" });
    await waitFor(() =>
      expect(within(statusBar()).getByText(/Opgeslagen \d\d:04:31/)).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByTestId("markers")).toHaveTextContent("1 errors, 0 warnings"),
    );
    expect(within(statusBar()).getByRole("button", { name: /1 fout/ })).toBeInTheDocument();
    const lintCall = server
      .callsTo("POST", "/api/v1/themes/:id/lint")
      .find((call) => (call.body as { css: string }).css.includes("evil"));
    expect(lintCall).toBeDefined();

    // Probleempaneel via de statusbalk.
    fireEvent.click(within(statusBar()).getByRole("button", { name: /1 fout/ }));
    const panel = screen.getByRole("region", { name: "Problemen" });
    expect(within(panel).getByText("Externe URL")).toBeInTheDocument();
    expect(within(panel).getByText(/regel 1:3/)).toBeInTheDocument();
  });

  it("412 on autosave → conflict dialog; reload takes the server draft", async () => {
    const { server } = setup((mock) =>
      mock.on("PUT", "/api/v1/themes/:id/draft", () =>
        problem(412, "precondition_failed", {
          title: "Gewijzigd",
          current: {
            etag: '"lv-5"',
            lock_version: 5,
            updated_by: { id: "u2", display_name: "Jonas" },
            updated_at: "2026-10-05T10:00:00Z",
          },
        }),
      ),
    );
    const textarea = await editorTextarea();
    fireEvent.change(textarea, { target: { value: "a{mine}" } });
    const dialog = await screen.findByRole(
      "dialog",
      { name: "Draft elders gewijzigd" },
      { timeout: 2500 },
    );
    expect(dialog).toHaveTextContent(/Jonas heeft deze draft om \d\d:00:00 opgeslagen/);
    expect(within(statusBar()).getByRole("button", { name: /Conflict/ })).toBeInTheDocument();

    // Verder typen: blijft in conflict, geen nieuwe saves.
    server.on(
      "GET",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ css: "a{theirs}", lock_version: 5 })),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Diff bekijken" }));
    expect(
      await within(dialog).findByLabelText("Verschil tussen de serverdraft en mijn versie"),
    ).toHaveTextContent("--- a{theirs} +++ a{mine}");
    // De knop "Diff bekijken" verdwijnt: de focus gaat naar de diff, niet naar <body>.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("group", {
          name: "Verschillen: server links, mijn versie rechts",
        }),
      ).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Herladen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(textarea).toHaveValue("a{theirs}");
    expect(within(statusBar()).getByText(/Opgeslagen/)).toBeInTheDocument();
    expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(1);
  });

  it("conflict → overwrite saves my version with the server lock", async () => {
    let attempts = 0;
    const { server } = setup((mock) =>
      mock
        .on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 3 })))
        .on("PUT", "/api/v1/themes/:id/draft", ({ headers }) => {
          attempts += 1;
          if (attempts === 1) return problem(412, "precondition_failed", { current: null });
          expect(headers.get("If-Match")).toBe('"lv-6"');
          return json(makeDraft({ css: "a{mine}", lock_version: 7 }), { headers: etag(7) });
        }),
    );
    const textarea = await editorTextarea();
    fireEvent.change(textarea, { target: { value: "a{mine}" } });
    const dialog = await screen.findByRole("dialog", undefined, { timeout: 2500 });
    expect(dialog).toHaveTextContent("Iemand anders heeft deze draft intussen opgeslagen.");
    server.on(
      "GET",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ css: "a{theirs}", lock_version: 6 })),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Mijn versie overschrijven" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(textarea).toHaveValue("a{mine}");
    expect(attempts).toBe(2);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
        "Jouw versie is opgeslagen.",
      ),
    );
  });

  it("Ctrl+S opens the publish dialog; publishing sends the message and sparkles", async () => {
    const publishSpy = vi.spyOn(fx, "publish");
    const { server } = setup((mock) =>
      mock
        .on(
          "GET",
          "/api/v1/themes/:id/diff",
          json({
            from: "v2",
            to: "draft",
            unified: "--- v2\n+++ draft\n-a{}\n+a{x}\n",
            stats: { added: 1, removed: 1 },
          }),
        )
        .on(
          "POST",
          "/api/v1/themes/:id/publish",
          json(makeVersion({ version_number: 3 }), { status: 201, headers: etag(5) }),
        ),
    );
    const textarea = await editorTextarea();
    fireEvent.change(textarea, { target: { value: "a{x}" } });
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    const dialog = await screen.findByRole("dialog", { name: "grafana-nord publiceren" });
    // Eerst opgeslagen (flush), dan de validatie.
    await waitFor(() => expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(1));
    expect(await within(dialog).findByText("CSS is foutloos te parsen")).toBeInTheDocument();
    expect(within(dialog).getByText("Geen externe URL's")).toBeInTheDocument();
    expect(await within(dialog).findByText("regels")).toBeInTheDocument();
    expect(within(dialog).getByText("Wijzigingen t.o.v. v2")).toBeInTheDocument();
    expect(within(dialog).getByText(theme.public_url)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Bericht" }), {
      target: { value: "Accentkleur" },
    });
    const button = within(dialog).getByRole("button", { name: "v3 publiceren" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const publish = server.callsTo("POST", "/api/v1/themes/:id/publish")[0]!;
    // Lock na de autosave (3 → 4): publiceren mag alleen op de net opgeslagen draft.
    expect(publish.body).toEqual({ expected_lock_version: 4, message: "Accentkleur" });
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
      "v3 van grafana-nord staat live.",
    );
  });

  it("blocks publishing while the CSS has lint errors", async () => {
    setup((mock) =>
      mock
        .on(
          "GET",
          "/api/v1/themes/:id",
          json({ ...theme, draft_dirty: true }, { headers: etag(3) }),
        )
        .on(
          "POST",
          "/api/v1/themes/:id/lint",
          json(makeLintResult({ ok: false, errors: [issue({})] })),
        ),
    );
    await editorTextarea();
    fireEvent.click(screen.getByRole("button", { name: "Publiceren" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Externe URL's zijn niet toegestaan"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Los eerst de fouten op.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "v3 publiceren" })).toBeDisabled();
  });

  it("Ctrl+\\ toggles the preview and the layout is remembered", async () => {
    setup();
    await editorTextarea();
    expect(screen.getByRole("region", { name: "Preview" })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    });
    expect(screen.queryByRole("region", { name: "Preview" })).not.toBeInTheDocument();
    expect(useEditorStore.getState().layout.previewOpen).toBe(false);
    expect(localStorage.getItem("cssthema.editor")).toContain('"previewOpen":false');
  });

  it("shows a not-found message for an unknown theme", async () => {
    setup((mock) => mock.on("GET", "/api/v1/themes/:id", problem(404, "theme_not_found")));
    expect(await screen.findByText("Thema niet gevonden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar thema's" })).toHaveAttribute(
      "href",
      "/themes",
    );
  });

  it("is read-only for a deleted theme", async () => {
    setup((mock) =>
      mock.on("GET", "/api/v1/themes/:id", json({ ...theme, deleted_at: "2026-10-05T09:00:00Z" })),
    );
    const textarea = await editorTextarea();
    expect(textarea).toHaveAttribute("readonly");
    expect(screen.getByText(/in de prullenbak/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publiceren" })).toBeDisabled();
  });

  it("restores unsaved text from the offline buffer and saves it", async () => {
    await draftBuffer().set({
      themeId: ID,
      css: "a{offline}",
      baseLockVersion: 3,
      savedAt: "2026-10-05T09:00:00Z",
    });
    const { server } = setup();
    const textarea = await editorTextarea();
    await waitFor(() => expect(textarea).toHaveValue("a{offline}"));
    await waitFor(() => expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(1));
    expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")[0]!.body).toEqual({
      css: "a{offline}",
    });
    expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
      "Niet-opgeslagen wijzigingen uit deze browser teruggezet.",
    );
    await waitFor(async () => expect(await draftBuffer().get(ID)).toBeUndefined());
  });

  it("server unreachable → Offline in the status bar, text kept in the buffer", async () => {
    setup((mock) =>
      mock.on("PUT", "/api/v1/themes/:id/draft", () => new Response("", { status: 502 })),
    );
    const textarea = await editorTextarea();
    fireEvent.change(textarea, { target: { value: "a{offline}" } });
    expect(
      await within(statusBar()).findByRole("button", { name: /Offline/ }, { timeout: 2500 }),
    ).toBeInTheDocument();
    expect(await draftBuffer().get(ID)).toMatchObject({ css: "a{offline}", baseLockVersion: 3 });
    await draftBuffer().delete(ID);
  });

  it("closing the active tab opens its neighbour", async () => {
    useEditorStore.setState({
      tabs: [
        { id: ID, name: "Grafana Nord", slug: "grafana-nord" },
        { id: "other", name: "Ander", slug: "ander" },
      ],
    });
    const { router } = setup();
    await editorTextarea();
    fireEvent.click(screen.getByRole("button", { name: "Grafana Nord sluiten" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/other"));
    expect(useEditorStore.getState().tabs.map((tab) => tab.id)).toEqual(["other"]);
  });

  it("closing the active tab while a save is pending: one PUT, no session left, no conflict", async () => {
    useEditorStore.setState({
      tabs: [
        { id: ID, name: "Grafana Nord", slug: "grafana-nord" },
        { id: "other", name: "Ander", slug: "ander" },
      ],
    });
    const { server, router } = setup();
    const textarea = await editorTextarea();
    // Typen en meteen (binnen de autosave-pauze) de tab sluiten.
    fireEvent.change(textarea, { target: { value: "a{typed}" } });
    fireEvent.click(screen.getByRole("button", { name: "Grafana Nord sluiten" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/other"));
    await waitFor(() => expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(1));
    // Geen tweede PUT met een verouderde lock en geen sessie die blijft hangen.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const puts = server.callsTo("PUT", "/api/v1/themes/:id/draft");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.headers.get("If-Match")).toBe('"lv-3"');
    expect(puts[0]!.body).toEqual({ css: "a{typed}" });
    expect(peekSession(ID)).toBeUndefined();
    expect(hasUnsavedChanges()).toBe(false);
    expect(await draftBuffer().get(ID)).toBeUndefined();
  });

  it("a 412 that only bumped the lock (delete + restore) saves silently with the new lock", async () => {
    const { server } = setup((mock) =>
      mock
        // Server: zelfde draft ("a{}"), maar lock 5 na verwijderen en herstellen.
        .on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 5 })))
        .on("PUT", "/api/v1/themes/:id/draft", ({ headers, body }) => {
          if (headers.get("If-Match") !== '"lv-5"') {
            return problem(412, "precondition_failed", {
              current: { etag: '"lv-5"', lock_version: 5, updated_by: null, updated_at: null },
            });
          }
          const css = (body as { css: string }).css;
          return json(makeDraft({ css, lock_version: 6 }), { headers: etag(6) });
        }),
    );
    // De editor kent nog lock 3 (gecachete draft van vóór het verwijderen).
    server.on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 3 })));
    const textarea = await editorTextarea();
    server.on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 5 })));
    fireEvent.change(textarea, { target: { value: "a{mine}" } });
    await waitFor(() => expect(within(statusBar()).getByText(/Opgeslagen/)).toBeInTheDocument(), {
      timeout: 3000,
    });
    await waitFor(() => expect(server.callsTo("PUT", "/api/v1/themes/:id/draft")).toHaveLength(2));
    expect(
      server.callsTo("PUT", "/api/v1/themes/:id/draft").map((call) => call.headers.get("If-Match")),
    ).toEqual(['"lv-3"', '"lv-5"']);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(peekSession(ID)?.getSnapshot()).toMatchObject({ lockVersion: 6, dirty: false });
  });

  it("publishing after a lock-only bump retries once with the new lock", async () => {
    const { server } = setup((mock) =>
      mock
        .on(
          "GET",
          "/api/v1/themes/:id",
          json({ ...theme, draft_dirty: true }, { headers: etag(3) }),
        )
        .on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 3 })))
        .on(
          "GET",
          "/api/v1/themes/:id/diff",
          json({ from: "v2", to: "draft", unified: "", stats: { added: 0, removed: 0 } }),
        )
        .on("POST", "/api/v1/themes/:id/publish", ({ body }) =>
          (body as { expected_lock_version: number }).expected_lock_version === 5
            ? json(makeVersion({ version_number: 3 }), { status: 201, headers: etag(6) })
            : problem(412, "precondition_failed", {
                current: { etag: '"lv-5"', lock_version: 5, updated_by: null, updated_at: null },
              }),
        ),
    );
    await editorTextarea();
    server.on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ css: "a{}", lock_version: 5 })));
    fireEvent.click(screen.getByRole("button", { name: "Publiceren" }));
    const dialog = await screen.findByRole("dialog", { name: "grafana-nord publiceren" });
    const button = within(dialog).getByRole("button", { name: "v3 publiceren" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      server
        .callsTo("POST", "/api/v1/themes/:id/publish")
        .map((call) => (call.body as { expected_lock_version: number }).expected_lock_version),
    ).toEqual([3, 5]);
    expect(within(statusBar()).queryByRole("button", { name: /Conflict/ })).toBeNull();
    expect(peekSession(ID)?.getSnapshot().lockVersion).toBe(6);
  });

  it("does not offer to publish a draft that equals the live version", async () => {
    const { server } = setup();
    await editorTextarea();
    fireEvent.click(screen.getByRole("button", { name: "Publiceren" }));
    const dialog = await screen.findByRole("dialog", { name: "grafana-nord publiceren" });
    expect(
      await within(dialog).findByText("Niets te publiceren: de draft is gelijk aan v2."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "v3 publiceren" })).toBeDisabled();
    expect(server.callsTo("POST", "/api/v1/themes/:id/publish")).toHaveLength(0);
  });

  it("Ctrl+S in an open dialog does nothing but still blocks the browser's save dialog", async () => {
    setup();
    await editorTextarea();
    fireEvent.click(screen.getByRole("button", { name: "Publiceren" }));
    const dialog = await screen.findByRole("dialog", { name: "grafana-nord publiceren" });
    const message = within(dialog).getByRole("textbox", { name: "Bericht" });
    const event = new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      message.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("Ctrl+S pressed in the preview (forwarded by the bridge) opens the publish dialog", async () => {
    setup();
    await editorTextarea();
    const frame = await screen.findByTitle<HTMLIFrameElement>(
      "Preview van het thema op een demopagina",
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: { type: "cssthema:shortcut", action: "publish" },
        }),
      );
    });
    expect(
      await screen.findByRole("dialog", { name: "grafana-nord publiceren" }),
    ).toBeInTheDocument();
  });

  it("a problem with emoji before it jumps by code points (the editor converts to UTF-16)", async () => {
    revealCalls.length = 0;
    setup((mock) =>
      mock.on(
        "POST",
        "/api/v1/themes/:id/lint",
        json(
          makeLintResult({
            warnings: [
              issue({ rule: "unknown-property", severity: "warning", line: 1, column: 21 }),
            ],
          }),
        ),
      ),
    );
    await editorTextarea();
    useEditorStore.getState().setLayout({ problemsOpen: true });
    fireEvent.click(await screen.findByRole("button", { name: /unknown-property/ }));
    expect(revealCalls).toEqual([[1, 21]]);
  });

  it("copies the live URL without navigator.clipboard (http on a LAN address)", async () => {
    setup();
    await editorTextarea();
    vi.stubGlobal("isSecureContext", false);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    try {
      fireEvent.click(screen.getByRole("button", { name: "Downloaden" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Live-URL kopiëren/ }));
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
          "Live-URL gekopieerd.",
        ),
      );
      expect(execCommand).toHaveBeenCalledWith("copy");
    } finally {
      if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("shows a readable message instead of an nginx error page", async () => {
    setup((mock) =>
      mock.on(
        "GET",
        "/api/v1/themes/:id",
        () =>
          new Response("<html><head><title>502 Bad Gateway</title></head></html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );
    expect(
      await screen.findByText("De server gaf een fout. Probeer het later opnieuw.", undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Bad Gateway/)).toBeNull();
  });
});
