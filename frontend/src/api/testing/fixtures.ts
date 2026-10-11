import type {
  Dashboard,
  Draft,
  HostBinding,
  HostOptions,
  LintResult,
  LocalCssFile,
  Palette,
  ScriptFile,
  Theme,
  UserRef,
  Version,
  VersionSummary,
} from "../types";

/**
 * Testdata in de vorm van de API (alleen voor tests). Elke `make…` geeft geldige standaard-
 * waarden; overschrijf wat de test nodig heeft.
 */

let counter = 0;

/** Deterministische UUID: `testId(7)` → `00000000-0000-4000-8000-000000000007`. */
export function testId(n: number = ++counter): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export const DEV_USER: UserRef = {
  id: "00000000-0000-7000-8000-000000000001",
  display_name: "Beheerder",
};

const NOW = "2026-10-05T12:00:00Z";

export function makeVersionSummary(overrides: Partial<VersionSummary> = {}): VersionSummary {
  const versionNumber = overrides.version_number ?? 1;
  return {
    id: testId(),
    version_number: versionNumber,
    source: "manual",
    message: null,
    sha256: "ab".repeat(32),
    size_bytes: 120,
    created_by: DEV_USER,
    created_at: NOW,
    is_live: true,
    source_version_number: null,
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<Version> = {}): Version {
  return {
    ...makeVersionSummary(overrides),
    css_source: "body { color: var(--ct-fg); }\n",
    css_compiled: "/*! cssthema */\nbody{color:var(--ct-fg)}",
    lint_warnings: [],
    ...overrides,
  };
}

export function makeTheme(overrides: Partial<Theme> = {}): Theme {
  const slug = overrides.slug ?? "proxmox";
  return {
    id: testId(),
    slug,
    name: "Proxmox",
    description: null,
    service_id: null,
    palette_id: null,
    status: "draft",
    tags: [],
    published_version: null,
    latest_version_number: 0,
    lock_version: 1,
    draft_dirty: false,
    draft_size_bytes: 0,
    draft_updated_at: null,
    draft_updated_by: null,
    public_url: `http://localhost/${slug}.css`,
    shadowed_by_file: false,
    deleted_at: null,
    created_by: DEV_USER,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<Draft> = {}): Draft {
  const css = overrides.css ?? "body { color: red; }\n";
  return {
    css,
    lock_version: 1,
    size_bytes: new TextEncoder().encode(css).length,
    updated_at: NOW,
    updated_by: DEV_USER,
    ...overrides,
  };
}

export function makeLintResult(overrides: Partial<LintResult> = {}): LintResult {
  const errors = overrides.errors ?? [];
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    size_bytes: 0,
    unmatched_selectors: [],
    ...overrides,
  };
}

export function makePalette(overrides: Partial<Palette> = {}): Palette {
  return {
    id: testId(),
    slug: "terminal",
    name: "Terminal",
    tokens: {
      bg: "#141414",
      surface: "#1e1e1e",
      fg: "#dddddd",
      muted: "#999999",
      accent: "#aaaaaa",
      "accent-fg": "#000000",
      success: "#8fd6a4",
      warning: "#e6b56b",
      danger: "#e58b8b",
      border: "#333333",
      radius: "10px",
    },
    is_builtin: true,
    theme_count: 0,
    created_at: NOW,
    ...overrides,
  };
}

export function makeLocalFile(overrides: Partial<LocalCssFile> = {}): LocalCssFile {
  const name = overrides.name ?? "proxmox.css";
  return {
    name,
    slug: name.replace(/\.css$/, ""),
    size_bytes: 512,
    modified_at: NOW,
    importable: true,
    reason: null,
    theme_id: null,
    ...overrides,
  };
}

export function makeScript(overrides: Partial<ScriptFile> = {}): ScriptFile {
  const name = overrides.name ?? "algemeen";
  return {
    name,
    filename: `${name}.js`,
    size_bytes: 1561,
    modified_at: NOW,
    url: `https://css.example/${name}.js`,
    sha256: "a5e330f6b1a4".padEnd(64, "0"),
    world_readable: true,
    ...overrides,
  };
}

export function makeHost(overrides: Partial<HostBinding> = {}): HostBinding {
  const hostname = overrides.hostname ?? "proxmox.example";
  return {
    id: testId(),
    hostname,
    styles: ["algemeen"],
    scripts: ["algemeen"],
    enabled: true,
    note: null,
    css_url: `https://css.example/host/${hostname}.css`,
    js_url: `https://css.example/host/${hostname}.js`,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function makeHostOptions(overrides: Partial<HostOptions> = {}): HostOptions {
  return {
    styles: ["algemeen", "alg-proxmox", "nord"],
    scripts: ["algemeen", "extra"],
    snippet:
      "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"https://css.example/host/$host.css\"></head>';\n",
    snippet_own_domain:
      "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"/alg-thema/host/$host.css\"></head>';\n",
    ...overrides,
  };
}

export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    themes_total: 0,
    themes_published: 0,
    themes_draft_dirty: 0,
    themes_deleted: 0,
    palettes_total: 7,
    recent: [],
    local_files: { dir: "/var/lib/cssthema/css-files", total: 0, importable: 0 },
    ...overrides,
  };
}
