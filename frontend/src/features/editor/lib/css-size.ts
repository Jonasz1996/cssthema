import { utf8Length } from "./format";

/** Vanaf zoveel tekens wordt de grootte pas na een korte pauze in het typen opnieuw geteld. */
export const SIZE_DEBOUNCE_FROM = 64 * 1024;
export const SIZE_DEBOUNCE_MS = 250;

export type SizeTone = "ok" | "mid" | "err";

/** Toon van de grootte t.o.v. de limiet van de server: > 90 % waarschuwing, > 100 % fout. */
export function sizeTone(bytes: number, maxBytes: number | null | undefined): SizeTone {
  if (!maxBytes || maxBytes <= 0) return "ok";
  if (bytes > maxBytes) return "err";
  if (bytes > maxBytes * 0.9) return "mid";
  return "ok";
}

export interface TextSource {
  getSnapshot: () => { css: string };
  subscribe: (listener: () => void) => () => void;
}

export interface ByteCounter {
  getBytes: () => number;
  subscribe: (listener: () => void) => () => void;
}

/**
 * UTF-8-grootte van de tekst van een sessie, voor `useSyncExternalStore`. Kleine teksten worden
 * meteen geteld; grote pas na `SIZE_DEBOUNCE_MS` zonder wijziging, zodat niet elke toets over
 * honderden kilobytes loopt.
 */
export function createByteCounter(
  source: TextSource | undefined,
  { delayMs = SIZE_DEBOUNCE_MS, debounceFrom = SIZE_DEBOUNCE_FROM } = {},
): ByteCounter {
  let measured: string | null = null;
  let bytes = 0;
  const measure = () => {
    const css = source?.getSnapshot().css ?? "";
    if (css === measured) return false;
    measured = css;
    bytes = utf8Length(css);
    return true;
  };
  measure();
  return {
    getBytes: () => bytes,
    subscribe: (listener) => {
      if (!source) return () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const update = () => {
        timer = undefined;
        if (measure()) listener();
      };
      const unsubscribe = source.subscribe(() => {
        clearTimeout(timer);
        if (source.getSnapshot().css.length < debounceFrom) update();
        else timer = setTimeout(update, delayMs);
      });
      // Gewijzigd tussen aanmaken en abonneren.
      update();
      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    },
  };
}
