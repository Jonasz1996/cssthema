import { editorText, expectSaved, saveStatus, typeAtEnd, waitForEditor } from "./support/editor";
import { expect, test, uniqueSlug } from "./support/fixtures";

/**
 * Conflictdialoog (F-ED-10, docs/05 § 5.1): iemand anders slaat de draft op terwijl de editor
 * open staat; de volgende autosave krijgt 412 en de gebruiker kiest.
 */
test.describe("conflict bij autosave", () => {
  test("mijn versie overschrijven", async ({ page, api }) => {
    const slug = uniqueSlug("conflict");
    const theme = await api.createTheme({
      name: `E2E conflict ${slug.slice(-8)}`,
      slug,
      css: "/* basis */\n",
    });
    await page.goto(`/editor/${theme.id}`);
    await waitForEditor(page);

    // Een collega slaat intussen een andere draft op (met de juiste If-Match).
    await api.putDraft(theme.id, "/* basis, aangepast door een collega */\n");

    await typeAtEnd(page, ".mine { color: #abcdef; }");
    const dialog = page.getByRole("dialog", { name: "Draft elders gewijzigd" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(saveStatus(page)).toContainText("Conflict");
    await expect(dialog).toContainText("Je tekst blijft in de editor staan");

    // De diff tussen serverdraft en mijn versie.
    await dialog.getByRole("button", { name: "Diff bekijken" }).click();
    await expect(dialog.locator(".monaco-diff-editor")).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: "Mijn versie overschrijven" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Jouw versie is opgeslagen.")).toBeVisible();
    await expectSaved(page);

    const { css } = await api.draft(theme.id);
    expect(css).toContain(".mine { color: #abcdef; }");
    expect(css).not.toContain("collega");
  });

  test("serverdraft herladen", async ({ page, api }) => {
    const slug = uniqueSlug("reload");
    const theme = await api.createTheme({
      name: `E2E herladen ${slug.slice(-8)}`,
      slug,
      css: "/* basis */\n",
    });
    await page.goto(`/editor/${theme.id}`);
    await waitForEditor(page);

    await api.putDraft(theme.id, "/* versie van de collega */\n");
    await typeAtEnd(page, ".mine { color: #abcdef; }");
    const dialog = page.getByRole("dialog", { name: "Draft elders gewijzigd" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    await dialog.getByRole("button", { name: "Herladen" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Serverdraft geladen.")).toBeVisible();
    await expect.poll(() => editorText(page)).toContain("versie van de collega");
    expect(await editorText(page)).not.toContain(".mine");
    await expect(saveStatus(page)).toContainText("Opgeslagen");
    expect((await api.draft(theme.id)).css).toBe("/* versie van de collega */\n");
  });
});
