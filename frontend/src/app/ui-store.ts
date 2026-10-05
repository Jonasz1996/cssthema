import { create } from "zustand";
import { DEFAULT_LOCALE, isLocale, type Locale, setLocale as applyLocale } from "@/lib/i18n";
import { readStorage, writeStorage } from "@/lib/storage";

/** localStorage-sleutels (met voorvoegsel `cssthema.`). */
export const BACKGROUND_STORAGE_KEY = "background";
export const LOCALE_STORAGE_KEY = "locale";

interface UiState {
  /** Bewegende achtergrond (deeltjesnetwerk) aan; bewaard per browser. */
  backgroundEnabled: boolean;
  setBackgroundEnabled: (enabled: boolean) => void;
  /**
   * Wisselt de taal van de UI en bewaart de keuze (Nederlands tenzij de gebruiker Engels koos).
   * De huidige taal zelf staat in `@/lib/i18n` (`useI18n().locale`), niet in deze store.
   */
  setLocale: (locale: Locale) => void;
  /** Commando in de terminalbalk dat een pagina zelf zet (bv. `cssthema edit proxmox`). */
  commandOverride: string | null;
  setCommandOverride: (command: string | null) => void;
}

function storedLocale(): Locale {
  const value = readStorage(LOCALE_STORAGE_KEY);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

applyLocale(storedLocale());

/** Globale UI-toestand van de shell. Feature-specifieke stores staan in hun feature-map. */
export const useUiStore = create<UiState>((set) => ({
  backgroundEnabled: readStorage(BACKGROUND_STORAGE_KEY) !== "off",
  setBackgroundEnabled: (enabled) => {
    writeStorage(BACKGROUND_STORAGE_KEY, enabled ? "on" : "off");
    set({ backgroundEnabled: enabled });
  },
  setLocale: (locale) => {
    applyLocale(locale);
    writeStorage(LOCALE_STORAGE_KEY, locale);
  },
  commandOverride: null,
  setCommandOverride: (commandOverride) => set({ commandOverride }),
}));
