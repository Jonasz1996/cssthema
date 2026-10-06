import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
import { vi } from "vitest";
import { createFetchMock, type FetchMock, json, noContent } from "@/api/testing/fetch-mock";
import { makeDashboard } from "@/api/testing/fixtures";
import { createTestQueryClient } from "@/api/testing/query";
import { useToastStore } from "@/components/ui/toast";

/**
 * Hulpmiddelen voor de tests van de pagina's Thema's, Dashboard, Import en Paletten (alleen
 * tests importeren dit). Een nep-backend met zinnige standaardroutes en een memory-router met
 * een stub voor de editor, zodat links naar `/editor/<id>` te volgen zijn.
 */

export const PUBLIC_BASE = "https://css.example";

/** Nep-backend met lege standaardantwoorden; tests voegen er eigen routes aan toe. */
export function createServer(): FetchMock {
  return createFetchMock()
    .on("GET", "/healthz", () => json({ status: "ok" }))
    .on("GET", "/readyz", () => json({ status: "ok" }))
    .on("GET", "/api/v1/meta", () =>
      json({
        name: "cssthema",
        version: "test",
        environment: "test",
        public_base_url: PUBLIC_BASE,
      }),
    )
    .on("GET", "/api/v1/themes", () => json({ items: [], next_cursor: null }))
    .on("GET", "/api/v1/palettes", () => json([]))
    .on("GET", "/api/v1/dashboard", () => json(makeDashboard()))
    .on("GET", "/api/v1/themes/local-files", () => json([]))
    .on("GET", "/api/v1/scripts", () => json([]))
    .on("DELETE", "/api/v1/themes/:id", () => noContent());
}

function EditorStub() {
  const { id } = useParams();
  return createElement("p", { "data-testid": "editor-stub" }, `editor ${id ?? ""}`);
}

export interface RenderPageOptions {
  /** Begin-URL, bv. `/themes?status=live`. */
  path?: string;
  /** Routepatroon van de pagina (standaard het pad van `path`). */
  route?: string;
  server?: FetchMock;
  queryClient?: QueryClient;
}

/** Rendert één pagina in een router + QueryClient, met `fetch` op de nep-backend. */
export function renderPage(element: ReactElement, options: RenderPageOptions = {}) {
  const path = options.path ?? "/";
  const server = options.server ?? createServer();
  const queryClient = options.queryClient ?? createTestQueryClient();
  vi.stubGlobal("fetch", server.fetch);
  const route = options.route ?? new URL(path, "http://localhost").pathname;
  const router = createMemoryRouter(
    [
      { path: route, element },
      { path: "/editor/:id", element: createElement(EditorStub) },
      { path: "*", element: createElement("p", { "data-testid": "elsewhere" }, "elders") },
    ],
    { initialEntries: [path] },
  );
  const result = render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RouterProvider, { router }),
    ),
  );
  return { ...result, router, server, queryClient };
}

/** Huidige URL van de router (pad + query). */
export function currentUrl(router: { state: { location: { pathname: string; search: string } } }) {
  return `${router.state.location.pathname}${router.state.location.search}`;
}

/** Tekst van de meldingen in de toast-store (de Toaster zit in de shell, niet op de pagina). */
export function toastTexts(): { tone: string; text: string }[] {
  return useToastStore.getState().toasts.map((item) => ({
    tone: item.tone,
    text: typeof item.message === "string" ? item.message : textOf(item.message),
  }));
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}
