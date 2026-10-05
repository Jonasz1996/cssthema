import { describe, expect, it } from "vitest";
import { isNavItemActive, isWideRoute, mainNav } from "@/app/nav";
import { routeCommand } from "@/app/shell-command";

describe("routeCommand()", () => {
  it.each([
    ["/", "cssthema dashboard"],
    ["", "cssthema dashboard"],
    ["/themes", "cssthema themes"],
    ["/themes/", "cssthema themes"],
    ["/palettes", "cssthema palettes"],
    ["/import", "cssthema import"],
    ["/editor/proxmox", "cssthema edit proxmox"],
    ["/editor/proxmox/versions", "cssthema versions proxmox"],
    ["/services/proxmox", "cssthema services proxmox"],
    ["/editor/caf%C3%A9", "cssthema edit café"],
    ["/editor/%E0%A4%A", "cssthema edit %E0%A4%A"],
  ])("%s → %s", (path, command) => {
    expect(routeCommand(path)).toBe(command);
  });
});

describe("navigatie", () => {
  const item = (to: string) => mainNav.find((n) => n.to === to)!;

  it("bevat precies dashboard, thema's, paletten en import", () => {
    expect(mainNav.map((n) => n.to)).toEqual(["/", "/themes", "/palettes", "/import"]);
    expect(mainNav.map((n) => n.emoji)).toEqual(["📊", "🎨", "🖌️", "📥"]);
  });

  it("markeert dashboard alleen exact op /", () => {
    expect(isNavItemActive(item("/"), "/")).toBe(true);
    expect(isNavItemActive(item("/"), "/themes")).toBe(false);
  });

  it("markeert thema's op /themes, eronder en in de editor", () => {
    expect(isNavItemActive(item("/themes"), "/themes")).toBe(true);
    expect(isNavItemActive(item("/themes"), "/themes/x")).toBe(true);
    expect(isNavItemActive(item("/themes"), "/editor/abc/versions")).toBe(true);
    expect(isNavItemActive(item("/themes"), "/themesx")).toBe(false);
    expect(isNavItemActive(item("/palettes"), "/editor/abc")).toBe(false);
  });

  it("maakt alleen de editor breed", () => {
    expect(isWideRoute("/editor/abc")).toBe(true);
    expect(isWideRoute("/editor")).toBe(false);
    expect(isWideRoute("/themes")).toBe(false);
  });
});
