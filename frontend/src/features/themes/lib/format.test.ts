import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatDateTime, formatRelativeTime } from "./format";

describe("formatBytes", () => {
  it("toont bytes, KB en MB in de taal van de UI", () => {
    expect(formatBytes(0, "nl")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(3482, "nl")).toBe("3,4 KB");
    expect(formatBytes(3482, "en")).toBe("3.4 KB");
    expect(formatBytes(2048, "en")).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024, "nl")).toBe("1,5 MB");
  });

  it("verdraagt onzin", () => {
    expect(formatBytes(Number.NaN, "nl")).toBe("0 B");
    expect(formatBytes(-5, "nl")).toBe("0 B");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 9, 5, 8, 0, 0).getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("seconden, minuten en uren", () => {
    expect(formatRelativeTime(ago(10_000), "en", now)).toBe("now");
    expect(formatRelativeTime(ago(5 * 60_000), "en", now)).toMatch(/^5 min\.? ago$/);
    expect(formatRelativeTime(ago(3 * 3_600_000), "en", now)).toMatch(/^3 hr\.? ago$/);
    expect(formatRelativeTime(ago(5 * 60_000), "nl", now)).toMatch(/5 min\.? geleden/);
  });

  it("telt kalenderdagen: gisteren 23:00 is om 08:00 'gisteren'", () => {
    const lateYesterday = new Date(2026, 9, 4, 23, 0, 0).toISOString();
    // Minder dan een dag oud → uren.
    expect(formatRelativeTime(lateYesterday, "en", now)).toMatch(/9 hr/);
    const yesterdayMorning = new Date(2026, 9, 4, 7, 0, 0).toISOString();
    expect(formatRelativeTime(yesterdayMorning, "en", now)).toBe("yesterday");
    expect(formatRelativeTime(yesterdayMorning, "nl", now)).toBe("gisteren");
    const threeDays = new Date(2026, 9, 2, 12, 0, 0).toISOString();
    expect(formatRelativeTime(threeDays, "en", now)).toMatch(/^3 days ago$/);
  });

  it("vanaf een week de datum zelf", () => {
    const old = new Date(2026, 8, 1, 12, 0, 0).toISOString();
    expect(formatRelativeTime(old, "en", now)).toBe(formatDate(old, "en"));
  });

  it("toekomst telt als nu; ongeldig wordt leeg", () => {
    expect(formatRelativeTime(new Date(now + 60_000).toISOString(), "en", now)).toBe("now");
    expect(formatRelativeTime(null, "nl", now)).toBe("");
    expect(formatRelativeTime("geen datum", "nl", now)).toBe("");
  });
});

describe("formatDate / formatDateTime", () => {
  it("geeft een leesbare datum of niets", () => {
    const iso = new Date(2026, 9, 5, 12, 4).toISOString();
    expect(formatDate(iso, "en")).toContain("2026");
    expect(formatDateTime(iso, "en")).toContain("12:04");
    expect(formatDate(undefined, "en")).toBe("");
    expect(formatDateTime("x", "en")).toBe("");
  });
});
