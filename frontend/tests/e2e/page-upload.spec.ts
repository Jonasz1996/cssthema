import { makeZip } from "../../src/features/import/testing";
import { waitForEditor } from "./support/editor";
import { expect, test, uniqueSlug } from "./support/fixtures";

/** 1×1 rode PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Een opgeslagen webpagina ("Webpagina, volledig" + zip) uploaden vanuit de editor: de preview
 * kiest meteen die pagina en toont het thema op haar eigen layout, CSS en afbeeldingen.
 */
test("webpagina uploaden en het thema daarop previewen", async ({ page, api }) => {
  const slug = uniqueSlug("pagina");
  const host = `${slug}.example.be`;
  const theme = await api.createTheme({
    name: `E2E pagina ${slug.slice(-8)}`,
    slug,
    css: ".kaart { border: 3px solid rgb(0, 128, 0); }\n",
  });
  const html =
    `<!DOCTYPE html>\n<!-- saved from url=(0030)https://${host}/#!/home -->\n` +
    '<html><head><meta charset="utf-8"><title>Mijn app</title>' +
    '<link rel="stylesheet" href="./Mijn app_files/app.css">' +
    "<script>document.body.remove()</script></head>" +
    '<body><nav class="zijbalk">Menu</nav><div class="kaart">' +
    '<img class="logo" src="Mijn%20app_files/logo.png" width="20" height="20">Inhoud</div>' +
    "</body></html>";
  const zip = await makeZip([
    { name: "Mijn app.html", data: html },
    {
      name: "Mijn app_files/app.css",
      data: ".zijbalk { width: 180px; background: rgb(10, 20, 30); color: #fff; }",
    },
    { name: "Mijn app_files/logo.png", data: new Uint8Array(PNG) },
  ]);

  await page.goto(`/editor/${theme.id}`);
  await waitForEditor(page);
  await page.getByTestId("preview-upload").click();
  const dialog = page.getByRole("dialog", { name: "Eigen pagina als preview" });
  await dialog.getByTestId("page-input").setInputFiles({
    name: "Mijn app.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await dialog.getByRole("button", { name: "Pagina uploaden" }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByLabel("Bron van de preview")).toContainText("mijn-app");
  const frame = page.frameLocator("iframe[title]");
  const card = frame.locator(".kaart");
  await expect(card).toHaveCSS("border-top-color", "rgb(0, 128, 0)");
  await expect(frame.locator(".zijbalk")).toHaveCSS("background-color", "rgb(10, 20, 30)");
  await expect(frame.locator("img.logo")).toHaveJSProperty("naturalWidth", 1);

  const services = (await (await page.request.get("/api/v1/services")).json()) as {
    id: string;
    hostname: string;
  }[];
  const service = services.find((item) => item.hostname === host);
  expect(service).toBeDefined();
  await page.screenshot({ path: "test-results/e2e/page-upload.png" });
  expect((await page.request.delete(`/api/v1/services/${service!.id}`)).status()).toBe(204);
});
