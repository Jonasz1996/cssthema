import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/app/AppShell";
import { RouteError } from "@/app/RouteError";
import {
  installStaleChunkReload,
  isChunkLoadError,
  RELOAD_GUARD_MS,
  reloadForNewVersion,
} from "@/app/stale-chunk";
import { stubHealth } from "../render-app";

const STALE = new TypeError(
  "Failed to fetch dynamically imported module: http://localhost/assets/EditorPage-54zfNM6J.js",
);

function Boom({ error }: { error: Error }): never {
  throw error;
}

/** Shell + padloze foutgrens zoals in `routes.tsx`, met een pagina die gooit. */
function renderBroken(error: Error) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        errorElement: <RouteError standalone />,
        children: [
          {
            errorElement: <RouteError />,
            children: [{ path: "editor/:id", element: <Boom error={error} /> }],
          },
        ],
      },
    ],
    { initialEntries: ["/editor/abc"] },
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("stale chunk", () => {
  it("herkent een lazy import die zijn bestand niet vond (Chrome, Firefox, Safari)", () => {
    expect(isChunkLoadError(STALE)).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("herlaadt één keer, niet opnieuw binnen de wachttijd (geen lus)", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const reload = vi.fn();
    expect(reloadForNewVersion({ now: 1_000_000, storage, reload })).toBe(true);
    expect(reloadForNewVersion({ now: 1_000_000 + 1000, storage, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForNewVersion({ now: 1_000_000 + RELOAD_GUARD_MS + 1, storage, reload })).toBe(
      true,
    );
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("herlaadt niet automatisch zonder (werkende) sessionStorage", () => {
    const reload = vi.fn();
    expect(reloadForNewVersion({ storage: null, reload })).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("geblokkeerd");
      },
      setItem: () => {},
    };
    expect(reloadForNewVersion({ storage: broken, reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("luistert naar vite:preloadError", () => {
    const target = new EventTarget() as unknown as Window;
    const storage = new Map<string, string>();
    const reload = vi.fn();
    installStaleChunkReload(target, {
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void storage.set(key, value),
      },
      reload,
    });
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.get("cssthema.chunk-reload")).toEqual(expect.any(String));
    // Meteen nog een mislukte import: geen tweede herlaadbeurt (geen lus).
    target.dispatchEvent(new Event("vite:preloadError"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("RouteError", () => {
  beforeEach(() => {
    stubHealth();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("toont bij een oude chunk een eigen melding met Herladen, binnen de shell", async () => {
    renderBroken(STALE);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Nieuwe versie van cssthema" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Herladen" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar het dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
    // De navigatie van de shell blijft staan; geen ontwikkelaarsmelding van React Router.
    expect(screen.getByRole("navigation", { name: "Hoofdnavigatie" })).toBeInTheDocument();
    expect(screen.queryByText(/Hey developer/)).toBeNull();
    expect(screen.queryByText("Unexpected Application Error!")).toBeNull();
  });

  it("toont bij een andere fout een algemene melding", async () => {
    renderBroken(new Error("kapot"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Er ging iets mis" }),
    ).toBeInTheDocument();
    expect(screen.getByText("# kapot")).toBeInTheDocument();
  });
});
