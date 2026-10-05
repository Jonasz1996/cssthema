import { typeAtEnd, waitForEditor } from "./support/editor";
import { expect, test, uniqueSlug } from "./support/fixtures";

const PAGES = [
  ["/", "Dashboard"],
  ["/themes", "Thema's"],
  ["/palettes", "Paletten"],
  ["/import", "Import"],
] as const;

/**
 * De productiebuild zelf: elke pagina laadt zonder consolefouten (zie `consoleGuard`), Monaco
 * en zijn workers komen van de eigen origin (`/assets/`, geen CDN) en de preview-iframe
 * (srcdoc + CSP-hash + bridge) toont de CSS uit de editor.
 */
test("productiebuild: pagina's, Monaco-workers en preview", async ({ page, api, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const external: string[] = [];
  const workers: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) external.push(request.url());
  });
  page.on("worker", (worker) => workers.push(worker.url()));

  for (const [path, title] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }

  const slug = uniqueSlug("smoke");
  const theme = await api.createTheme({ name: `E2E smoke ${slug.slice(-8)}`, slug });
  await page.goto(`/editor/${theme.id}`);
  await waitForEditor(page);
  await expect
    .poll(() => workers.map((url) => new URL(url).pathname))
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/assets\/editor\.worker-[\w-]+\.js$/),
        expect.stringMatching(/^\/assets\/css\.worker-[\w-]+\.js$/),
      ]),
    );

  // De preview volgt de editor (postMessage naar de sandboxed iframe).
  await typeAtEnd(page, "body { color: #123456; }");
  const preview = page.frameLocator("iframe[data-ready=true]");
  await expect(preview.locator("body")).toHaveCSS("color", "rgb(18, 52, 86)");

  await page.goto(`/editor/${theme.id}/versions`);
  await expect(page.getByRole("heading", { level: 1, name: "Versies" })).toBeVisible();

  expect(external, "requests naar andere hosts").toEqual([]);
});

test.describe("mobiel (390 × 844)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("geen horizontale scroll", async ({ page }) => {
    for (const [path, title] of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect.soft(overflow, `${path} scrolt horizontaal`).toBeLessThanOrEqual(0);
    }
  });
});
