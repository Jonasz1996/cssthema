import { useSyncExternalStore } from "react";

/** Media query voor gebruikers die minder beweging willen (OS-instelling). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/**
 * Of animaties uit moeten. Wordt bij elke aanroep opnieuw gelezen, zodat een wijziging van de
 * OS-instelling meteen geldt (effecten, ripple, achtergrond).
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** React-hook die opnieuw rendert als de reduced-motion-instelling wijzigt. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
