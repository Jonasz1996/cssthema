import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "@/app/routes";

/** Stubt fetch: `/healthz` → 200, `/readyz` → `readyStatus` (standaard 200). */
export function stubHealth(readyStatus = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const path = new URL(url, "http://localhost").pathname;
      return Promise.resolve(
        new Response("{}", { status: path === "/readyz" ? readyStatus : 200 }),
      );
    }),
  );
}

/** Rendert de hele app (routes + shell) op een pad met een memory-router. */
export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...result, router };
}
