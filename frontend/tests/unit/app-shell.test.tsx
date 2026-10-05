import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/app/routes";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("App shell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(new Response("{}", { status: String(input) === "/readyz" ? 503 : 200 })),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the header and every sidebar nav item", () => {
    renderAt("/");
    expect(screen.getByText("cssthema")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(labels).toEqual([
      "Dashboard",
      "Services",
      "Themes",
      "Import",
      "Discovery",
      "AI Studio",
      "Palettes",
      "Jobs",
      "Settings",
    ]);
  });

  it("shows health status from /healthz and /readyz on the dashboard", async () => {
    renderAt("/");
    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(await screen.findByText("error")).toBeInTheDocument();
  });

  it("renders a placeholder page for the editor route with the theme id", () => {
    renderAt("/editor/abc123");
    expect(screen.getByRole("heading", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByText("themeId: abc123")).toBeInTheDocument();
    expect(screen.getByText(/later phase/)).toBeInTheDocument();
  });
});
