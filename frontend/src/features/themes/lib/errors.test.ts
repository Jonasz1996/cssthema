import { describe, expect, it } from "vitest";
import { ApiError, NETWORK_ERROR } from "@/api/client";
import type { Problem } from "@/api/types";
import { t } from "@/lib/i18n";
import { errorText } from "./errors";
import { countOf, listOf } from "./list";
import { editorPath, exportFilename } from "./actions";

function apiError(status: number, code: string, message: string, withProblem = true) {
  const problem = withProblem
    ? ({ type: "about:blank", title: message, status, code, detail: message } as Problem)
    : null;
  return new ApiError({ status, code, title: message, detail: message, problem });
}

describe("errorText", () => {
  it("toont in het Nederlands de tekst van de server", () => {
    const error = apiError(409, "slug_conflict", "Slug 'proxmox' is al in gebruik.");
    expect(errorText(error, { t, locale: "nl" })).toBe("Slug 'proxmox' is al in gebruik.");
  });

  it("vertaalt bekende codes in het Engels", () => {
    const error = apiError(409, "slug_conflict", "Slug 'proxmox' is al in gebruik.");
    expect(errorText(error, { t, locale: "en" })).toBe(t("themes.errorSlugConflict"));
  });

  it("houdt de servertekst bij een onbekende code", () => {
    const error = apiError(400, "iets_nieuws", "Server says no");
    expect(errorText(error, { t, locale: "en" })).toBe("Server says no");
  });

  it("netwerk- en serverfouten zonder body krijgen een eigen tekst", () => {
    const network = new ApiError({ status: 0, code: NETWORK_ERROR, title: "Failed to fetch" });
    expect(errorText(network, { t, locale: "nl" })).toBe(t("themes.errorNetwork"));
    const bare = apiError(502, "http_502", "Bad Gateway", false);
    expect(errorText(bare, { t, locale: "nl" })).toBe(t("themes.errorServer"));
  });

  it("toont geen tekst van een proxy (HTML, Engels) bij een 4xx zonder Problem-body", () => {
    const html = apiError(413, "http_413", "<html>413 Request Entity Too Large</html>", false);
    expect(errorText(html, { t, locale: "nl" })).toBe(t("themes.errorTooLarge"));
    const other = apiError(404, "http_404", "<html>Not Found</html>", false);
    expect(errorText(other, { t, locale: "nl" })).toBe(
      "De server weigerde het verzoek (HTTP 404).",
    );
  });

  it("vertaalt de 409 van publiceren in het Engels", () => {
    const error = apiError(
      409,
      "state_conflict",
      "De draft is gelijk aan de live versie; er valt niets te publiceren.",
    );
    expect(errorText(error, { t, locale: "en" })).toBe(t("themes.errorStateConflict"));
  });

  it("eigen sleutels per scherm gaan in het Engels voor; Nederlands blijft de servertekst", () => {
    const error = apiError(404, "not_found", "Script niet gevonden.");
    const keys = { not_found: "import.scriptErrorNotFound" } as const;
    expect(errorText(error, { t, locale: "en" }, keys)).toBe(t("import.scriptErrorNotFound"));
    expect(errorText(error, { t, locale: "en" })).toBe(t("themes.errorNotFound"));
    expect(errorText(error, { t, locale: "nl" }, keys)).toBe("Script niet gevonden.");
  });

  it("geweigerde schrijfacties (CSRF, niet via de proxy) krijgen een uitleg", () => {
    const csrf = apiError(403, "csrf_failed", "Verzoek van een andere site geweigerd");
    expect(errorText(csrf, { t, locale: "en" })).toBe(t("themes.errorCsrf"));
    // De 403 van nginx is ook een Problem; in het Nederlands blijft zijn eigen uitleg staan.
    const proxy = apiError(403, "proxy_required", "cssthema aanvaardt wijzigingen alleen via NPM.");
    expect(errorText(proxy, { t, locale: "en" })).toBe(t("themes.errorProxyRequired"));
    expect(errorText(proxy, { t, locale: "nl" })).toBe(
      "cssthema aanvaardt wijzigingen alleen via NPM.",
    );
  });

  it("een gewone fout is onbekend", () => {
    expect(errorText(new Error("boem"), { t, locale: "nl" })).toBe(t("themes.errorUnknown"));
  });
});

describe("listOf / countOf", () => {
  it("geeft altijd een lijst zonder lege elementen", () => {
    expect(listOf(undefined)).toEqual([]);
    expect(listOf(null)).toEqual([]);
    expect(listOf({} as unknown as number[])).toEqual([]);
    expect(listOf([1, null, 2] as unknown as number[])).toEqual([1, 2]);
  });

  it("geeft een eindig getal of null", () => {
    expect(countOf(3)).toBe(3);
    expect(countOf(0)).toBe(0);
    expect(countOf("3")).toBeNull();
    expect(countOf(Number.NaN)).toBeNull();
    expect(countOf(undefined)).toBeNull();
  });
});

describe("editorPath / exportFilename", () => {
  it("bouwt de editor-URL en bestandsnamen", () => {
    expect(editorPath("abc")).toBe("/editor/abc");
    expect(editorPath("a/b")).toBe("/editor/a%2Fb");
    expect(exportFilename("proxmox", "css")).toBe("proxmox.css");
    expect(exportFilename("proxmox", "bundle")).toBe("proxmox.cssthema.zip");
  });
});
