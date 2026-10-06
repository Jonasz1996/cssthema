import { test as base, expect, type APIRequestContext, type APIResponse } from "@playwright/test";

/** Het deel van `Theme` (backend `schemas/themes.py`) dat de tests gebruiken. */
export interface ThemeJson {
  id: string;
  slug: string;
  name: string;
  lock_version: number;
  latest_version_number: number;
  published_version: { version_number: number; source: string } | null;
  deleted_at: string | null;
  draft_dirty: boolean;
  public_url: string;
}

/** Unieke, geldige slug (max. 64 tekens) zodat tests elkaar en bestaande thema's niet raken. */
export function uniqueSlug(prefix: string): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `e2e-${prefix}-${stamp}`;
}

async function expectStatus(response: APIResponse, status: number): Promise<void> {
  if (response.status() !== status) {
    throw new Error(
      `${response.url()}: verwacht ${status}, kreeg ${response.status()}\n${await response.text()}`,
    );
  }
}

/**
 * Kleine client voor de api (via dezelfde baseURL als de browser, dus ook via de proxy).
 * Alles wat hij aanmaakt of wat een test met `track()` aanmeldt, wordt na de test hard
 * verwijderd.
 */
export class Api {
  readonly created = new Set<string>();

  constructor(private readonly request: APIRequestContext) {}

  track(id: string): void {
    this.created.add(id);
  }

  async createTheme(body: { name: string; slug: string; css?: string }): Promise<ThemeJson> {
    const response = await this.request.post("/api/v1/themes", { data: body });
    await expectStatus(response, 201);
    const theme = (await response.json()) as ThemeJson;
    this.track(theme.id);
    return theme;
  }

  async theme(id: string): Promise<ThemeJson> {
    const response = await this.request.get(`/api/v1/themes/${id}`);
    await expectStatus(response, 200);
    return (await response.json()) as ThemeJson;
  }

  async draft(id: string): Promise<{ css: string; etag: string }> {
    const response = await this.request.get(`/api/v1/themes/${id}/draft`);
    await expectStatus(response, 200);
    const body = (await response.json()) as { css: string };
    return { css: body.css, etag: response.headers()["etag"] ?? "" };
  }

  /** Draft overschrijven zoals een tweede editor zou doen (met de juiste `If-Match`). */
  async putDraft(id: string, css: string): Promise<void> {
    const { etag } = await this.draft(id);
    const response = await this.request.put(`/api/v1/themes/${id}/draft`, {
      data: { css },
      headers: { "If-Match": etag },
    });
    await expectStatus(response, 200);
  }

  async publish(id: string, message = "e2e"): Promise<number> {
    const theme = await this.theme(id);
    const response = await this.request.post(`/api/v1/themes/${id}/publish`, {
      data: { message, expected_lock_version: theme.lock_version },
    });
    await expectStatus(response, 201);
    return ((await response.json()) as { version_number: number }).version_number;
  }

  async localFilesDir(): Promise<string> {
    const response = await this.request.get("/api/v1/dashboard");
    await expectStatus(response, 200);
    return ((await response.json()) as { local_files: { dir: string } }).local_files.dir;
  }

  async findBySlug(slug: string): Promise<ThemeJson | undefined> {
    const response = await this.request.get("/api/v1/themes", {
      params: { q: slug, include_deleted: true, limit: 50 },
    });
    await expectStatus(response, 200);
    const page = (await response.json()) as { items: ThemeJson[] };
    return page.items.find((theme) => theme.slug === slug);
  }

  /** Verwijderen naar de prullenbak (soft delete), zoals vanuit een ander tabblad. */
  async softDelete(id: string): Promise<void> {
    await expectStatus(await this.request.delete(`/api/v1/themes/${id}`), 204);
  }

  async restore(id: string): Promise<ThemeJson> {
    const response = await this.request.post(`/api/v1/themes/${id}/restore`);
    await expectStatus(response, 200);
    return (await response.json()) as ThemeJson;
  }

  async hardDelete(id: string): Promise<void> {
    const response = await this.request.delete(`/api/v1/themes/${id}`, {
      params: { hard: true },
    });
    if (![204, 404].includes(response.status())) {
      throw new Error(`opruimen van ${id} mislukt: ${response.status()} ${await response.text()}`);
    }
  }
}

/** Meldingen in de console die bij een test horen (bv. de 412 bij een conflict). */
const EXPECTED_CONSOLE = [
  /^Failed to load resource: the server responded with a status of (4\d\d)/,
];

export const test = base.extend<{ api: Api; consoleGuard: void }>({
  api: async ({ request }, use) => {
    const api = new Api(request);
    await use(api);
    for (const id of api.created) await api.hardDelete(id);
  },
  // Elke test faalt op een JavaScript-fout of console.error in de pagina.
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (EXPECTED_CONSOLE.some((pattern) => pattern.test(text))) return;
        problems.push(`console.error: ${text}`);
      });
      await use();
      expect(problems, "fouten in de browserconsole").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
