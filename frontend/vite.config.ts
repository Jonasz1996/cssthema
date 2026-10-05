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

export default defineConfig({
  plugins: [react(), tailwindcss(), checkBuiltCss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/healthz": { target: backend, changeOrigin: true },
      "/readyz": { target: backend, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
