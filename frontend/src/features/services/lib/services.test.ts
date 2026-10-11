import { describe, expect, it } from "vitest";
import { makeServiceSummary, makeSnapshotSummary } from "@/api/testing/fixtures";
import {
  CAPTURE_MAX_BYTES,
  captureProblem,
  filterServices,
  safeHttpUrl,
  screenshotsOf,
  statusHintKey,
  statusLabelKey,
  statusTone,
} from "./services";

describe("services", () => {
  it.each([
    ["ok", "ok"],
    ["inlogpagina", "default"],
    ["authentik-login", "default"],
    ["geen-html", "default"],
    ["http-502", "err"],
    ["http-500", "err"],
    ["fout", "err"],
    ["http-404", "mid"],
    ["iets-nieuws", "default"],
    [null, "default"],
  ] as const)("statusTone(%s) = %s", (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it("vertaalt bekende statussen en laat de rest zoals hij is", () => {
    expect(statusLabelKey("inlogpagina")).toBe("services.statusLogin");
    expect(statusLabelKey("http-502")).toBeNull();
    expect(statusLabelKey(null)).toBe("services.statusNone");
    expect(statusHintKey("http-502")).toBe("services.statusHintHttp");
    expect(statusHintKey("iets-nieuws")).toBeNull();
  });

  it("filtert op naam, hostnaam en met of zonder snapshot", () => {
    const proxmox = makeServiceSummary({ name: "Proxmox", hostname: "pve.example" });
    const vault = makeServiceSummary({
      name: "Vaultwarden",
      hostname: "vault.example",
      snapshots: [makeSnapshotSummary({ has_document: false })],
    });
    const empty = makeServiceSummary({ name: "Leeg", hostname: "leeg.example", snapshots: [] });
    const all = [proxmox, vault, empty];
    expect(filterServices(all, " PVE ", "all")).toEqual([proxmox]);
    expect(filterServices(all, "proxmox", "all")).toEqual([proxmox]);
    expect(filterServices(all, "", "with")).toEqual([proxmox]);
    expect(filterServices(all, "", "without")).toEqual([vault, empty]);
    expect(filterServices(all, "vault", "with")).toEqual([]);
  });

  it("screenshots in vaste volgorde, alleen die er zijn", () => {
    const snapshot = makeSnapshotSummary({ screenshots: { mobiel: "/m", origineel: "/o" } });
    expect(screenshotsOf(snapshot)).toEqual(["origineel", "mobiel"]);
    expect(screenshotsOf(undefined)).toEqual([]);
  });

  it("controleert een bestand vóór het uploaden", () => {
    const file = (name: string, size: number) =>
      Object.defineProperty(new File(["x"], name), "size", { value: size });
    expect(captureProblem(file("deel1.ZIP", 10))).toBeNull();
    expect(captureProblem(file("deel1.tar", 10))).toBe("type");
    expect(captureProblem(file("deel1.zip", 0))).toBe("empty");
    expect(captureProblem(file("deel1.zip", CAPTURE_MAX_BYTES + 1))).toBe("tooLarge");
  });

  it("linkt alleen naar http(s)", () => {
    expect(safeHttpUrl("https://pve.example:8006/")).toBe("https://pve.example:8006/");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("geen url")).toBeNull();
  });
});
