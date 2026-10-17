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

  it("parses like the host bundle: a top-level return breaks it", () => {
    // build_js zet het script los in een try; in een functie zou deze return wel mogen.
    const result = checkScriptSyntax("if (!document.body) return;\nstart();");
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message", expect.stringMatching(/return/i));
    expect(checkScriptSyntax("(function () { if (!document.body) return; })();").ok).toBe(true);
  });

  it("accepts old non-strict scripts, as the browser does", () => {
    expect(checkScriptSyntax('var reset = "\\033[0m"; with (Math) { max(1, 2); }').ok).toBe(true);
    expect(checkScriptSyntax("var await = 1; console.log(await);").ok).toBe(true);
  });

  it("runs nothing, also not hoisted functions or code after a closing brace", () => {
    const ran = vi.fn();
    vi.stubGlobal("ranScript", ran);
    expect(checkScriptSyntax("function boot() { ranScript(); }\nboot();").ok).toBe(true);
    expect(checkScriptSyntax("} catch (e) {} ranScript(); try {").ok).toBe(true);
    expect(ran).not.toHaveBeenCalled();
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
