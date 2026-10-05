import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  api,
  ApiError,
  fieldErrorsOf,
  filenameFromContentDisposition,
  ifMatch,
  isAbortError,
  isNetworkError,
  isPreconditionFailed,
  lintIssuesOf,
  lockEtag,
  MISSING_ETAG,
  NETWORK_ERROR,
  parseLockEtag,
  readApiError,
  readLock,
  saveBlob,
  send,
  sendDownload,
  sendLocked,
  shouldRetry,
  toFormData,
} from "@/api/client";
import { createFetchMock, etag, json, problem } from "@/api/testing/fetch-mock";
import { makeDraft, makeTheme, testId } from "@/api/testing/fixtures";

const THEME_ID = testId(1);

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "cssthema_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
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

  it("sends the CSRF cookie as X-CSRF-Token on mutating calls only", async () => {
    document.cookie = "cssthema_csrf=tok%3D123";
    const server = createFetchMock()
      .on("GET", "/api/v1/themes/:id", json(makeTheme()))
      .on("DELETE", "/api/v1/themes/:id", new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", server.fetch);

    await api.GET("/api/v1/themes/{theme_id}", { params: { path: { theme_id: THEME_ID } } });
    await api.DELETE("/api/v1/themes/{theme_id}", { params: { path: { theme_id: THEME_ID } } });

    expect(server.calls[0]!.headers.has("X-CSRF-Token")).toBe(false);
    expect(server.calls[1]!.headers.get("X-CSRF-Token")).toBe("tok=123");
  });
});

describe("ETag / If-Match", () => {
  it("formats and parses lock ETags, also weak ones", () => {
    expect(lockEtag(12)).toBe('"lv-12"');
    expect(ifMatch(3)).toEqual({ "If-Match": '"lv-3"' });
    expect(parseLockEtag('"lv-12"')).toBe(12);
    expect(parseLockEtag(' W/"lv-7" ')).toBe(7);
    expect(parseLockEtag('"sha256-abc"')).toBeNull();
    expect(parseLockEtag("lv-12")).toBeNull();
    expect(parseLockEtag(null)).toBeNull();
  });

  it("reads the lock from the ETag header, else from lock_version in the body", () => {
    const withHeader = new Response("{}", { headers: { ETag: 'W/"lv-9"' } });
    expect(readLock(withHeader, { lock_version: 2 })).toEqual({ etag: 'W/"lv-9"', lockVersion: 9 });
    expect(readLock(new Response("{}"), { lock_version: 2 })).toEqual({
      etag: '"lv-2"',
      lockVersion: 2,
    });
    expect(readLock(new Response("{}"), { id: "x" })).toBeNull();
  });

  it("sendLocked returns data with the new lock version", async () => {
    const server = createFetchMock().on(
      "PUT",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ lock_version: 5 }), { headers: etag(5) }),
    );
    vi.stubGlobal("fetch", server.fetch);

    const result = await sendLocked(
      api.PUT("/api/v1/themes/{theme_id}/draft", {
        params: { path: { theme_id: THEME_ID }, header: ifMatch(4) },
        body: { css: "a{}" },
      }),
    );

    expect(result.lockVersion).toBe(5);
    expect(result.etag).toBe('"lv-5"');
    expect(result.data.css).toBe("body { color: red; }\n");
    expect(server.calls[0]!.headers.get("If-Match")).toBe('"lv-4"');
    expect(server.calls[0]!.body).toEqual({ css: "a{}" });
  });

  it("sendLocked asks the fallback, or fails with missing_etag", async () => {
    const server = createFetchMock().on("GET", "/api/v1/meta", json({ name: "x" }));
    vi.stubGlobal("fetch", server.fetch);

    const viaFallback = await sendLocked(api.GET("/api/v1/meta"), () => Promise.resolve(11));
    expect(viaFallback.lockVersion).toBe(11);
    expect(viaFallback.etag).toBe('"lv-11"');

    await expect(sendLocked(api.GET("/api/v1/meta"))).rejects.toMatchObject({
      code: MISSING_ETAG,
    });
  });
});

describe("Problem Details", () => {
  it("turns a 412 into an ApiError with current state", async () => {
    const server = createFetchMock().on(
      "PUT",
      "/api/v1/themes/:id/draft",
      problem(412, "precondition_failed", {
        title: "Draft is intussen gewijzigd",
        request_id: "req-1",
        current: {
          etag: '"lv-14"',
          lock_version: 14,
          updated_by: { id: testId(9), display_name: "Anna" },
          updated_at: "2026-10-05T12:04:29Z",
        },
      }),
    );
    vi.stubGlobal("fetch", server.fetch);

    const error = await send(
      api.PUT("/api/v1/themes/{theme_id}/draft", {
        params: { path: { theme_id: THEME_ID }, header: ifMatch(12) },
        body: { css: "" },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(isPreconditionFailed(error)).toBe(true);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(412);
    expect(apiError.code).toBe("precondition_failed");
    expect(apiError.message).toBe("Draft is intussen gewijzigd");
    expect(apiError.requestId).toBe("req-1");
    expect(apiError.current).toEqual({
      etag: '"lv-14"',
      lock_version: 14,
      updated_by: { id: testId(9), display_name: "Anna" },
      updated_at: "2026-10-05T12:04:29Z",
    });
  });

  it("exposes lint issues of a 422 theme_lint_failed", async () => {
    const issue = {
      line: 14,
      column: 3,
      rule: "external-url",
      severity: "error",
      message: "url() naar https://evil.example is niet toegestaan",
    };
    const response = problem(422, "theme_lint_failed", {
      title: "CSS bevat fouten",
      detail: "Publiceren geweigerd: 1 fout gevonden.",
      errors: [issue, { nonsense: true }],
    });

    const error = await readApiError(response);

    expect(error.message).toBe("Publiceren geweigerd: 1 fout gevonden.");
    expect(error.errors).toHaveLength(2);
    expect(lintIssuesOf(error)).toEqual([issue]);
    expect(isPreconditionFailed(error)).toBe(false);
  });

  it("maps validation errors per field", async () => {
    const error = await readApiError(
      problem(422, "validation_error", {
        errors: [
          { loc: ["body", "name"], msg: "Field required", type: "missing" },
          { loc: ["body", "template", "id"], msg: "Invalid UUID", type: "uuid_parsing" },
          { loc: ["body", "name"], msg: "second message", type: "x" },
        ],
      }),
    );
    expect(fieldErrorsOf(error)).toEqual({ name: "Field required", "template.id": "Invalid UUID" });
    expect(fieldErrorsOf(new Error("x"))).toEqual({});
  });

  it("falls back to http_<status> for a non-problem body, without HTML as detail", async () => {
    const error = await readApiError(
      new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    expect(error.code).toBe("http_502");
    expect(error.title).toBe("Bad Gateway");
    // Een nginx-foutpagina is geen tekst voor een melding.
    expect(error.detail).toBeNull();
    expect(error.message).toBe("Bad Gateway");
    expect(error.current).toBeNull();

    const plain = await readApiError(
      new Response("upstream timed out", {
        status: 504,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    expect(plain.detail).toBe("upstream timed out");
  });

  it("wraps a failing fetch as network_error and keeps aborts as aborts", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const offline = await send(api.GET("/api/v1/dashboard")).catch((e: unknown) => e);
    expect(isNetworkError(offline)).toBe(true);
    expect((offline as ApiError).status).toBe(0);
    expect((offline as ApiError).code).toBe(NETWORK_ERROR);

    vi.stubGlobal("fetch", () => Promise.reject(new DOMException("Aborted", "AbortError")));
    const aborted = await send(api.GET("/api/v1/dashboard")).catch((e: unknown) => e);
    expect(aborted).not.toBeInstanceOf(ApiError);
    expect(isAbortError(aborted)).toBe(true);
  });

  it("retries only network and gateway errors, at most twice", () => {
    const err = (status: number) => new ApiError({ status, code: "x", title: "x" });
    expect(shouldRetry(0, err(0))).toBe(true);
    expect(shouldRetry(1, err(503))).toBe(true);
    expect(shouldRetry(2, err(503))).toBe(false);
    expect(shouldRetry(0, err(404))).toBe(false);
    expect(shouldRetry(0, err(412))).toBe(false);
    expect(shouldRetry(0, new Error("boom"))).toBe(false);
  });
});

describe("multipart", () => {
  it("builds FormData: skips empty values, stringifies booleans, keeps file names", () => {
    const form = toFormData({
      file: { blob: new Blob(["a{}"], { type: "text/css" }), filename: "proxmox.css" },
      on_conflict: "rename",
      publish: false,
      name: null,
      skipped: undefined,
      names: ["a.css", "b.css"],
    });
    expect((form.get("file") as File).name).toBe("proxmox.css");
    expect(form.get("on_conflict")).toBe("rename");
    expect(form.get("publish")).toBe("false");
    expect(form.has("name")).toBe(false);
    expect(form.has("skipped")).toBe(false);
    expect(form.getAll("names")).toEqual(["a.css", "b.css"]);
  });
});

describe("downloads", () => {
  it.each([
    ['attachment; filename="proxmox.css"', "proxmox.css"],
    ["attachment; filename=proxmox.cssthema.zip", "proxmox.cssthema.zip"],
    [`attachment; filename="x.css"; filename*=UTF-8''th%C3%A9ma%20nieuw.css`, "théma nieuw.css"],
    ['attachment; filename="..\\\\..\\/etc/passwd"', ".._.._etc_passwd"],
    ['attachment; filename="a \\"b\\".css"', 'a "b".css'],
    ["attachment", null],
    [null, null],
  ])("reads the filename from %s", (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected);
  });

  it("sendDownload returns blob, filename and content type", async () => {
    const server = createFetchMock().on(
      "GET",
      "/api/v1/themes/:id/export",
      () =>
        new Response(new TextEncoder().encode("body{}"), {
          headers: {
            "Content-Type": "text/css; charset=utf-8",
            "Content-Disposition": 'attachment; filename="proxmox.css"',
          },
        }),
    );
    vi.stubGlobal("fetch", server.fetch);

    const file = await sendDownload(
      api.GET("/api/v1/themes/{theme_id}/export", {
        params: { path: { theme_id: THEME_ID }, query: { format: "css" } },
        parseAs: "blob",
      }),
      "fallback.css",
    );

    expect(file.filename).toBe("proxmox.css");
    expect(file.contentType).toBe("text/css; charset=utf-8");
    expect(await file.blob.text()).toBe("body{}");
  });

  it("saveBlob clicks a temporary download link and revokes the URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test/1");
    const revokeObjectURL = vi.fn();
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    onTestFinished(() => {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    saveBlob(new Blob(["x"]), "proxmox.css");

    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("proxmox.css");
    expect(clicked[0]!.href).toBe("blob:test/1");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test/1");
  });
});
