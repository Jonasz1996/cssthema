import { describe, expect, it, vi } from "vitest";
import { readJson, readStorage, writeJson, writeStorage } from "@/lib/storage";

describe("storage", () => {
  it("leest en schrijft met het voorvoegsel cssthema.", () => {
    writeStorage("background", "off");
    expect(localStorage.getItem("cssthema.background")).toBe("off");
    expect(readStorage("background")).toBe("off");
    writeStorage("background", null);
    expect(readStorage("background")).toBeNull();
  });

  it("geeft bij ongeldige JSON de fallback", () => {
    localStorage.setItem("cssthema.open", "{kapot");
    expect(readJson("open", { a: true })).toEqual({ a: true });
    writeJson("open", { b: false });
    expect(readJson("open", {})).toEqual({ b: false });
  });

  it("overleeft een localStorage die exceptions gooit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("geblokkeerd", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("vol", "QuotaExceededError");
    });
    expect(readStorage("x")).toBeNull();
    expect(() => writeStorage("x", "1")).not.toThrow();
    expect(readJson("x", 5)).toBe(5);
  });
});
