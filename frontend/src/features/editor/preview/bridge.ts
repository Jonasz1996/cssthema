import { PreviewError } from "./errors";
import { sha256Base64 } from "./sha256";

/**
 * `/preview-bridge.js` één keer ophalen (absolute URL) en de hash berekenen voor de CSP van
 * de preview (docs/02 § 4.2). De tekst gaat inline in de srcdoc; zo klopt de hash altijd met
 * wat er werkelijk draait.
 */

export const BRIDGE_PATH = "/preview-bridge.js";

export interface PreviewBridge {
  source: string;
  /** Base64 SHA-256 van `source`, voor `script-src 'sha256-…'`. */
  hash: string;
}

let pending: Promise<PreviewBridge> | null = null;

export async function fetchBridge(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PreviewBridge> {
  const url = new URL(BRIDGE_PATH, globalThis.location?.origin ?? "http://localhost").href;
  const response = await fetchImpl(url, { credentials: "same-origin", cache: "no-cache" });
  if (!response.ok) {
    throw new PreviewError("http", `${BRIDGE_PATH}: HTTP ${response.status}`, {
      path: BRIDGE_PATH,
      status: response.status,
    });
  }
  const source = await response.text();
  if (!source.includes("cssthema preview bridge")) {
    // Bv. de SPA-fallback (index.html) in plaats van het script.
    throw new PreviewError("unexpected", `${BRIDGE_PATH}: onverwachte inhoud`, {
      path: BRIDGE_PATH,
    });
  }
  return { source, hash: await sha256Base64(source) };
}

/** Gedeelde, gecachete bridge; een mislukte poging wordt bij de volgende aanroep herhaald. */
export function loadBridge(): Promise<PreviewBridge> {
  pending ??= fetchBridge().catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Alleen voor tests. */
export function resetBridgeCache(): void {
  pending = null;
}
