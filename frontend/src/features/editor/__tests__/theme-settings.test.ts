import { describe, expect, it } from "vitest";
import { makeTheme, testId } from "@/api/testing/fixtures";
import { themeSettingsForm, themeSettingsPatch } from "../lib/theme-settings";

const theme = makeTheme({
  name: "Proxmox",
  slug: "proxmox",
  description: "Donker",
  palette_id: testId(5),
});

describe("themeSettingsPatch", () => {
  it("sends nothing for an untouched form", () => {
    expect(themeSettingsPatch(theme, themeSettingsForm(theme))).toEqual({});
    const bare = makeTheme({ description: null, palette_id: null });
    expect(themeSettingsPatch(bare, themeSettingsForm(bare))).toEqual({});
  });

  it("sends only the changed fields, trimmed", () => {
    const form = { ...themeSettingsForm(theme), name: " Proxmox Nord ", slug: " proxmox-nord " };
    expect(themeSettingsPatch(theme, form)).toEqual({ name: "Proxmox Nord", slug: "proxmox-nord" });
    expect(
      themeSettingsPatch(theme, { ...themeSettingsForm(theme), paletteId: testId(6) }),
    ).toEqual({ palette_id: testId(6) });
  });

  it("empties description and palette with null; spaces alone are no change", () => {
    const form = { ...themeSettingsForm(theme), description: "   ", paletteId: "" };
    expect(themeSettingsPatch(theme, form)).toEqual({ description: null, palette_id: null });
    expect(
      themeSettingsPatch(theme, { ...themeSettingsForm(theme), description: " Donker " }),
    ).toEqual({});
  });

  it("an empty name or slug leaves the field as it is", () => {
    expect(themeSettingsPatch(theme, { ...themeSettingsForm(theme), name: " ", slug: "" })).toEqual(
      {},
    );
  });
});
