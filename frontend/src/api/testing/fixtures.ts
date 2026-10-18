import type {
  CaptureImportResult,
  Dashboard,
  Draft,
  HostBinding,
  HostCheck,
  HostHealth,
  HostHealthOverview,
  HostOptions,
  LintResult,
  LocalCssFile,
  Palette,
  ScriptFile,
  ServiceSummary,
  SnapshotDocument,
  SnapshotSummary,
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

export function makeHostCheck(overrides: Partial<HostCheck> = {}): HostCheck {
  return {
    level: "ok",
    code: "rule_active",
    detail: "De regel staat in de pagina en de CSP laat het CSS-domein toe.",
    http_status: 200,
    checked_at: NOW,
    ...overrides,
  };
}

export function makeHostHealth(overrides: Partial<HostHealth> = {}): HostHealth {
  return {
    hostname: "proxmox.example",
    bound: true,
    enabled: true,
    level: "unknown",
    last_seen: null,
    missing_styles: [],
    missing_scripts: [],
    check: null,
    ...overrides,
  };
}

export function makeHostHealthOverview(
  overrides: Partial<HostHealthOverview> = {},
): HostHealthOverview {
  return {
    hosts: [],
    check_running: false,
    check_started_at: null,
    check_finished_at: null,
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

/** Snapshot van de startpagina met de drie screenshots (`/api/v1/assets/<id>`). */
export function makeSnapshotSummary(overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  const n = ++counter;
  return {
    id: testId(n),
    page: "start",
    page_kind: "home",
    title: "Proxmox Virtual Environment",
    url: "https://proxmox.example/",
    status: "ok",
    has_document: true,
    frameworks: [],
    class_count: 120,
    has_shadow_dom: false,
    theme_links: [],
    csp_errors: 0,
    screenshots: {
      origineel: `/api/v1/assets/${testId(n + 1000)}`,
      met_thema: `/api/v1/assets/${testId(n + 2000)}`,
      mobiel: `/api/v1/assets/${testId(n + 3000)}`,
    },
    captured_at: NOW,
    imported_at: NOW,
    ...overrides,
  };
}

export function makeServiceSummary(overrides: Partial<ServiceSummary> = {}): ServiceSummary {
  const hostname = overrides.hostname ?? "proxmox.example";
  const name = overrides.name ?? hostname.split(".")[0]!;
  return {
    id: testId(),
    slug: name.toLowerCase(),
    name,
    hostname,
    base_url: `https://${hostname}/`,
    snapshots: [makeSnapshotSummary({ url: `https://${hostname}/` })],
    ...overrides,
  };
}

export function makeCaptureImportResult(
  overrides: Partial<CaptureImportResult> = {},
): CaptureImportResult {
  return {
    services_created: [],
    services_updated: [],
    snapshots: 0,
    without_snapshot: [],
    skipped: [],
    ...overrides,
  };
}

/** HTML + CSS van een snapshot (`GET /api/v1/snapshots/{id}/document`), voor de preview. */
export function makeSnapshotDocument(overrides: Partial<SnapshotDocument> = {}): SnapshotDocument {
  return {
    id: testId(),
    service_id: testId(),
    hostname: "proxmox.example",
    title: "Proxmox Virtual Environment",
    url: "https://proxmox.example/",
    html:
      '<!doctype html><html lang="en" class="x-viewport"><head>' +
      '<link rel="stylesheet" href="../../_css/0123456789abcdef.css"></head>' +
      '<body class="x-body"><div id="app" class="x-panel" style="--pve-accent: #e57000">' +
      '<button class="x-btn x-btn-primary">Create VM</button></div></body></html>',
    stylesheets: [".x-panel{background:#fff;--pve-bg:#f5f5f5}.x-btn{color:var(--pve-accent)}"],
    ...overrides,
  };
}
