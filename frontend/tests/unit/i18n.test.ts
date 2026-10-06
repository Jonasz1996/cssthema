import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  flattenNamespaces,
  getLocale,
  intlLocale,
  isLocale,
  messageKeys,
  setLocale,
  subscribeLocale,
  t,
  tc,
  useI18n,
} from "@/lib/i18n";
import { en, nl } from "@/locales";

describe("flattenNamespaces()", () => {
  it("voegt namespaces samen tot één platte map met voorvoegsel", () => {
    expect(
      flattenNamespaces({
        nav: { themes: "Thema's", palettes: "Paletten" },
        common: { close: "Sluiten" },
      }),
    ).toEqual({ "nav.themes": "Thema's", "nav.palettes": "Paletten", "common.close": "Sluiten" });
  });

  it("weigert geneste objecten en niet-tekst", () => {
    expect(() => flattenNamespaces({ nav: { deep: { x: "y" } } })).toThrow("nav.deep");
    expect(() => flattenNamespaces({ nav: { count: 3 } })).toThrow(TypeError);
  });
});

describe("vertaalbestanden", () => {
  const namespaces = Object.keys(en) as (keyof typeof en)[];

  it("hebben dezelfde namespaces en sleutels in nl en en", () => {
    expect(Object.keys(nl).sort()).toEqual(namespaces.slice().sort());
    for (const ns of namespaces) {
      expect(Object.keys(nl[ns]).sort(), ns).toEqual(Object.keys(en[ns]).sort());
    }
  });

  it("bevatten alleen niet-lege teksten", () => {
    for (const dict of [en, nl]) {
      for (const [ns, messages] of Object.entries(dict)) {
        for (const [key, value] of Object.entries(messages)) {
          expect(typeof value === "string" && value.trim().length > 0, `${ns}.${key}`).toBe(true);
        }
      }
    }
  });

  it("gebruiken dezelfde {placeholders} in beide talen", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const ns of Object.keys(en) as (keyof typeof en)[]) {
      for (const [key, value] of Object.entries(en[ns])) {
        const other = (nl[ns] as Record<string, string>)[key] ?? "";
        expect(placeholders(other), `${ns}.${key}`).toEqual(placeholders(value as string));
      }
    }
  });

  it("levert sleutels in de vorm <namespace>.<sleutel>", () => {
    const keys = messageKeys();
    expect(keys).toContain("nav.themes");
    expect(keys).toContain("common.close");
    expect(keys.every((key) => /^[a-z]+\.[A-Za-z0-9_.]+$/.test(key))).toBe(true);
    expect(new Set(keys.map((k) => k.split(".")[0]))).toEqual(
      new Set(["common", "nav", "dashboard", "themes", "editor", "versions", "palettes", "import"]),
    );
  });
});

describe("t() en tc()", () => {
  it("is standaard Nederlands", () => {
    expect(DEFAULT_LOCALE).toBe("nl");
    expect(getLocale()).toBe("nl");
    expect(t("nav.palettes")).toBe("Paletten");
  });

  it("wisselt naar Engels en zet <html lang>", () => {
    setLocale("en");
    expect(t("nav.palettes")).toBe("Palettes");
    expect(document.documentElement.lang).toBe("en");
  });

  it("vult {placeholders} in en laat onbekende staan", () => {
    expect(t("common.statusTitle", { state: "ok" })).toBe("Systeemstatus (/readyz): ok");
    expect(t("common.statusTitle")).toBe("Systeemstatus (/readyz): {state}");
    expect(t("common.statusTitle", { other: 1 })).toBe("Systeemstatus (/readyz): {state}");
  });

  it("geeft de sleutel terug als die nergens bestaat", () => {
    expect(t("nav.bestaatniet" as never)).toBe("nav.bestaatniet");
  });

  it("kiest het juiste meervoud per taal", () => {
    expect(tc("themes.count", 1)).toBe("1 thema");
    expect(tc("themes.count", 0)).toBe("0 thema's");
    expect(tc("themes.count", 1234)).toBe("1.234 thema's");
    setLocale("en");
    expect(tc("themes.count", 1)).toBe("1 theme");
    expect(tc("themes.count", 1234)).toBe("1,234 themes");
  });

  it("kent alleen nl en en", () => {
    expect(isLocale("nl")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(intlLocale("nl")).toBe("nl-BE");
    expect(intlLocale("en")).toBe("en-GB");
  });
});

describe("taalwissel voor componenten", () => {
  it("verwittigt luisteraars alleen bij een echte wissel", () => {
    const listener = vi.fn();
    const stop = subscribeLocale(listener);
    setLocale("nl");
    expect(listener).not.toHaveBeenCalled();
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setLocale("nl");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("useI18n() rendert opnieuw in de nieuwe taal met stabiele functies per taal", () => {
    const { result } = renderHook(() => useI18n());
    const dutch = result.current;
    expect(dutch.locale).toBe("nl");
    expect(dutch.t("nav.palettes")).toBe("Paletten");
    expect(dutch.tc("themes.count", 2)).toBe("2 thema's");

    act(() => setLocale("en"));
    expect(result.current.locale).toBe("en");
    expect(result.current.t("nav.palettes")).toBe("Palettes");
    expect(result.current.tc("themes.count", 1)).toBe("1 theme");
    // Een functie van vóór de wissel blijft zijn eigen taal gebruiken.
    expect(dutch.t("nav.palettes")).toBe("Paletten");

    act(() => setLocale("nl"));
    expect(result.current).toBe(dutch);
  });
});
