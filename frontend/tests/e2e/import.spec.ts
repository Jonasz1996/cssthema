import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeZip } from "../../src/features/import/testing";
import { expect, test, uniqueSlug } from "./support/fixtures";

/**
 * Import van handgemaakte CSS (Jonas' migratie, F-TM-05): een bestand in `CSS_FILES_DIR` wordt
 * een thema (v1 live) en verhuist naar `.geimporteerd/`, zodat dezelfde URL het thema serveert.
 */
test("handgemaakt bestand op de server importeren", async ({ page, api, request }) => {
  const dir = await api.localFilesDir();
  test.skip(!existsSync(dir), `CSS_FILES_DIR van de api (${dir}) is niet lokaal bereikbaar`);

  const slug = uniqueSlug("hand");
  const file = `${slug}.css`;
  writeFileSync(join(dir, file), "/* handgemaakt */\n.app {\n  background: #101820;\n}\n");
  const archived = join(dir, ".geimporteerd", file);
  try {
    // Achter nginx (installatie zonder Docker) serveert die het bestand zelf; zonder nginx
    // (vite preview, Docker zonder css-files) bestaat de URL nog niet.
    const before = await request.get(`/${file}`);
    if (before.status() === 200) expect(await before.text()).toContain("/* handgemaakt */");
    else expect(before.status()).toBe(404);

    // Het dashboard wijst op de gevonden bestanden.
    await page.goto("/");
    const callout = page.locator("[data-local-files-callout]");
    await expect(callout).toContainText(/\d+ handgemaakte? CSS-bestand/);
    await callout.getByRole("link", { name: "Importeren" }).click();
    await page.waitForURL(/\/import$/);

    const table = page.getByRole("table", { name: "Handgemaakte CSS-bestanden op de server" });
    await expect(table.getByRole("row").filter({ hasText: file })).toContainText("importeerbaar");
    await page.getByRole("checkbox", { name: `${file} selecteren` }).check();
    await expect(page.getByRole("checkbox", { name: "Meteen publiceren (v1 live)" })).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Daarna archiveren naar .geimporteerd/" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "1 bestand importeren" }).click();

    const result = page.locator(`[data-imported="${file}"]`);
    await expect(result).toBeVisible();
    await expect(result).toContainText("gearchiveerd");
    await expect(result.locator('[data-badge="live"]')).toHaveText("v1 live");

    const theme = await api.findBySlug(slug);
    expect(theme).toBeDefined();
    api.track(theme!.id);
    expect(theme!.published_version).toMatchObject({ version_number: 1, source: "import" });

    // Het bestand staat in .geimporteerd/ en dezelfde URL levert nu het thema (nginx valt
    // door naar de api).
    expect(existsSync(join(dir, file))).toBe(false);
    expect(existsSync(archived)).toBe(true);
    const css = await request.get(`/${slug}.css`);
    expect(css.status()).toBe(200);
    const body = await css.text();
    expect(body).toMatch(new RegExp(`^/\\*! cssthema · ${slug} · v1 `));
    expect(body).toContain("#101820");
  } finally {
    rmSync(join(dir, file), { force: true });
    rmSync(archived, { force: true });
  }
});

test("CSS-bestand uploaden en meteen publiceren", async ({ page, api, request }) => {
  const slug = uniqueSlug("upload");
  const file = `${slug}.css`;

  await page.goto("/import");
  await page.getByRole("tab", { name: "Uploaden" }).click();
  await page.getByTestId("upload-input").setInputFiles({
    name: file,
    mimeType: "text/css",
    buffer: Buffer.from("body { color: var(--ct-fg, #c0ffee); }\n"),
  });
  await expect(page.locator(`[data-upload-file="${file}"]`)).toBeVisible();
  await page.getByLabel("Publiceren").selectOption("yes");
  await page.getByRole("button", { name: "1 bestand importeren" }).click();

  const result = page.locator(`[data-upload-result="${file}"]`).first();
  await expect(result).toContainText("nieuw thema");
  await expect(result.locator('[data-badge="live"]')).toHaveText("v1 live");

  const theme = await api.findBySlug(slug);
  expect(theme).toBeDefined();
  api.track(theme!.id);
  const css = await request.get(`/${slug}.css`);
  expect(css.status()).toBe(200);
  expect(await css.text()).toContain("#c0ffee");
});

/**
 * Een gewone zip met losse `.css`-bestanden (zoals Jonas' `alg-themas.zip`): de browser pakt hem
 * uit en elk bestand wordt een eigen thema.
 */
test("zip met losse CSS-bestanden uploaden", async ({ page, api, request }) => {
  const slugs = [uniqueSlug("zip-a"), uniqueSlug("zip-b")];
  const zip = await makeZip([
    { name: "themas/", data: "" },
    ...slugs.map((slug, index) => ({
      name: `themas/${slug}.css`,
      data: `body { color: #0${index}c0ff; }\n`,
    })),
    { name: "themas/LEESMIJ.txt", data: "uitleg" },
  ]);

  await page.goto("/import");
  await page.getByRole("tab", { name: "Uploaden" }).click();
  await page.getByTestId("upload-input").setInputFiles({
    name: "themas.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  for (const slug of slugs) {
    await expect(page.locator(`[data-upload-file="${slug}.css"]`)).toBeVisible();
  }
  await expect(page.locator('[data-upload-file="themas.zip"]')).toHaveCount(0);
  await expect(page.getByText("themas.zip uitgepakt: 2 bestanden.")).toBeVisible();
  await page.getByLabel("Publiceren").selectOption("yes");
  await page.getByRole("button", { name: "2 bestanden importeren" }).click();

  for (const [index, slug] of slugs.entries()) {
    const result = page.locator(`[data-upload-result="${slug}.css"]`).first();
    await expect(result).toContainText("nieuw thema");
    await expect(result.locator('[data-badge="live"]')).toHaveText("v1 live");
    const theme = await api.findBySlug(slug);
    expect(theme).toBeDefined();
    api.track(theme!.id);
    const css = await request.get(`/${slug}.css`);
    expect(css.status()).toBe(200);
    expect(await css.text()).toContain(`#0${index}c0ff`);
  }
});
