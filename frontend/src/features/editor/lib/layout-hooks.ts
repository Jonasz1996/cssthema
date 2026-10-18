import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

/** Of een media query nu geldt; rendert opnieuw bij een wijziging. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * Hoogte zodat het element tot onderaan het venster loopt (min. `min` px), bv. de editor in de
 * app-kaart. Geeft `[attach, height]` terug; `attach` is een callback-ref: het element mag later verschijnen (na het laden).
 * Volgt venstergrootte en verschuivingen erboven (de shell-header die omloopt).
 */
export function useFillHeight({ bottom = 70, min = 480 }: { bottom?: number; min?: number } = {}): [
  attach: (element: HTMLElement | null) => void,
  height: number,
] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(min);

  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(min, Math.floor(window.innerHeight - top - bottom)));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [element, bottom, min]);

  return [setElement, height];
}

/** Waarde die pas na `delay` ms stilte volgt (bv. CSS voor de lint). */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
