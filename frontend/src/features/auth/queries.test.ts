import { describe, expect, it } from "vitest";
import { resetCommand } from "./queries";

describe("resetCommand", () => {
  it("geeft het commando met het e-mailadres in kleine letters", () => {
    expect(resetCommand(" Jonas@Example.be ")).toBe("cssthema-account reset jonas@example.be");
  });
  it("zet een ongewoon adres tussen aanhalingstekens", () => {
    expect(resetCommand("a'b;c@x.be")).toBe("cssthema-account reset 'a'\\''b;c@x.be'");
  });
  it("geen commando zonder geldig adres", () => {
    expect(resetCommand("jonas")).toBeNull();
    expect(resetCommand("")).toBeNull();
  });
});
