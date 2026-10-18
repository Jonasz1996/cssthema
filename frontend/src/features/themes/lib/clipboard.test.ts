import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  // jsdom kent geen execCommand; tests die het nodig hebben zetten een eigen versie.
  Reflect.deleteProperty(document, "execCommand");
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

describe("copyText", () => {
  it("gebruikt het klembord in een veilige context", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    await expect(copyText("hallo")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hallo");
  });

  it("valt terug op execCommand zonder veilige context (LAN over http)", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    vi.stubGlobal("isSecureContext", false);
    let copied = "";
    document.execCommand = vi.fn(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    await expect(copyText("http://192.168.1.5/x.css")).resolves.toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(copied).toBe("http://192.168.1.5/x.css");
    // Het hulpveld is weg en de focus staat terug.
    expect(document.querySelector("textarea")).toBeNull();
    expect(button).toHaveFocus();
    button.remove();
  });

  it("valt terug als het klembord weigert, en meldt als alles faalt", async () => {
    stubClipboard(() => Promise.reject(new Error("geen toestemming")));
    document.execCommand = vi.fn(() => false);
    await expect(copyText("x")).resolves.toBe(false);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("zonder klembord en zonder execCommand lukt het niet", async () => {
    await expect(copyText("x")).resolves.toBe(false);
  });
});
