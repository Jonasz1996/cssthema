import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiError } from "@/api/client";
import { scriptKeys } from "@/api/queries/keys";
import {
  useDeleteScript,
  useDownloadScript,
  useScriptContent,
  useScripts,
  useUploadScript,
} from "@/api/queries/scripts";
import { createFetchMock, json, noContent, problem } from "@/api/testing/fetch-mock";
import { makeScript } from "@/api/testing/fixtures";
import { createQueryWrapper, createTestQueryClient } from "@/api/testing/query";
import type { ScriptFile } from "@/api/types";

function setup() {
  const server = createFetchMock();
  vi.stubGlobal("fetch", server.fetch);
  const queryClient = createTestQueryClient();
  const wrapper = createQueryWrapper(queryClient);
  return { server, queryClient, wrapper };
}

describe("scripts: lijst en inhoud", () => {
  it("leest de lijst en de inhoud als tekst", async () => {
    const { server, wrapper } = setup();
    server.on("GET", "/api/v1/scripts", json([makeScript()])).on(
      "GET",
      "/api/v1/scripts/:name",
      ({ params }) =>
        new Response(`/* ${params.name} */`, {
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        }),
    );

    const list = renderHook(() => useScripts(), { wrapper }).result;
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    expect(list.current.data?.map((script) => script.url)).toEqual([
      "https://css.example/algemeen.js",
    ]);

    const content = renderHook(() => useScriptContent("algemeen"), { wrapper }).result;
    await waitFor(() => expect(content.current.isSuccess).toBe(true));
    expect(content.current.data).toBe("/* algemeen */");
  });

  it("zonder naam wordt er niets geladen", () => {
    const { server, wrapper } = setup();
    const { result } = renderHook(() => useScriptContent(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(server.calls).toHaveLength(0);
  });

  it("een Problem wordt een ApiError met code", async () => {
    const { server, wrapper } = setup();
    server.on("GET", "/api/v1/scripts", () =>
      problem(503, "storage_unavailable", { detail: "Map niet leesbaar." }),
    );
    const { result } = renderHook(() => useScripts(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      status: 503,
      code: "storage_unavailable",
      message: "Map niet leesbaar.",
    });
  });
});

describe("scripts: mutaties", () => {
  it("upload: multipart, replace alleen als het aan staat, created uit de status", async () => {
    const { server, queryClient, wrapper } = setup();
    let status = 201;
    server.on("POST", "/api/v1/scripts", () =>
      json(makeScript({ name: "netwerk", size_bytes: 9 }), { status }),
    );
    queryClient.setQueryData<ScriptFile[]>(scriptKeys.list(), [
      makeScript({ name: "zz-laatste" }),
      makeScript({ name: "netwerk", size_bytes: 1 }),
    ]);
    // Zonder observer: alleen de cache telt, niet opnieuw ophalen.
    server.on("GET", "/api/v1/scripts", () => json([]));

    const { result } = renderHook(() => useUploadScript(), { wrapper });
    const created = await act(() =>
      result.current.mutateAsync({
        file: new File(["x"], "Netwerk.js", { type: "text/javascript" }),
        name: "Netwerk",
      }),
    );
    expect(created.created).toBe(true);
    const form = server.calls[0]!.body as FormData;
    expect(server.calls[0]!.headers.get("Content-Type")).toMatch(/^multipart\/form-data;/);
    expect(form.get("name")).toBe("Netwerk");
    expect(form.has("replace")).toBe(false);
    expect(await (form.get("file") as Blob).text()).toBe("x");
    // Het script staat (vervangen) in de lijst, op naam gesorteerd.
    expect(
      queryClient.getQueryData<ScriptFile[]>(scriptKeys.list())?.map((s) => [s.name, s.size_bytes]),
    ).toEqual([
      ["netwerk", 9],
      ["zz-laatste", 1561],
    ]);

    status = 200;
    queryClient.setQueryData(scriptKeys.content("netwerk"), "oud");
    const replaced = await act(() =>
      result.current.mutateAsync({ file: new Blob(["y"]), filename: "netwerk.js", replace: true }),
    );
    expect(replaced.created).toBe(false);
    expect((server.calls.at(-1)!.body as FormData).get("replace")).toBe("true");
    expect(queryClient.getQueryState(scriptKeys.content("netwerk"))?.isInvalidated).toBe(true);
  });

  it("upload: 409 script_conflict komt terug als ApiError met de naam", async () => {
    const { server, wrapper } = setup();
    server.on("POST", "/api/v1/scripts", () =>
      problem(409, "script_conflict", { detail: "Er staat al een script.", name: "algemeen" }),
    );
    const { result } = renderHook(() => useUploadScript(), { wrapper });
    let error: ApiError | null = null;
    await act(async () => {
      try {
        await result.current.mutateAsync({ file: new File(["x"], "algemeen.js") });
      } catch (caught) {
        error = caught as ApiError;
      }
    });
    expect(error).toMatchObject({ status: 409, code: "script_conflict" });
    expect(error!.problem).toMatchObject({ name: "algemeen" });
  });

  it("verwijderen haalt het script uit de lijst en de inhoud uit de cache", async () => {
    const { server, queryClient, wrapper } = setup();
    server
      .on("DELETE", "/api/v1/scripts/:name", () => noContent())
      .on("GET", "/api/v1/scripts", () => json([]));
    queryClient.setQueryData(scriptKeys.list(), [
      makeScript(),
      makeScript({ name: "klok-widget" }),
    ]);
    queryClient.setQueryData(scriptKeys.content("algemeen"), "/* x */");

    const { result } = renderHook(() => useDeleteScript(), { wrapper });
    await act(() => result.current.mutateAsync("algemeen"));

    expect(server.calls[0]).toMatchObject({ method: "DELETE", path: "/api/v1/scripts/algemeen" });
    expect(queryClient.getQueryData<ScriptFile[]>(scriptKeys.list())?.map((s) => s.name)).toEqual([
      "klok-widget",
    ]);
    expect(queryClient.getQueryData(scriptKeys.content("algemeen"))).toBeUndefined();
  });

  it("404 bij verwijderen, downloaden of lezen: het script verdwijnt ook uit de lijst", async () => {
    const { server, queryClient, wrapper } = setup();
    const gone = () => problem(404, "not_found", { detail: "Er staat geen script in de map." });
    server.on("DELETE", "/api/v1/scripts/:name", gone).on("GET", "/api/v1/scripts/:name", gone);
    const names = () =>
      queryClient.getQueryData<ScriptFile[]>(scriptKeys.list())?.map((script) => script.name);
    queryClient.setQueryData(scriptKeys.list(), [
      makeScript(),
      makeScript({ name: "klok-widget" }),
      makeScript({ name: "netwerk" }),
    ]);

    const remove = renderHook(() => useDeleteScript(), { wrapper }).result;
    await act(() => expect(remove.current.mutateAsync("algemeen")).rejects.toThrow());
    expect(names()).toEqual(["klok-widget", "netwerk"]);

    const download = renderHook(() => useDownloadScript(), { wrapper }).result;
    await act(() =>
      expect(download.current.mutateAsync({ name: "klok-widget", save: false })).rejects.toThrow(),
    );
    expect(names()).toEqual(["netwerk"]);

    const content = renderHook(() => useScriptContent("netwerk"), { wrapper }).result;
    await waitFor(() => expect(content.current.isError).toBe(true));
    await waitFor(() => expect(names()).toEqual([]));
    // En de lijst wordt opnieuw opgehaald zodra iemand hem toont.
    expect(queryClient.getQueryState(scriptKeys.list())?.isInvalidated).toBe(true);
  });

  it("een andere fout bij verwijderen laat de lijst staan", async () => {
    const { server, queryClient, wrapper } = setup();
    server.on("DELETE", "/api/v1/scripts/:name", () => problem(500, "storage_error"));
    queryClient.setQueryData(scriptKeys.list(), [makeScript()]);
    const { result } = renderHook(() => useDeleteScript(), { wrapper });
    await act(() => expect(result.current.mutateAsync("algemeen")).rejects.toThrow());
    expect(queryClient.getQueryData<ScriptFile[]>(scriptKeys.list())).toHaveLength(1);
  });

  it("download vraagt een bijlage en leest de bestandsnaam", async () => {
    const { server, wrapper } = setup();
    server.on(
      "GET",
      "/api/v1/scripts/:name",
      () =>
        new Response("/* js */", {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "Content-Disposition": 'attachment; filename="algemeen.js"',
          },
        }),
    );
    const { result } = renderHook(() => useDownloadScript(), { wrapper });
    const file = await act(() => result.current.mutateAsync({ name: "algemeen", save: false }));
    expect(file.filename).toBe("algemeen.js");
    expect(file.contentType).toMatch(/^text\/javascript/);
    expect(server.calls[0]!.url.searchParams.get("download")).toBe("true");
  });
});
