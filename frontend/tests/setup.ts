import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useUiStore } from "@/app/ui-store";
import { useToastStore } from "@/components/ui/toast";
import { fx } from "@/lib/fx";
import { setLocale } from "@/lib/i18n";
import { installMatchMedia, setReducedMotion } from "./helpers";

installMatchMedia();

// ScrollRestoration van React Router scrolt na elke navigatie; jsdom kent geen scrollTo.
window.scrollTo = (() => {}) as typeof window.scrollTo;

// jsdom heeft geen canvas; zonder deze stub logt elke getContext() "Not implemented".
// Tests die tekenen gebruiken mockCanvasContext().
HTMLCanvasElement.prototype.getContext = function getContext() {
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
  fx.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setReducedMotion(false);
  localStorage.clear();
  useToastStore.getState().clear();
  setLocale("nl");
  useUiStore.setState({ backgroundEnabled: true, commandOverride: null });
  document.getElementById("fx-top")?.remove();
  document.getElementById("fx-flash")?.remove();
  Reflect.deleteProperty(document, "hidden");
});
