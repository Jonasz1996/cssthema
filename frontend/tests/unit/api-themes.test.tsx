import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isPreconditionFailed, type ApiError } from "@/api/client";
import { dashboardKeys, normalizeThemeFilters, themeKeys } from "@/api/queries/keys";
import { flattenPages } from "@/api/queries/options";
import {
  useCreateTheme,
  useDeleteTheme,
  useDuplicateTheme,
  useExportTheme,
  useImportLocalFiles,
  useImportTheme,
  useLocalFiles,
  useRestoreTheme,
  useTheme,
  useThemesInfinite,
  useUpdateTheme,
} from "@/api/queries/themes";
import { createFetchMock, etag, json, noContent, problem } from "@/api/testing/fetch-mock";
import { makeDraft, makeLocalFile, makeTheme, testId } from "@/api/testing/fixtures";
import { createQueryWrapper, createTestQueryClient } from "@/api/testing/query";
import type { Theme } from "@/api/types";

function setup() {
  const server = createFetchMock();
  vi.stubGlobal("fetch", server.fetch);
  const queryClient = createTestQueryClient();
  const wrapper = createQueryWrapper(queryClient);
  return { server, queryClient, wrapper };
}

describe("theme query keys", () => {
  it("normalizes filters so empty values do not create new queries", () => {
    expect(normalizeThemeFilters({ q: "  ", status: null, include_deleted: false })).toEqual({});
    expect(normalizeThemeFilters({ q: " nord ", include_deleted: true, sort: "name" })).toEqual({
      q: "nord",
      include_deleted: true,
      sort: "name",
    });
    expect(themeKeys.infinite({ q: "" })).toEqual(themeKeys.infinite({}));
  });

  it("keeps draft, versions and lint outside the detail key", () => {
    const id = testId(1);
    const detail = themeKeys.detail(id);
    for (const key of [themeKeys.draft(id), themeKeys.versions(id), themeKeys.lint(id, null)]) {
      expect(key.slice(0, detail.length)).not.toEqual(detail);
    }
  });
});

describe("theme list and detail", () => {
  it("pages with the cursor and passes filters as query parameters", async () => {
    const { server, wrapper } = setup();
    const first = makeTheme({ name: "A", slug: "a" });
    const second = makeTheme({ name: "B", slug: "b" });
    server.on("GET", "/api/v1/themes", ({ url }) =>
      json(
        url.searchParams.get("cursor") === "c1"
          ? { items: [second], next_cursor: null }
          : { items: [first], next_cursor: "c1" },
      ),
    );

    const { result } = renderHook(
      () => useThemesInfinite({ q: "nord", status: "published", limit: 1, include_deleted: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());

    await waitFor(() =>
      expect(flattenPages(result.current.data).map((theme) => theme.slug)).toEqual(["a", "b"]),
    );
    expect(result.current.hasNextPage).toBe(false);
    const [page1, page2] = server.callsTo("GET", "/api/v1/themes");
    expect(Object.fromEntries(page1!.url.searchParams)).toEqual({
      q: "nord",
      status: "published",
      limit: "1",
    });
    expect(page2!.url.searchParams.get("cursor")).toBe("c1");
  });

  it("loads one theme, and waits while the id is missing", async () => {
    const { server, wrapper } = setup();
    const theme = makeTheme();
    server.on("GET", "/api/v1/themes/:id", ({ params }) => json({ ...theme, id: params.id }));

    const { result, rerender } = renderHook(({ id }) => useTheme(id), {
      wrapper,
      initialProps: { id: undefined as string | undefined },
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(server.calls).toHaveLength(0);

    rerender({ id: theme.id });
    await waitFor(() => expect(result.current.data?.id).toBe(theme.id));
  });

  it("does not retry a 404 and types the error", async () => {
    const { server, wrapper } = setup();
    server.on("GET", "/api/v1/themes/:id", problem(404, "not_found", { title: "Niet gevonden" }));

    const { result } = renderHook(() => useTheme(testId(5)), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe("not_found");
    expect(server.calls).toHaveLength(1);
  });
});

describe("theme mutations", () => {
  it("create returns the lock and refreshes lists and dashboard", async () => {
    const { server, queryClient, wrapper } = setup();
    const created = makeTheme({ lock_version: 1 });
    server.on("POST", "/api/v1/themes", json(created, { status: 201, headers: etag(1) }));
    queryClient.setQueryData(themeKeys.list({}), { items: [], next_cursor: null });
    queryClient.setQueryData(dashboardKeys.all, { themes_total: 0 });

    const { result } = renderHook(() => useCreateTheme(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ name: "Proxmox", template: { kind: "empty" } }),
    );

    expect(locked).toMatchObject({ lockVersion: 1, etag: '"lv-1"' });
    expect(server.calls[0]!.body).toEqual({ name: "Proxmox", template: { kind: "empty" } });
    expect(queryClient.getQueryData(themeKeys.detail(created.id))).toEqual(created);
    expect(queryClient.getQueryState(themeKeys.list({}))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(dashboardKeys.all)?.isInvalidated).toBe(true);
  });

  it("update sends If-Match and hands back the new lock version", async () => {
    const { server, queryClient, wrapper } = setup();
    const theme = makeTheme({ lock_version: 3 });
    server.on("PATCH", "/api/v1/themes/:id", ({ body }) =>
      json({ ...theme, ...(body as Partial<Theme>), lock_version: 4 }, { headers: etag(4) }),
    );

    const { result } = renderHook(() => useUpdateTheme(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ themeId: theme.id, lockVersion: 3, patch: { name: "Nord" } }),
    );

    expect(locked.lockVersion).toBe(4);
    expect(server.calls[0]!.headers.get("If-Match")).toBe('"lv-3"');
    expect(server.calls[0]!.body).toEqual({ name: "Nord" });
    expect(queryClient.getQueryData<Theme>(themeKeys.detail(theme.id))?.name).toBe("Nord");
  });

  it("update surfaces a 412 with the current server state", async () => {
    const { server, wrapper } = setup();
    server.on(
      "PATCH",
      "/api/v1/themes/:id",
      problem(412, "precondition_failed", {
        current: { etag: '"lv-8"', lock_version: 8, updated_at: "2026-10-05T12:00:00Z" },
      }),
    );

    const { result } = renderHook(() => useUpdateTheme(), { wrapper });
    const error = await act(() =>
      result.current
        .mutateAsync({ themeId: testId(1), lockVersion: 3, patch: { slug: "x" } })
        .catch((e: ApiError) => e),
    );

    expect(isPreconditionFailed(error)).toBe(true);
    expect((error as ApiError).current?.lock_version).toBe(8);
  });

  it("soft delete invalidates the theme; hard delete drops its caches", async () => {
    const { server, queryClient, wrapper } = setup();
    const theme = makeTheme();
    server.on("DELETE", "/api/v1/themes/:id", noContent());
    queryClient.setQueryData(themeKeys.detail(theme.id), theme);
    queryClient.setQueryData(themeKeys.draft(theme.id), makeDraft());

    const { result } = renderHook(() => useDeleteTheme(), { wrapper });
    await act(() => result.current.mutateAsync({ themeId: theme.id, lockVersion: 2 }));

    expect(server.calls[0]!.url.searchParams.has("hard")).toBe(false);
    expect(server.calls[0]!.headers.get("If-Match")).toBe('"lv-2"');
    expect(queryClient.getQueryState(themeKeys.detail(theme.id))?.isInvalidated).toBe(true);

    await act(() => result.current.mutateAsync({ themeId: theme.id, hard: true }));

    expect(server.calls[1]!.url.searchParams.get("hard")).toBe("true");
    expect(server.calls[1]!.headers.has("If-Match")).toBe(false);
    expect(queryClient.getQueryData(themeKeys.detail(theme.id))).toBeUndefined();
    expect(queryClient.getQueryData(themeKeys.draft(theme.id))).toBeUndefined();
  });

  it("restore and duplicate put the returned theme in the cache", async () => {
    const { server, queryClient, wrapper } = setup();
    const restored = makeTheme({ lock_version: 6 });
    const copy = makeTheme({ slug: "proxmox-2", lock_version: 1 });
    server
      .on("POST", "/api/v1/themes/:id/restore", json(restored, { headers: etag(6) }))
      .on("POST", "/api/v1/themes/:id/duplicate", json(copy, { status: 201, headers: etag(1) }));

    const restore = renderHook(() => useRestoreTheme(), { wrapper }).result;
    const duplicate = renderHook(() => useDuplicateTheme(), { wrapper }).result;
    const restoredLock = await act(() => restore.current.mutateAsync(restored.id));
    const copied = await act(() =>
      duplicate.current.mutateAsync({ themeId: restored.id, name: "Proxmox 2" }),
    );

    expect(restoredLock.lockVersion).toBe(6);
    expect(copied.data.slug).toBe("proxmox-2");
    expect(server.callsTo("POST", "/api/v1/themes/:id/duplicate")[0]!.body).toEqual({
      name: "Proxmox 2",
    });
    expect(queryClient.getQueryData(themeKeys.detail(copy.id))).toEqual(copy);
  });

  it("export downloads with the server's file name", async () => {
    const { server, wrapper } = setup();
    server.on(
      "GET",
      "/api/v1/themes/:id/export",
      () =>
        new Response(new TextEncoder().encode("PK"), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": 'attachment; filename="proxmox.cssthema.zip"',
          },
        }),
    );

    const { result } = renderHook(() => useExportTheme(), { wrapper });
    const file = await act(() =>
      result.current.mutateAsync({ themeId: testId(1), format: "bundle", version: 3, save: false }),
    );

    expect(file.filename).toBe("proxmox.cssthema.zip");
    expect(file.contentType).toBe("application/zip");
    // `version` hoort alleen bij format=css.
    expect(Object.fromEntries(server.calls[0]!.url.searchParams)).toEqual({ format: "bundle" });
  });

  it("import uploads multipart and reports whether a theme was created", async () => {
    const { server, queryClient, wrapper } = setup();
    const theme = makeTheme({ lock_version: 2 });
    let status = 201;
    server.on("POST", "/api/v1/themes/import", () => json(theme, { status, headers: etag(2) }));

    const { result } = renderHook(() => useImportTheme(), { wrapper });
    const created = await act(() =>
      result.current.mutateAsync({
        file: new File(["body{}"], "proxmox.css", { type: "text/css" }),
        onConflict: "new_version",
        publish: true,
      }),
    );

    expect(created).toMatchObject({ created: true, lockVersion: 2 });
    const request = server.calls[0]!;
    expect(request.headers.get("Content-Type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = request.body as FormData;
    expect(form.get("on_conflict")).toBe("new_version");
    expect(form.get("publish")).toBe("true");
    expect(form.has("name")).toBe(false);
    // jsdom + undici verliezen de bestandsnaam onderweg; de browser niet (zie api-client-test).
    expect(await (form.get("file") as Blob).text()).toBe("body{}");

    status = 200;
    queryClient.setQueryData(themeKeys.draft(theme.id), makeDraft());
    const updated = await act(() =>
      result.current.mutateAsync({ file: new Blob(["a{}"]), filename: "proxmox.css" }),
    );

    expect(updated.created).toBe(false);
    expect(queryClient.getQueryState(themeKeys.draft(theme.id))?.isInvalidated).toBe(true);
  });

  it("lists and imports local files with publish and archive on by default", async () => {
    const { server, queryClient, wrapper } = setup();
    const imported = { ...makeTheme({ slug: "proxmox" }), source_file: "proxmox.css" };
    server
      .on("GET", "/api/v1/themes/local-files", json([makeLocalFile()]))
      .on(
        "POST",
        "/api/v1/themes/local-files/import",
        json({ imported: [imported], skipped: [{ name: "x.css", reason: "slug bezet" }] }),
      );

    const list = renderHook(() => useLocalFiles(), { wrapper }).result;
    await waitFor(() => expect(list.current.data?.[0]?.name).toBe("proxmox.css"));

    const importer = renderHook(() => useImportLocalFiles(), { wrapper }).result;
    const outcome = await act(() =>
      importer.current.mutateAsync({ names: ["proxmox.css", "x.css"] }),
    );

    expect(server.callsTo("POST")[0]!.body).toEqual({
      names: ["proxmox.css", "x.css"],
      publish: true,
      archive: true,
    });
    expect(outcome.skipped).toHaveLength(1);
    expect(queryClient.getQueryData(themeKeys.detail(imported.id))).toEqual(imported);
    await waitFor(() =>
      expect(server.callsTo("GET", "/api/v1/themes/local-files")).toHaveLength(2),
    );
  });
});
