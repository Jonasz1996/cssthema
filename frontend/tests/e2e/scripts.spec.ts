import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, uniqueSlug } from "./support/fixtures";

/**
 * Thema-scripts (Jonas' `algemeen.js`): een `.js` uploaden in de tab Uploaden, terugvinden in
 * de tab Scripts, de publieke URL kopiëren, vervangen na de vraag en verwijderen (naar
 * `.scripts-archief/`). Achter nginx (E2E_BASE_URL) controleert de test ook `/<naam>.js`; via
 * `vite preview` bestaat die URL niet (alleen nginx serveert scripts).
 */
test("script uploaden, kopiëren, vervangen en verwijderen", async ({ page, request, api }) => {
  const name = uniqueSlug("script");
  const file = `${name}.js`;
  const body = (marker: string) => Buffer.from(`/* ${marker} */\nconsole.log("${name}");\n`);

  try {
    // Uploaden via de tab Uploaden: gaat naar /api/v1/scripts, niet naar de thema-import.
    await page.goto("/import");
    await page.getByRole("tab", { name: "Uploaden" }).click();
    await page.getByTestId("upload-input").setInputFiles({
      name: file,
      mimeType: "text/javascript",
      buffer: body("v1"),
    });
    const picked = page.locator(`[data-upload-file="${file}"]`);
    await expect(picked).toContainText("script");
    await expect(picked).toContainText(`→ /${file}`);
    await expect(page.getByLabel("Als de slug al bestaat")).toHaveCount(0);
    await page.getByRole("button", { name: "1 script uploaden" }).click();

    const result = page.locator(`[data-upload-result="${file}"]`).first();
    await expect(result).toContainText("nieuw script");
    await expect(result).toContainText(`/${file}`);
    expect(await api.findBySlug(name)).toBeUndefined();

    // Achter nginx is het script meteen publiek.
    const live = await request.get(`/${file}`);
    const servesScripts = /javascript/.test(live.headers()["content-type"] ?? "");
    if (servesScripts) expect(await live.text()).toContain("/* v1 */");

    // Naar de tab Scripts.
    await result.getByRole("link", { name: /Naar Scripts/ }).click();
    await page.waitForURL(/\/import\?tab=scripts$/);
    const row = page.locator(`[data-script="${name}"]`);
    await expect(row).toContainText("live");
    await expect(row).toContainText(file);
    const url = (await row.locator("code").first().textContent())?.trim() ?? "";
    expect(url).toMatch(new RegExp(`/${name}\\.js$`));

    // URL kopiëren.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await row.getByRole("button", { name: `URL van ${file} kopiëren` }).click();
    await expect(page.getByText(`Gekopieerd: ${url}`)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // Bekijken.
    await row.getByRole("button", { name: `${file} bekijken` }).click();
    const viewer = page.getByRole("dialog", { name: file });
    await expect(viewer.locator("[data-script-content]")).toContainText("/* v1 */");
    await viewer.getByRole("button", { name: "Sluiten" }).click();
    await expect(viewer).toHaveCount(0);

    // Opnieuw uploaden met dezelfde naam: eerst de vraag, dan vervangen.
    await page.getByTestId("script-upload-input").setInputFiles({
      name: file,
      mimeType: "text/javascript",
      buffer: body("v2"),
    });
    const question = page.getByRole("dialog", { name: `${file} bestaat al` });
    await expect(question).toContainText(".scripts-archief/");
    await question.getByRole("button", { name: "⟳ Vervangen", exact: true }).click();
    await expect(page.getByText(`${file} vervangen;`)).toBeVisible();
    const content = await request.get(`/api/v1/scripts/${name}`);
    expect(await content.text()).toContain("/* v2 */");

    // Verwijderen: bevestigen, rij weg, URL weg.
    await row.getByRole("button", { name: `${file} verwijderen` }).click();
    const confirm = page.getByRole("dialog", { name: `${file} verwijderen?` });
    await expect(confirm).toContainText("geeft daarna 404");
    await confirm.getByRole("button", { name: "⚡ Verwijderen", exact: true }).click();
    await expect(page.getByText(`${file} verwijderd;`)).toBeVisible();
    await expect(row).toHaveCount(0);
    expect((await request.get(`/api/v1/scripts/${name}`)).status()).toBe(404);
    if (servesScripts) expect((await request.get(`/${file}`)).status()).toBe(404);
  } finally {
    await request.delete(`/api/v1/scripts/${name}`);
    // Het archief opruimen als de map van de api hier lokaal staat (en leesbaar is: native
    // is `.scripts-archief/` 0750 van de gebruiker cssthema).
    const archive = join(await api.localFilesDir(), ".scripts-archief");
    try {
      if (existsSync(archive)) {
        for (const entry of readdirSync(archive)) {
          if (entry.startsWith(`${name}.`)) rmSync(join(archive, entry), { force: true });
        }
      }
    } catch {
      // Geen rechten: laten staan, het archief is niet publiek.
    }
  }
});
