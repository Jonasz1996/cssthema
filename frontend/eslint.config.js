import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "src/api/schema.d.ts",
      "test-results",
      "playwright-report",
      "blob-report",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    // UI-componenten exporteren ook hun cva-varianten en helpers (toast, tabIds, useRipple).
    files: ["src/components/ui/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["public/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright: Node-tests (geen React; `use` van de fixtures is geen React-hook).
    files: ["tests/e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
);
