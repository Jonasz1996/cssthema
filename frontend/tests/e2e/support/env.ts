import { fileURLToPath } from "node:url";

const apiPort = Number(process.env.E2E_API_PORT ?? 8020);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4173);

/** Instellingen van de e2e-run; gedeeld door `playwright.config.ts` en de tests. */
export const E2E = {
  apiPort,
  webPort,
  /** Waar de browser en `request` naartoe gaan (SPA + proxy naar de api). */
  baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${webPort}`,
  /** De api rechtstreeks (alleen gebruikt om te starten en te wachten). */
  apiURL: `http://127.0.0.1:${apiPort}`,
  /**
   * `CSS_FILES_DIR` van de api die de config zelf start. De import-test vraagt de map aan de
   * api (`GET /api/v1/dashboard`), zodat hij ook werkt met een api die al draaide.
   */
  cssFilesDir:
    process.env.E2E_CSS_FILES_DIR ??
    fileURLToPath(new URL("../../../test-results/css-files", import.meta.url)),
} as const;
