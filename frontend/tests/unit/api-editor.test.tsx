import { onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { isNetworkError, isPreconditionFailed, lintIssuesOf, type ApiError } from "@/api/client";
import {
  useDiff,
  useDraft,
  useLint,
  usePublishTheme,
  useResetDraft,
  useRollback,
  useSaveDraft,
  useVersion,
  useVersionsInfinite,
} from "@/api/queries/editor";
import { themeKeys } from "@/api/queries/keys";
import { flattenPages } from "@/api/queries/options";
import { createFetchMock, etag, json, problem } from "@/api/testing/fetch-mock";
import {
  makeDraft,
  makeLintResult,
  makeTheme,
  makeVersion,
  makeVersionSummary,
} from "@/api/testing/fixtures";
import { createQueryWrapper, createTestQueryClient } from "@/api/testing/query";
import type { Draft, Theme } from "@/api/types";

const theme = makeTheme({ lock_version: 3 });
const THEME_ID = theme.id;

function setup() {
  const server = createFetchMock();
  vi.stubGlobal("fetch", server.fetch);
  const queryClient = createTestQueryClient();
  const wrapper = createQueryWrapper(queryClient);
  return { server, queryClient, wrapper };
}

describe("draft", () => {
  it("loads the draft and does not refetch it on its own", async () => {
    const { server, wrapper } = setup();
    server.on("GET", "/api/v1/themes/:id/draft", json(makeDraft({ lock_version: 3 })));

    const { result } = renderHook(() => useDraft(THEME_ID), { wrapper });
    await waitFor(() => expect(result.current.data?.lock_version).toBe(3));

    renderHook(() => useDraft(THEME_ID), { wrapper });
    expect(server.calls).toHaveLength(1);
  });

  it("autosave sends If-Match, returns the new lock and updates the caches", async () => {
    const { server, queryClient, wrapper } = setup();
    const saved = makeDraft({ css: "a{color:red}", lock_version: 4, size_bytes: 12 });
    server.on("PUT", "/api/v1/themes/:id/draft", json(saved, { headers: etag(4) }));
    queryClient.setQueryData(themeKeys.detail(THEME_ID), theme);
    queryClient.setQueryData(themeKeys.draft(THEME_ID), makeDraft({ lock_version: 3 }));
    queryClient.setQueryData(themeKeys.versions(THEME_ID), { items: [] });

    const { result } = renderHook(() => useSaveDraft(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ themeId: THEME_ID, css: "a{color:red}", lockVersion: 3 }),
    );

    expect(locked).toMatchObject({ lockVersion: 4, etag: '"lv-4"' });
    expect(server.calls[0]!.headers.get("If-Match")).toBe('"lv-3"');
    expect(server.calls[0]!.body).toEqual({ css: "a{color:red}" });
    expect(queryClient.getQueryData<Draft>(themeKeys.draft(THEME_ID))).toEqual(saved);
    const cachedTheme = queryClient.getQueryData<Theme>(themeKeys.detail(THEME_ID));
    expect(cachedTheme?.lock_version).toBe(4);
    expect(cachedTheme?.draft_size_bytes).toBe(12);
    expect(queryClient.getQueryState(themeKeys.detail(THEME_ID))?.isInvalidated).toBe(true);
    // Versies veranderen niet door een autosave.
    expect(queryClient.getQueryState(themeKeys.versions(THEME_ID))?.isInvalidated).toBe(false);
  });

  it("autosave reports a conflict with the current server state", async () => {
    const { server, wrapper } = setup();
    server.on(
      "PUT",
      "/api/v1/themes/:id/draft",
      problem(412, "precondition_failed", {
        current: {
          etag: '"lv-14"',
          lock_version: 14,
          updated_by: { id: theme.id, display_name: "Anna" },
          updated_at: "2026-10-05T12:04:29Z",
        },
      }),
    );

    const { result } = renderHook(() => useSaveDraft(), { wrapper });
    act(() => result.current.mutate({ themeId: THEME_ID, css: "x", lockVersion: 12 }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error;
    expect(isPreconditionFailed(error)).toBe(true);
    expect(error?.current?.updated_by?.display_name).toBe("Anna");
  });

  it("autosave fails fast while offline instead of pausing", async () => {
    const { wrapper } = setup();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    onlineManager.setOnline(false);
    onTestFinished(() => onlineManager.setOnline(true));

    const { result } = renderHook(() => useSaveDraft(), { wrapper });
    act(() => result.current.mutate({ themeId: THEME_ID, css: "x", lockVersion: 3 }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(isNetworkError(result.current.error)).toBe(true);
  });

  it("reset sets the draft to a version and returns the lock", async () => {
    const { server, queryClient, wrapper } = setup();
    const draft = makeDraft({ css: "v2{}", lock_version: 9 });
    server.on("POST", "/api/v1/themes/:id/draft/reset", json(draft, { headers: etag(9) }));

    const { result } = renderHook(() => useResetDraft(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ themeId: THEME_ID, versionNumber: 2, lockVersion: 8 }),
    );

    expect(locked.lockVersion).toBe(9);
    expect(server.calls[0]!.headers.get("If-Match")).toBe('"lv-8"');
    expect(server.calls[0]!.body).toEqual({ version_number: 2 });
    expect(queryClient.getQueryData<Draft>(themeKeys.draft(THEME_ID))?.css).toBe("v2{}");
  });
});

describe("lint", () => {
  it("lints the given css, or the stored draft with null, and skips undefined", async () => {
    const { server, wrapper } = setup();
    const issue = {
      line: 1,
      column: 5,
      rule: "external-url",
      severity: "error",
      message: "Externe url",
    };
    server.on("POST", "/api/v1/themes/:id/lint", ({ body }) =>
      json(makeLintResult({ errors: (body as { css?: string }).css ? [issue] : [] })),
    );

    const { result, rerender } = renderHook(({ css }) => useLint(THEME_ID, css), {
      wrapper,
      initialProps: { css: undefined as string | null | undefined },
    });
    expect(result.current.fetchStatus).toBe("idle");

    rerender({ css: "a{background:url(https://x)}" });
    await waitFor(() => expect(result.current.data?.errors).toEqual([issue]));
    expect(server.calls[0]!.body).toEqual({ css: "a{background:url(https://x)}" });

    rerender({ css: null });
    await waitFor(() => expect(result.current.data?.ok).toBe(true));
    expect(server.calls[1]!.body).toEqual({});
  });
});

describe("publish and rollback", () => {
  it("publish sends expected_lock_version and moves the cached lock", async () => {
    const { server, queryClient, wrapper } = setup();
    const version = makeVersion({ version_number: 8, message: "Sidebar donkerder" });
    server.on(
      "POST",
      "/api/v1/themes/:id/publish",
      json(version, { status: 201, headers: etag(5) }),
    );
    queryClient.setQueryData(themeKeys.draft(THEME_ID), makeDraft({ lock_version: 4 }));
    queryClient.setQueryData(themeKeys.detail(THEME_ID), theme);

    const { result } = renderHook(() => usePublishTheme(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({
        themeId: THEME_ID,
        expectedLockVersion: 4,
        message: "Sidebar donkerder",
      }),
    );

    expect(locked.data.version_number).toBe(8);
    expect(locked.lockVersion).toBe(5);
    expect(server.calls[0]!.body).toEqual({
      expected_lock_version: 4,
      message: "Sidebar donkerder",
    });
    expect(queryClient.getQueryData<Draft>(themeKeys.draft(THEME_ID))?.lock_version).toBe(5);
    expect(queryClient.getQueryState(themeKeys.detail(THEME_ID))?.isInvalidated).toBe(true);
  });

  it("publish reads the lock from the theme when the ETag is missing", async () => {
    const { server, wrapper } = setup();
    server
      .on("POST", "/api/v1/themes/:id/publish", json(makeVersion(), { status: 201 }))
      .on("GET", "/api/v1/themes/:id", json({ ...theme, lock_version: 7 }));

    const { result } = renderHook(() => usePublishTheme(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ themeId: THEME_ID, expectedLockVersion: 6, message: "" }),
    );

    expect(locked.lockVersion).toBe(7);
    expect(server.calls[0]!.body).toEqual({ expected_lock_version: 6, message: null });
  });

  it("publish exposes lint errors from a 422", async () => {
    const { server, wrapper } = setup();
    const issue = { line: 2, column: 1, rule: "html-in-css", severity: "error", message: "<" };
    server.on(
      "POST",
      "/api/v1/themes/:id/publish",
      problem(422, "theme_lint_failed", { errors: [issue] }),
    );

    const { result } = renderHook(() => usePublishTheme(), { wrapper });
    const error = await act(() =>
      result.current
        .mutateAsync({ themeId: THEME_ID, expectedLockVersion: 1 })
        .catch((e: ApiError) => e),
    );

    expect((error as ApiError).code).toBe("theme_lint_failed");
    expect(lintIssuesOf(error)).toEqual([issue]);
  });

  it("rollback sends If-Match and reloads the draft content", async () => {
    const { server, queryClient, wrapper } = setup();
    let draftCss = "old{}";
    server
      .on("POST", "/api/v1/themes/:id/rollback", () => {
        draftCss = "v4{}";
        return json(makeVersion({ version_number: 9, source: "rollback" }), {
          status: 201,
          headers: etag(11),
        });
      })
      .on("GET", "/api/v1/themes/:id/draft", () =>
        json(makeDraft({ css: draftCss, lock_version: draftCss === "old{}" ? 10 : 11 })),
      );

    const draft = renderHook(() => useDraft(THEME_ID), { wrapper }).result;
    await waitFor(() => expect(draft.current.data?.css).toBe("old{}"));

    const { result } = renderHook(() => useRollback(), { wrapper });
    const locked = await act(() =>
      result.current.mutateAsync({ themeId: THEME_ID, versionNumber: 4, lockVersion: 10 }),
    );

    expect(locked.lockVersion).toBe(11);
    const call = server.callsTo("POST")[0]!;
    expect(call.headers.get("If-Match")).toBe('"lv-10"');
    expect(call.body).toEqual({ version_number: 4, message: null });
    await waitFor(() => expect(draft.current.data?.css).toBe("v4{}"));
    expect(queryClient.getQueryData<Draft>(themeKeys.draft(THEME_ID))?.lock_version).toBe(11);
  });
});

describe("versions and diff", () => {
  it("pages through versions", async () => {
    const { server, wrapper } = setup();
    server.on("GET", "/api/v1/themes/:id/versions", ({ url }) =>
      json(
        url.searchParams.get("cursor")
          ? { items: [makeVersionSummary({ version_number: 1, is_live: false })] }
          : { items: [makeVersionSummary({ version_number: 2 })], next_cursor: "n1" },
      ),
    );

    const { result } = renderHook(() => useVersionsInfinite(THEME_ID, { limit: 1 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());

    await waitFor(() =>
      expect(flattenPages(result.current.data).map((v) => v.version_number)).toEqual([2, 1]),
    );
    expect(result.current.hasNextPage).toBe(false);
    expect(server.calls[0]!.url.searchParams.get("limit")).toBe("1");
    expect(server.calls[1]!.url.searchParams.get("cursor")).toBe("n1");
  });

  it("loads one version and a diff against the draft", async () => {
    const { server, wrapper } = setup();
    server
      .on("GET", "/api/v1/themes/:id/versions/:n", ({ params }) =>
        json(makeVersion({ version_number: Number(params.n) })),
      )
      .on("GET", "/api/v1/themes/:id/diff", ({ url }) =>
        json({
          from: Number(url.searchParams.get("from")),
          to: url.searchParams.get("to"),
          unified: "--- v6\n+++ draft\n",
          stats: { added: 14, removed: 3 },
        }),
      );

    const version = renderHook(() => useVersion(THEME_ID, 6), { wrapper }).result;
    const diff = renderHook(() => useDiff(THEME_ID, 6), { wrapper }).result;
    const idle = renderHook(() => useDiff(THEME_ID, null), { wrapper }).result;

    await waitFor(() => expect(version.current.data?.version_number).toBe(6));
    await waitFor(() => expect(diff.current.data?.stats).toEqual({ added: 14, removed: 3 }));
    expect(idle.current.fetchStatus).toBe("idle");
    const diffCall = server.callsTo("GET", "/api/v1/themes/:id/diff")[0]!;
    expect(Object.fromEntries(diffCall.url.searchParams)).toEqual({ from: "6", to: "draft" });
  });
});
