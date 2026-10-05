import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a fetch stubbed after import and calls the absolute API path", async () => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: "cssthema", version: "0.0.0", environment: "test" }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { data, error } = await api.GET("/api/v1/meta");

    expect(error).toBeUndefined();
    expect(data?.name).toBe("cssthema");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]![0];
    expect(new URL(request.url).pathname).toBe("/api/v1/meta");
    expect(new URL(request.url).origin).toBe(globalThis.location.origin);
  });
});
