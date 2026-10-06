import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDashboard } from "@/api/queries/dashboard";
import { paletteKeys } from "@/api/queries/keys";
import { usePalette, usePalettes } from "@/api/queries/palettes";
import { createFetchMock, json } from "@/api/testing/fetch-mock";
import { makeDashboard, makePalette, makeTheme } from "@/api/testing/fixtures";
import { createQueryWrapper, createTestQueryClient } from "@/api/testing/query";

function setup() {
  const server = createFetchMock();
  vi.stubGlobal("fetch", server.fetch);
  const queryClient = createTestQueryClient();
  return { server, queryClient, wrapper: createQueryWrapper(queryClient) };
}

describe("palettes", () => {
  it("lists palettes with their tokens", async () => {
    const { server, wrapper } = setup();
    const terminal = makePalette();
    server.on("GET", "/api/v1/palettes", json([terminal, makePalette({ slug: "nord" })]));

    const { result } = renderHook(() => usePalettes(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data?.[0]?.tokens.bg).toBe("#141414");
  });

  it("uses the cached list for one palette, and fetches it otherwise", async () => {
    const { server, queryClient, wrapper } = setup();
    const cached = makePalette({ slug: "nord" });
    const other = makePalette({ slug: "dracula" });
    queryClient.setQueryData(paletteKeys.list(), [cached]);
    server.on("GET", "/api/v1/palettes/:id", ({ params }) => json({ ...other, id: params.id }));

    const fromList = renderHook(() => usePalette(cached.id), { wrapper }).result;
    expect(fromList.current.data?.slug).toBe("nord");

    const fetched = renderHook(() => usePalette(other.id), { wrapper }).result;
    await waitFor(() => expect(fetched.current.data?.slug).toBe("dracula"));
    expect(server.calls.map((call) => call.path)).toEqual([`/api/v1/palettes/${other.id}`]);

    const none = renderHook(() => usePalette(null), { wrapper }).result;
    expect(none.current.fetchStatus).toBe("idle");
  });
});

describe("dashboard", () => {
  it("loads KPIs, recent themes and local files", async () => {
    const { server, wrapper } = setup();
    server.on(
      "GET",
      "/api/v1/dashboard",
      json(
        makeDashboard({
          themes_total: 3,
          recent: [makeTheme()],
          local_files: { dir: "/var/lib/cssthema/css-files", total: 4, importable: 2 },
        }),
      ),
    );

    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => expect(result.current.data?.themes_total).toBe(3));
    expect(result.current.data?.local_files.importable).toBe(2);
    expect(result.current.data?.recent).toHaveLength(1);
  });
});
