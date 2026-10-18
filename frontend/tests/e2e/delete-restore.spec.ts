import { expectSaved, typeAtEnd, waitForEditor } from "./support/editor";
import { expect, test, uniqueSlug } from "./support/fixtures";

/** Verwijderen (soft delete, bliksem) en herstellen op de pagina Thema's (F-TM-08). */
test("thema verwijderen en herstellen", async ({ page, api, request }) => {
  const slug = uniqueSlug("delete");
  const name = `E2E verwijderen ${slug.slice(-8)}`;
  const theme = await api.createTheme({ name, slug, css: "body { color: #0a0b0c; }\n" });
  await api.publish(theme.id);
  expect((await request.get(`/${slug}.css`)).status()).toBe(200);

  await page.goto(`/themes?q=${slug}`);
  const card = page.locator(`[data-theme-card="${slug}"]`);
  await expect(card.locator('[data-badge="live"]')).toHaveText("v1 live");

  // Verwijderen via het menu van de kaart, met bevestiging.
  await card.getByRole("button", { name: `Acties voor ${name}` }).click();
  await page.getByRole("menuitem", { name: "Verwijderen…" }).click();
  const confirm = page.getByRole("dialog", { name: `${name} verwijderen?` });
  await expect(confirm).toContainText(`${slug}.css`);
  await confirm.getByRole("button", { name: /Verwijderen$/ }).click();
  await expect(card).toBeHidden();
  await expect(page.getByText(`${name} verwijderd.`)).toBeVisible();

  expect((await api.theme(theme.id)).deleted_at).not.toBeNull();
  const gone = await request.get(`/${slug}.css`);
  expect(gone.status()).toBe(404);
  expect(await gone.text()).toContain(`theme "${slug}" not found`);

  // Terugvinden met het statusfilter en herstellen.
  await page.getByLabel("Status").selectOption("deleted");
  await expect(page).toHaveURL(/status=deleted/);
  await expect(card.locator('[data-badge="deleted"]')).toBeVisible();
  await card.getByRole("button", { name: `${name} herstellen` }).click();
  await expect(page.getByText(`${name} hersteld.`)).toBeVisible();
  await expect(card).toBeHidden();

  expect((await api.theme(theme.id)).deleted_at).toBeNull();
  const back = await request.get(`/${slug}.css`);
  expect(back.status()).toBe(200);
  expect(await back.text()).toContain("#0a0b0c");

  await page.getByLabel("Status").selectOption("all");
  await expect(card.locator('[data-badge="live"]')).toHaveText("v1 live");
});

/**
 * Verwijderen + herstellen verhoogt de lock_version zonder dat de draft verandert. Een editor die
 * intussen open stond, mag daarna gewoon verder opslaan in plaats van een vals conflict te tonen.
 */
test("na verwijderen en herstellen elders gewoon verder bewerken", async ({ page, api }) => {
  const slug = uniqueSlug("restore-edit");
  const theme = await api.createTheme({
    name: `E2E herstellen ${slug.slice(-8)}`,
    slug,
    css: "/* basis */\n",
  });
  await page.goto(`/editor/${theme.id}`);
  await waitForEditor(page);
  await typeAtEnd(page, ".eerst { color: #111111; }");
  await expectSaved(page);
  const before = (await api.theme(theme.id)).lock_version;

  // Een collega verwijdert het thema in een ander tabblad en herstelt het meteen.
  await api.softDelete(theme.id);
  const restored = await api.restore(theme.id);
  expect(restored.lock_version).toBeGreaterThan(before);

  await typeAtEnd(page, "\n.daarna { color: #222222; }");
  await expectSaved(page);
  await expect(page.getByRole("dialog", { name: "Draft elders gewijzigd" })).toBeHidden();
  const { css } = await api.draft(theme.id);
  expect(css).toContain(".eerst { color: #111111; }");
  expect(css).toContain(".daarna { color: #222222; }");
});
