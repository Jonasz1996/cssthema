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
