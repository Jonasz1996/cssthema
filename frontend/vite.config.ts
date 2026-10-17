/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const backend = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

/**
 * Eigenschappen die Chrome en Firefox alleen zonder voorvoegsel kennen. Lightning CSS (de
 * minifier van Tailwind/Vite) gooit de gewone eigenschap weg als er in dezelfde regel later nog
 * een `-webkit-`-variant staat; dan werkt het effect alleen nog in Safari.
 */
const UNPREFIXED_REQUIRED = ["backdrop-filter"];

/** Laat `vite build` falen als de gebouwde CSS zo'n eigenschap alleen met voorvoegsel bevat. */
function checkBuiltCss(): Plugin {
  return {
    name: "cssthema:check-built-css",
    apply: "build",
    writeBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        const css =
          typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
        for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
          const properties = new Set(
            body.split(";").map((declaration) => declaration.split(":", 1)[0]!.trim()),
          );
          for (const property of UNPREFIXED_REQUIRED) {
            if (properties.has(`-webkit-${property}`) && !properties.has(property)) {
              this.error(
                `${file.fileName}: "${selector.trim()}" heeft -webkit-${property} maar geen ` +
                  `${property}; schrijf alleen de eigenschap zonder voorvoegsel in de bron.`,
              );
            }
          }
        }
      }
    },
  };
}

/** Hosts waar Monaco (via `@monaco-editor/loader`) standaard vandaan zou komen. */
const MONACO_CDN_HOSTS = ["cdn.jsdelivr.net", "unpkg.com"];

/**
 * Monaco is lokaal gebundeld (`src/features/editor/monaco/setup.ts` zet `loader.config({ monaco })`).
 * `@monaco-editor/loader` heeft toch een jsDelivr-URL als standaard; die wordt hier uit de build
 * gehaald, en de build faalt als er nog ergens een CDN-URL in de uitvoer staat (zelfhosting,
 * geen verkeer naar derden; Jonas' LXC heeft misschien niet eens internet).
 */
function monacoLocalOnly(): Plugin {
  return {
    name: "cssthema:monaco-local-only",
    apply: "build",
    transform(code, id) {
      if (!id.includes("@monaco-editor/loader") || !code.includes("cdn.jsdelivr.net")) return null;
      return {
        code: code.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[^'"]*/g,
          "/monaco-cdn-disabled",
        ),
        map: null,
      };
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        // Sourcemaps (`--sourcemap`) bevatten de oorspronkelijke bron van Monaco, mét de
        // CDN-URL in commentaar/strings; ze laden niets, dus niet meetellen.
        if (file.fileName.endsWith(".map")) continue;
        const text =
          file.type === "chunk"
            ? file.code
            : typeof file.source === "string"
              ? file.source
              : new TextDecoder().decode(file.source);
        const host = MONACO_CDN_HOSTS.find((candidate) => text.includes(candidate));
        if (host) this.error(`${file.fileName} verwijst naar ${host}; Monaco moet lokaal blijven.`);
      }
    },
  };
}

/**
 * Publieke thema-CSS (`/<slug>.css`, `/themes/<slug>.css`, `/themes/<slug>@<n>.css`): dezelfde
 * regex als de nginx-location in `docker/nginx/conf.d/cssthema.conf`, plus een eventuele
 * query (`?v=`). Een sleutel die met `^` begint, is voor Vite een RegExp op de request-URL.
 * `/themes` zelf (de SPA-pagina) en `/assets/*.css` vallen er niet onder.
 */
const PUBLIC_CSS_PATH =
  "^/(?:themes/)?[a-z0-9][a-z0-9-]{0,62}[a-z0-9](?:@[0-9]+)?\\.css(?:\\?.*)?$";

/**
 * Wat naar de api gaat, in `pnpm dev` én `pnpm preview` (de e2e-tests draaien tegen de
 * productiebuild via `vite preview`, zie `playwright.config.ts`).
 */
const backendProxy = Object.fromEntries(
  ["/api", "/healthz", "/readyz", PUBLIC_CSS_PATH].map((path) => [
    path,
    { target: backend, changeOrigin: true },
  ]),
);

export default defineConfig({
  plugins: [react(), tailwindcss(), checkBuiltCss(), monacoLocalOnly()],
  worker: {
    // Monaco's workers (editor + CSS) als ES-modules; Vite bundelt ze apart (`?worker`).
    format: "es",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: backendProxy,
  },
  preview: {
    proxy: backendProxy,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
