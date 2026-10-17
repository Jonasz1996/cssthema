import { afterEach, describe, expect, it } from "vitest";
import { makeServiceSummary, makeSnapshotSummary, makeTheme } from "@/api/testing/fixtures";
import {
  DEMO_SOURCE,
  defaultPreviewSource,
  findSnapshot,
  MAX_REMEMBERED_SOURCES,
  resolvePreviewSource,
  snapshotGroups,
  usePreviewSourceStore,
} from "../preview/source";

const newest = makeSnapshotSummary({ page: "start" });
const older = makeSnapshotSummary({ page: "instellingen" });
const proxmox = makeServiceSummary({
  hostname: "proxmox.lan",
  slug: "proxmox-lan",
  snapshots: [makeSnapshotSummary({ page: "zonder", has_document: false }), newest, older],
});
const grafanaSnapshot = makeSnapshotSummary();
const grafana = makeServiceSummary({
  hostname: "grafana.example.org",
  slug: "grafana-example-org",
  snapshots: [grafanaSnapshot],
});
const sonarrSnapshot = makeSnapshotSummary();
const sonarr = makeServiceSummary({
  hostname: "tv.lan",
  slug: "sonarr-tv",
  snapshots: [sonarrSnapshot],
});
const empty = makeServiceSummary({ hostname: "aaa.lan", slug: "aaa", snapshots: [] });
const groups = snapshotGroups([proxmox, grafana, sonarr, empty]);
const theme = (slug: string, serviceId: string | null = null) =>
  makeTheme({ slug, service_id: serviceId });

afterEach(() => {
  usePreviewSourceStore.setState({ choices: {} });
});

describe("snapshot groups", () => {
  it("keeps only snapshots with a document, services sorted by hostname", () => {
    expect(groups.map((group) => group.hostname)).toEqual([
      "grafana.example.org",
      "proxmox.lan",
      "tv.lan",
    ]);
    expect(groups[1]!.snapshots.map((snapshot) => snapshot.page)).toEqual([
      "start",
      "instellingen",
    ]);
    expect(findSnapshot(groups, older.id)?.group.hostname).toBe("proxmox.lan");
    expect(findSnapshot(groups, "onbekend")).toBeNull();
  });
});

describe("default preview source", () => {
  it("uses the newest snapshot of the linked service", () => {
    expect(defaultPreviewSource(theme("whatever", proxmox.id), groups)).toBe(newest.id);
  });

  it("matches alg-<x> and <x> on the hostname or the service slug", () => {
    expect(defaultPreviewSource(theme("proxmox"), groups)).toBe(newest.id);
    expect(defaultPreviewSource(theme("alg-grafana"), groups)).toBe(grafanaSnapshot.id);
    expect(defaultPreviewSource(theme("sonarr"), groups)).toBe(sonarrSnapshot.id);
    // Een gekoppelde dienst zonder snapshots: dan de heuristiek.
    expect(defaultPreviewSource(theme("proxmox", empty.id), groups)).toBe(newest.id);
  });

  it("falls back to the demo page", () => {
    expect(defaultPreviewSource(theme("nord"), groups)).toBe(DEMO_SOURCE);
    expect(defaultPreviewSource(theme("alg-"), groups)).toBe(DEMO_SOURCE);
    expect(defaultPreviewSource(theme("grafana-nord"), groups)).toBe(DEMO_SOURCE);
    expect(defaultPreviewSource(theme("proxmox"), [])).toBe(DEMO_SOURCE);
  });
});

describe("default preview source with host bindings", () => {
  const extra = makeServiceSummary({
    hostname: "proxmox2.lan",
    slug: "proxmox2-lan",
    snapshots: [makeSnapshotSummary()],
  });
  const all = snapshotGroups([proxmox, grafana, sonarr, extra]);
  const usage = (hostnames: string[], isDefault = false, bound: string[] = hostnames) => ({
    hostnames,
    default: isDefault,
    bound,
  });

  it("prefers a host whose own binding contains the theme", () => {
    // alg-kern past bij geen naam, maar zit in de koppeling van tv.lan.
    expect(defaultPreviewSource(theme("alg-kern"), all, usage(["tv.lan"]))).toBe(sonarrSnapshot.id);
    // Ook boven de naam: alg-grafana zit alleen in de stapel van proxmox.lan.
    expect(defaultPreviewSource(theme("alg-grafana"), all, usage(["proxmox.lan"]))).toBe(newest.id);
    // Hosts zonder snapshot tellen niet: dan de naam.
    expect(defaultPreviewSource(theme("alg-grafana"), all, usage(["nergens.lan"]))).toBe(
      grafanaSnapshot.id,
    );
  });

  it("picks the host that also matches the name among several", () => {
    const hosts = usage(["grafana.example.org", "proxmox2.lan", "proxmox.lan"]);
    expect(defaultPreviewSource(theme("alg-proxmox"), all, hosts)).toBe(newest.id);
    expect(defaultPreviewSource(theme("alg-kern"), all, hosts)).toBe(grafanaSnapshot.id);
  });

  it("uses a host without own binding when only * contains the theme", () => {
    const hosts = usage([], true, ["grafana.example.org", "proxmox.lan"]);
    expect(defaultPreviewSource(theme("algemeen"), all, hosts)).toBe(extra.snapshots[0]!.id);
    // Alles heeft een eigen koppeling: de demo.
    const bound = usage(
      [],
      true,
      all.map((group) => group.hostname),
    );
    expect(defaultPreviewSource(theme("algemeen"), all, bound)).toBe(DEMO_SOURCE);
  });

  it("skips hosts whose snapshot is an error or login page", () => {
    const broken = makeServiceSummary({
      hostname: "aaa.lan",
      slug: "aaa-lan",
      snapshots: [makeSnapshotSummary({ status: "http-502", title: "502 Bad Gateway" })],
    });
    const login = makeServiceSummary({
      hostname: "abc.lan",
      slug: "abc-lan",
      snapshots: [makeSnapshotSummary({ status: "inlogpagina" })],
    });
    const withBroken = snapshotGroups([broken, login, proxmox, extra]);
    const viaDefault = usage([], true, ["proxmox.lan"]);
    expect(defaultPreviewSource(theme("algemeen"), withBroken, viaDefault)).toBe(
      extra.snapshots[0]!.id,
    );
    const own = usage(["aaa.lan", "abc.lan", "proxmox.lan"]);
    expect(defaultPreviewSource(theme("alg-kern"), withBroken, own)).toBe(newest.id);
    // Alleen kapotte: dan toch die (de stapel is er wel).
    expect(defaultPreviewSource(theme("alg-kern"), withBroken, usage(["aaa.lan"]))).toBe(
      broken.snapshots[0]!.id,
    );
  });

  it("waits for the bindings unless they failed or there is nothing to choose", () => {
    expect(resolvePreviewSource(undefined, theme("alg-kern"), all, false, "loading")).toBeNull();
    expect(resolvePreviewSource(undefined, theme("alg-kern"), all, false, null)).toBe(DEMO_SOURCE);
    expect(resolvePreviewSource(undefined, theme("alg-kern"), [], false, "loading")).toBe(
      DEMO_SOURCE,
    );
    // Een bewaarde keuze hoeft er niet op te wachten.
    expect(resolvePreviewSource(older.id, theme("alg-kern"), all, false, "loading")).toBe(older.id);
  });
});

describe("resolvePreviewSource", () => {
  const nord = theme("nord");
  it("prefers a stored choice that still exists", () => {
    expect(resolvePreviewSource(DEMO_SOURCE, theme("proxmox"), groups, false)).toBe(DEMO_SOURCE);
    expect(resolvePreviewSource(older.id, nord, groups, false)).toBe(older.id);
    // De lijst laadt nog: de bewaarde snapshot alvast tonen.
    expect(resolvePreviewSource(older.id, nord, undefined, false)).toBe(older.id);
  });

  it("falls back to the default when the stored snapshot is gone", () => {
    expect(resolvePreviewSource("verdwenen", theme("proxmox"), groups, false)).toBe(newest.id);
    expect(resolvePreviewSource("verdwenen", nord, groups, false)).toBe(DEMO_SOURCE);
  });

  it("waits for the services, and uses the demo page when they fail", () => {
    expect(resolvePreviewSource(undefined, nord, undefined, false)).toBeNull();
    expect(resolvePreviewSource(undefined, nord, undefined, true)).toBe(DEMO_SOURCE);
    expect(resolvePreviewSource(undefined, theme("proxmox"), groups, false)).toBe(newest.id);
  });
});

describe("remembered choices", () => {
  it("keeps the newest choices per theme, up to the limit", () => {
    const { choose } = usePreviewSourceStore.getState();
    for (let i = 0; i < MAX_REMEMBERED_SOURCES + 5; i++) choose(`thema-${i}`, DEMO_SOURCE);
    choose("thema-5", "snapshot-x");
    const choices = usePreviewSourceStore.getState().choices;
    expect(Object.keys(choices)).toHaveLength(MAX_REMEMBERED_SOURCES);
    expect(choices).not.toHaveProperty("thema-0");
    expect(Object.keys(choices).at(-1)).toBe("thema-5");
    expect(choices["thema-5"]).toBe("snapshot-x");
  });

  it("ignores invalid stored data", async () => {
    localStorage.setItem(
      "cssthema.editor.previewSource",
      JSON.stringify({ state: { choices: { a: "demo", b: 3, c: "" } }, version: 1 }),
    );
    await usePreviewSourceStore.persist.rehydrate();
    expect(usePreviewSourceStore.getState().choices).toEqual({ a: "demo" });
  });
});
