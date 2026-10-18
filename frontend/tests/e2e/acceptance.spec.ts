import { expectSaved, saveStatus, typeAtEnd, waitForEditor } from "./support/editor";
import { expect, test, uniqueSlug } from "./support/fixtures";

/**
 * Acceptatie van fase 1 (docs/07 § 4): thema maken → CSS typen → autosave → publiceren →
 * `GET /<slug>.css` 200 + ETag → `If-None-Match` → 304 → rollback → nieuwe ETag.
 * Alles in de UI, behalve de CSS-requests (zoals `curl` ze zou doen).
 */
test("thema maken, publiceren, ETag/304 en rollback", async ({ page, api, request }) => {
  const slug = uniqueSlug("accept");
  const name = `E2E acceptatie ${slug.slice(-8)}`;

  // 1. Thema maken in de UI.
  await page.goto("/themes");
  await page.getByRole("button", { name: "+ Nieuw" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Nieuw thema" });
  await dialog.getByLabel("Naam").fill(name);
  await dialog.getByLabel("Slug (URL)").fill(slug);
  await expect(dialog).toContainText(`/${slug}.css`);
  await dialog.getByRole("button", { name: "Aanmaken" }).click();
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  const themeId = page.url().split("/").pop()!;
  api.track(themeId);
  await waitForEditor(page);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // 2. CSS typen; de statusbalk toont eerst "Opslaan…" en daarna "Opgeslagen hh:mm:ss".
  await typeAtEnd(page, "body { color: #112233; }");
  await expect(saveStatus(page)).toContainText("Opslaan…");
  await expectSaved(page);
  expect((await api.draft(themeId)).css).toContain("body { color: #112233; }");

  // 3. Publiceren (Ctrl+S opent de dialoog) → v1.
  await page.keyboard.press("Control+s");
  let publish = page.getByRole("dialog", { name: `${slug} publiceren` });
  await expect(publish).toContainText("eerste versie");
  await expect(publish).toContainText(`/${slug}.css`);
  await publish.getByLabel("Bericht").fill("Eerste versie");
  await publish.getByRole("button", { name: "v1 publiceren" }).click();
  await expect(publish).toBeHidden();
  await expect(page.getByText(`v1 van ${slug} staat live.`)).toBeVisible();

  // 4. Tweede versie (de knop in de kopbalk) → v2.
  await typeAtEnd(page, " a { color: #445566; }");
  await expectSaved(page);
  await page.getByRole("button", { name: "Publiceren", exact: true }).click();
  publish = page.getByRole("dialog", { name: `${slug} publiceren` });
  await expect(publish).toContainText("Wijzigingen t.o.v. v1");
  await publish.getByRole("button", { name: "v2 publiceren" }).click();
  await expect(page.getByText(`v2 van ${slug} staat live.`)).toBeVisible();

  // 5. Publieke CSS: 200 + ETag, daarna 304 met If-None-Match.
  const first = await request.get(`/${slug}.css`);
  expect(first.status()).toBe(200);
  const headers = first.headers();
  expect(headers["content-type"]).toMatch(/^text\/css/);
  expect(headers["x-cssthema-version"]).toBe("2");
  const etagV2 = headers["etag"]!;
  expect(etagV2).toMatch(/^"sha256-[0-9a-f]{16}"$/);
  const body = await first.text();
  expect(body).toMatch(new RegExp(`^/\\*! cssthema · ${slug} · v2 `));
  expect(body).toContain("#445566");

  const notModified = await request.get(`/${slug}.css`, { headers: { "If-None-Match": etagV2 } });
  expect(notModified.status()).toBe(304);
  expect(notModified.headers()["etag"]).toBe(etagV2);
  expect(await notModified.body()).toHaveLength(0);

  // Dezelfde levering via /themes/<slug>.css en de vaste versie /themes/<slug>@1.css.
  expect((await request.get(`/themes/${slug}.css`)).headers()["etag"]).toBe(etagV2);
  const pinned = await request.get(`/themes/${slug}@1.css`);
  expect(pinned.status()).toBe(200);
  expect(pinned.headers()["cache-control"]).toContain("immutable");

  // 6. Rollback naar v1 in de UI (pagina Versies) → v3 met de CSS van v1.
  await page.getByRole("link", { name: "Versies", exact: true }).click();
  await page.waitForURL(/\/versions/);
  const list = page.getByRole("region", { name: "Versies, nieuwste eerst" });
  await list.getByRole("button", { name: /^v1\b/ }).click();
  await page.getByRole("button", { name: "↺ Terugzetten naar v1" }).click();
  const confirm = page.getByRole("dialog", { name: "Terugzetten naar v1?" });
  await expect(confirm).toContainText("nieuwe versie v3");
  await confirm.getByRole("button", { name: "Terugzetten naar v1" }).click();
  await expect(page.getByText("v1 staat weer live als v3.")).toBeVisible();
  await expect(list.getByRole("button", { name: /^v3 live rollback van v1\b/ })).toBeVisible();

  // 7. Nieuwe ETag; de oude geeft geen 304 meer.
  const afterRollback = await request.get(`/${slug}.css`, {
    headers: { "If-None-Match": etagV2 },
  });
  expect(afterRollback.status()).toBe(200);
  const etagV3 = afterRollback.headers()["etag"]!;
  expect(etagV3).toMatch(/^"sha256-[0-9a-f]{16}"$/);
  expect(etagV3).not.toBe(etagV2);
  expect(afterRollback.headers()["x-cssthema-version"]).toBe("3");
  const rolledBack = await afterRollback.text();
  expect(rolledBack).toContain("#112233");
  expect(rolledBack).not.toContain("#445566");
  expect(
    (await request.get(`/${slug}.css`, { headers: { "If-None-Match": etagV3 } })).status(),
  ).toBe(304);

  const theme = await api.theme(themeId);
  expect(theme.published_version).toMatchObject({ version_number: 3, source: "rollback" });
});
