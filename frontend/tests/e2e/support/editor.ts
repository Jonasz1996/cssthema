import { expect, type Locator, type Page } from "@playwright/test";

/** Wacht tot Monaco klaar is (lazy chunk + workers) en de preview zijn bridge heeft. */
export async function waitForEditor(page: Page): Promise<void> {
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("iframe[data-ready=true]")).toBeAttached({ timeout: 15_000 });
}

/** De autosave-indicator in de statusbalk ("Opslaan…", "Opgeslagen 12:04:31", "Conflict" …). */
export function saveStatus(page: Page): Locator {
  return page.getByRole("group", { name: "Statusbalk" }).getByRole("status");
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toContainText(/Opgeslagen \d{1,2}:\d{2}/, { timeout: 15_000 });
}

/**
 * Typt CSS aan het einde van het bestand, toets voor toets zoals een gebruiker (Monaco sluit
 * `{` zelf af; een getypte `}` schrijft daar overheen). Esc sluit een open suggestielijst.
 */
export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Escape");
}

/** De tekst die Monaco toont (zonder verborgen regels; genoeg voor korte bestanden). */
export async function editorText(page: Page): Promise<string> {
  const lines = await page.locator(".monaco-editor .view-lines .view-line").allInnerTexts();
  return lines.join("\n").replace(/\u00a0/g, " ");
}
