import { mkdirSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/support/env";

/**
 * End-to-end-tests (`pnpm e2e`, docs/07 § 4) tegen de productiebuild:
 * - de api op poort 8020 (uvicorn, met `alembic upgrade head` vooraf);
 * - `vite build` + `vite preview` op 4173, met een proxy naar de api voor `/api`, `/healthz`,
 *   `/readyz` en de publieke CSS-paden (zie `vite.config.ts`).
 * Draait er al iets op die poorten, dan wordt dat hergebruikt (behalve in CI).
 *
 * Met `E2E_BASE_URL` (bv. `http://localhost:8080` voor docker compose, of de nginx van een
 * installatie zonder Docker) start de config niets en test hij die stack. Nooit tegen
 * productie: de tests maken en verwijderen thema's.
 */

const external = Boolean(process.env.E2E_BASE_URL);
mkdirSync(E2E.cssFilesDir, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  // Elke test maakt zijn eigen thema's (unieke slugs); één worker houdt Monaco en de api rustig.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: E2E.baseURL,
    locale: "nl-BE",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          // Lokaal (sandbox zonder downloads) de meegeleverde Chromium; in CI die van
          // `playwright install chromium`.
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
        },
      },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          name: "api",
          cwd: "../backend",
          command: `uv run alembic upgrade head && uv run uvicorn cssthema.main:app --host 127.0.0.1 --port ${E2E.apiPort}`,
          url: `${E2E.apiURL}/readyz`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: "pipe",
          env: {
            DATABASE_URL:
              process.env.DATABASE_URL ??
              "postgresql+asyncpg://cssthema:cssthema@localhost:5432/cssthema",
            REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/0",
            PUBLIC_BASE_URL: E2E.baseURL,
            CSS_FILES_DIR: E2E.cssFilesDir,
            // Geen nginx voor de api: niets te verversen.
            CSS_REFRESH_URL: "",
            LOG_JSON: "false",
            LOG_LEVEL: "WARNING",
          },
        },
        {
          name: "web",
          command: `pnpm exec vite build && pnpm exec vite preview --port ${E2E.webPort} --strictPort`,
          url: E2E.baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: { VITE_BACKEND_URL: E2E.apiURL },
        },
      ],
});
