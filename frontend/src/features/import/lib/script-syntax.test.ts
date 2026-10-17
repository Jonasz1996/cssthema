import { afterEach, describe, expect, it, vi } from "vitest";
import { checkScriptSyntax } from "./script-syntax";

describe("checkScriptSyntax", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a valid script without running it", () => {
    const ran = vi.fn();
    vi.stubGlobal("ranScript", ran);
    expect(checkScriptSyntax("'use strict'; ranScript(); // einde zonder newline")).toEqual({
      ok: true,
    });
    expect(ran).not.toHaveBeenCalled();
  });

  it("reports a syntax error, also for import statements", () => {
    const broken = checkScriptSyntax("const x = {a: 1,, b: 2};");
    expect(broken.ok).toBe(false);
    expect(broken).toHaveProperty("message", expect.stringMatching(/\S/));
    expect(checkScriptSyntax('import x from "./x.js";').ok).toBe(false);
    expect(checkScriptSyntax("function () {").ok).toBe(false);
  });

  it("cannot check when eval is blocked (CSP) and then lets the server decide", () => {
    vi.stubGlobal(
      "Function",
      vi.fn(() => {
        throw new EvalError("unsafe-eval");
      }),
    );
    expect(checkScriptSyntax("a(")).toEqual({ ok: null });
  });
});
