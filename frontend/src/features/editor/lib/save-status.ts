import type { Locale, MessageKey } from "@/lib/i18n";
import type { SaveState } from "../autosave/draft-session";
import { formatTime } from "./format";

export interface SaveStatusView {
  /** `ok` groen · `mid` oranje · `err` rood · `busy` grijs. */
  tone: "ok" | "mid" | "err" | "busy";
  icon: string;
  key: MessageKey;
  params?: Record<string, string>;
}

/** Tekst en kleur van de autosave-toestand in de statusbalk. */
export function saveStatusView(state: SaveState, locale: Locale): SaveStatusView {
  switch (state.kind) {
    case "saved":
      return state.at
        ? {
            tone: "ok",
            icon: "✓",
            key: "editor.saveSavedAt",
            params: { time: formatTime(state.at, locale) },
          }
        : { tone: "ok", icon: "✓", key: "editor.saveSaved" };
    case "pending":
    case "saving":
      return { tone: "busy", icon: "●", key: "editor.saveSaving" };
    case "conflict":
      return { tone: "err", icon: "⚠", key: "editor.saveConflict" };
    case "offline":
      return { tone: "mid", icon: "⚡", key: "editor.saveOffline" };
    case "error":
      return { tone: "err", icon: "✕", key: "editor.saveError" };
  }
}
