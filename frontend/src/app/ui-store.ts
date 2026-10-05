import { create } from "zustand";

export type ColorMode = "dark" | "light";

interface UiState {
  colorMode: ColorMode;
  toggleColorMode: () => void;
}

function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement;
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
}

/** Global UI state (layout, colour mode). Feature-specific stores live in their feature folder. */
export const useUiStore = create<UiState>((set, get) => ({
  colorMode: "dark",
  toggleColorMode: () => {
    const next: ColorMode = get().colorMode === "dark" ? "light" : "dark";
    applyColorMode(next);
    set({ colorMode: next });
  },
}));
