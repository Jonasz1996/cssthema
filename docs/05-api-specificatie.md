# 05 — API-specificatie

> Status: **goedgekeurd** · Versie 0.2 · 2026-10-05
> REST · JSON · OpenAPI 3.1 (door FastAPI gegenereerd op `/api/v1/openapi.json`, Swagger UI op `/api/docs`, ReDoc op `/api/redoc`)

## 1. Algemene conventies

| Onderwerp | Afspraak |
|---|---|
| Basis-URL | `https://cssthema.domain.be/api/v1` |
| Versiebeheer | Major in pad (`/v1`). Additieve wijzigingen zonder nieuwe versie; breaking → `/v2` met 6 maanden overlap. |
| Authenticatie | Sessiecookie `cssthema_session` (browser) **of** `Authorization: Bearer ct_…` (API-key). |
| CSRF | Bij cookie-auth op `POST/PUT/PATCH/DELETE` header `X-CSRF-Token` verplicht (waarde uit cookie `cssthema_csrf`). |
| Content-Type | `application/json; charset=utf-8`, uploads `multipart/form-data`. |
| Namen | JSON-velden `snake_case`; ID's als UUID-strings; tijden ISO 8601 UTC (`2026-10-05T12:00:00Z`). |
| Paginering | Cursor-gebaseerd: `?limit=50&cursor=<opaque>` → `{ "items": [...], "next_cursor": "…" | null }`. Max. `limit` 200. |
| Sorteren/filteren | `?sort=-updated_at&service_id=…&q=…&status=published`. |
| Concurrency | Muteerbare resources geven `ETag`; wijzigingen vereisen `If-Match` (anders `428`), mismatch → `412`. |
| Idempotentie | `POST` met bijwerkingen accepteert `Idempotency-Key` header (24 u bewaard in Redis). |
| Asynchroon | Lange acties geven `202 Accepted` + `{ "job": Job }` + header `Location: /api/v1/jobs/{id}`. |
| Rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (IETF draft); bij `429` ook `Retry-After`. |
| Request-ID | `X-Request-ID` (meegegeven of gegenereerd), altijd terug in response en in foutbody. |

## 2. Foutmodel (RFC 9457 Problem Details)

`Content-Type: application/problem+json`

```json
{
  "type": "https://cssthema.dev/problems/theme-lint-failed",
  "title": "CSS bevat fouten",
  "status": 422,
  "detail": "Publiceren geweigerd: 1 fout gevonden.",
  "instance": "/api/v1/themes/0192…/publish",
  "code": "theme_lint_failed",
  "request_id": "b1c2…",
  "errors": [
    { "line": 14, "column": 3, "rule": "external-url", "severity": "error",
      "message": "url() naar https://evil.example is niet toegestaan" }
  ]
}
```

| HTTP | `code` | Wanneer |
|---|---|---|
| 400 | `bad_request` | Onleesbare body (geen geldige JSON); zonder `errors[]` |
| 401 | `unauthenticated` | Geen/ongeldige sessie of key |
| 403 | `forbidden` | Rol/scope onvoldoende |
| 403 | `csrf_failed` | CSRF-token ontbreekt/onjuist |
| 404 | `not_found` | Resource bestaat niet (of is soft-deleted voor niet-admins) |
| 409 | `slug_conflict` | Slug al in gebruik |
| 409 | `state_conflict` | Actie niet mogelijk in huidige status (bv. rollback naar live versie) |
| 412 | `precondition_failed` | `If-Match` komt niet overeen (iemand anders heeft gewijzigd) — body bevat huidige `etag` en `updated_by` |
| 413 | `payload_too_large` | CSS > limiet, upload > 25 MB |
| 415 | `unsupported_media_type` | Verkeerd uploadformaat |
| 422 | `validation_error` | Pydantic-validatie (veldfouten in `errors[]` met `loc`) |
| 422 | `theme_lint_failed` | CSS-security-/syntaxfouten bij publiceren |
| 422 | `url_not_allowed` | URL valt buiten SSRF-allowlist |
| 428 | `precondition_required` | `If-Match` ontbreekt |
| 429 | `rate_limited` | Te veel verzoeken |
| 502 | `upstream_error` | Doel-app, NPM of AI-provider gaf fout |
| 503 | `ai_disabled` / `ai_budget_exceeded` | Geen provider of maandbudget op |
| 500 | `internal_error` | Onverwacht; details alleen in logs |

## 3. Kern-schema's

```yaml
User:        { id, email, display_name, role: admin|editor|viewer, is_active, last_login_at, created_at }
Me:          User + { permissions: [string], auth_method: oidc|break_glass|api_key }

ApiKey:      { id, name, prefix, scopes: [Scope], expires_at?, last_used_at?, revoked_at?, created_at }
ApiKeyCreated: ApiKey + { secret: "ct_8f2a91bd_…" }        # alleen in create-response
Scope:       themes:read | themes:write | themes:publish | services:read | services:write |
             discovery:run | ai:generate | audit:read

Service:     { id, slug, name, type: ServiceType, base_url, login_url?, favicon_url?, source,
               tags: [string], last_crawled_at?, theme_count, latest_snapshot?: SnapshotSummary,
               created_at, updated_at }
ServiceCreate: { name, base_url, login_url?, type?: ServiceType (default: auto-detect), tags? }
ServiceUpdate: partial ServiceCreate

SnapshotSummary: { id, service_id, page_kind, url, title, origin, class_count, id_count,
                   variable_count, has_shadow_dom, framework_hints: [string], created_at }
Snapshot:    SnapshotSummary + { final_url, http_status, components: [Component],
                                 css_variables: {name: {value, defined_in, count}},
                                 colors: {hex: {count, properties}}, stylesheets: [{url, size}] }
Component:   { type: header|sidebar|nav|main|table|form|button|dialog|login_form|card|other,
               selector, confidence: 0..1, children: [Component] }
Selector:    { kind: class|id|css_variable, name, occurrences, in_shadow_dom }

Screenshot:  { id, service_id, snapshot_id?, theme_version_id?, viewport: desktop|tablet|mobile,
               page_kind, width, height, image_url, thumb_url, created_at }

Palette:     { id, slug, name, tokens: {string: string}, is_builtin, theme_count, created_at }

Theme:       { id, slug, name, description?, service_id?, palette_id?, status: draft|published|archived,
               tags, published_version?: VersionSummary, latest_version_number,
               draft_dirty: bool,            # draft verschilt van gepubliceerde bron
               draft_updated_at?, draft_updated_by?: UserRef,
               public_url, created_by: UserRef, created_at, updated_at }
ThemeCreate: { name, slug?, description?, service_id?, palette_id?, tags?,
               template?: { kind: empty|theme|generation|version, id? } }
ThemeUpdate: { name?, description?, service_id?, palette_id?, tags?, slug? }   # slug-wijziging: oude slug 301 (90 d)
Draft:       { css: string, updated_at, updated_by: UserRef, lock_version }
LintResult:  { ok: bool, errors: [LintIssue], warnings: [LintIssue], size_bytes, unmatched_selectors: [string] }
LintIssue:   { line, column, rule, severity: error|warning, message }

VersionSummary: { id, version_number, source: manual|rollback|import|duplicate|ai, message?,
                  sha256, size_bytes, created_by: UserRef, created_at, is_live }
Version:     VersionSummary + { css_source, css_compiled, source_version_number?, lint_warnings }
VersionDiff: { from, to, unified: string, stats: { added, removed } }

Generation:  { id, service_id, snapshot_id, preset, palette_id?, instruction?, engine: ai|palette_mapping,
               provider?, model?, status, variables, overrides: [Override], css?,
               validation: { matched, unmatched: [string], lint: [LintIssue] },
               usage?: { input_tokens, output_tokens, cost_usd }, accepted_theme_id?, job_id, created_at }
Override:    { component, selector, declarations: {property: value}, matched: bool }

Job:         { id, type, status: queued|running|succeeded|failed|cancelled, progress: 0..100,
               message?, result?: object, error?: string, created_by?: UserRef,
               created_at, started_at?, finished_at? }

AuditEntry:  { id, at, actor: UserRef|ApiKeyRef, action, entity_type, entity_id?, ip, request_id, changes }
```

## 4. Endpoints

Legenda kolom **Rol**: V = Viewer, E = Editor, A = Admin (en hoger); P = publiek.

### 4.1 Auth & gebruikers

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/auth/login?next=/editor/…` | P | Start OIDC (302 naar Authentik) | 302 |
| GET | `/auth/callback` | P | OIDC callback, zet sessie | 302, 400 (state/nonce fout) |
| POST | `/auth/break-glass` | P | `{ password }` → sessie (alleen als ingeschakeld, streng rate-limited 5/15 min) | 204, 401, 404 (uit) |
| POST | `/auth/logout` | V | Sessie verwijderen (+ RP-initiated logout URL) | 200 `{ logout_url }` |
| GET | `/auth/me` | V | Huidige gebruiker + permissies | 200 `Me`, 401 |
| GET | `/users` | A | Lijst | 200 `Page<User>` |
| PATCH | `/users/{id}` | A | `{ role?, role_override?, is_active? }` | 200, 404, 409 (laatste admin) |

### 4.2 API-keys

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/api-keys?user_id=` | V (eigen) / A (alle) | Lijst | 200 `Page<ApiKey>` |
| POST | `/api-keys` | V | `{ name, scopes, expires_at? }` — scopes ⊆ rol | 201 `ApiKeyCreated`, 422 |
| DELETE | `/api-keys/{id}` | V (eigen) / A | Intrekken | 204, 404 |

### 4.3 Services

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/services?q=&type=&tag=` | V | Lijst | 200 `Page<Service>` |
| POST | `/services` | E | Aanmaken | 201 `Service`, 409, 422 |
| GET | `/services/{id}` | V | Detail | 200, 404 |
| PATCH | `/services/{id}` | E | Wijzigen (`If-Match`) | 200, 412, 422 |
| DELETE | `/services/{id}` | A | Soft delete (thema's blijven, ontkoppeld) | 204 |
| POST | `/services/{id}/crawl` | E | `{ pages: [home,login], screenshots: true }` | 202 `Job` |
| GET | `/services/{id}/snapshots?page_kind=` | V | Snapshots | 200 `Page<SnapshotSummary>` |
| GET | `/services/{id}/screenshots?viewport=&themed=` | V | Screenshots | 200 `Page<Screenshot>` |
| GET | `/services/{id}/selectors?q=&kind=&limit=` | V | Autocomplete uit laatste snapshots | 200 `[Selector]` |
| GET | `/services/{id}/injection?theme_id=&method=` | V | Gegenereerde snippets (`npm_subfilter`, `stylus`, `userscript`, `native`) | 200 `{ method, title, steps: [string], snippet, language }[]` |
| POST | `/services/{id}/injection/test` | E | `{ theme_id }` — controleert live injectie | 202 `Job` |

### 4.4 Import en snapshots

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| POST | `/imports/url` | E | `{ url, service_id? \| new_service?: ServiceCreate, page_kind, download_assets: true, screenshots: true, use_credentials: false }` | 202 `Job`, 422 `url_not_allowed` |
| POST | `/imports/html` | E | multipart: `file`, `service_id`, `page_kind`, `base_url?` | 202 `Job`, 413, 415 |
| GET | `/snapshots/{id}` | V | Analyse-detail | 200 `Snapshot` |
| GET | `/snapshots/{id}/document` | V | Gesaneerde HTML voor preview (`text/html`, strikte CSP-header; de preview zet dezelfde CSP als `<meta>` in de srcdoc, zie docs/02 § 4.2) | 200 |
| GET | `/snapshots/{id}/assets/{sha256}` | V | Asset (cache immutable) | 200, 404 |
| GET | `/snapshots/{id}/selectors?kind=&q=` | V | Alle selectors | 200 `Page<Selector>` |
| DELETE | `/snapshots/{id}` | E | Verwijderen | 204 |
| GET | `/screenshots/{id}/image?size=full\|thumb` | V | WebP | 200 |

### 4.5 Discovery

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| POST | `/discovery/npm` | E | `{ include_disabled: false, screenshots: true }` (NPM-credentials uit instellingen) | 202 `Job`, 503 (NPM niet geconfigureerd) |
| POST | `/discovery/urls` | E | `{ urls: [ {url, name?, type?} ] }` of multipart bestand | 202 `Job` |
| GET | `/discovery/runs` | V | Historie | 200 `Page<Run>` |
| GET | `/discovery/runs/{id}/candidates` | V | Kandidaten | 200 `[Candidate]` |
| POST | `/discovery/runs/{id}/apply` | E | `{ accept: [{candidate_id, name?, type?}], ignore: [id] }` | 200 `{ created: [Service], updated: [Service] }` |

### 4.6 Thema's

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/themes?q=&service_id=&palette_id=&status=&tag=` | V | Lijst | 200 `Page<Theme>` |
| POST | `/themes` | E | Aanmaken | 201 `Theme`, 409 `slug_conflict` |
| GET | `/themes/{id}` | V | Detail (`ETag`) | 200, 404 |
| PATCH | `/themes/{id}` | E | Metadata (`If-Match`) | 200, 409, 412 |
| DELETE | `/themes/{id}` | E (eigen) / A | Soft delete; `?hard=true` alleen A | 204 |
| POST | `/themes/{id}/restore` | A | Herstel soft delete | 200 |
| GET | `/themes/{id}/draft` | V | Draft (`ETag: "lv-12"`) | 200 `Draft` |
| PUT | `/themes/{id}/draft` | E | `{ css }` met `If-Match` — autosave | 200 `Draft`, 412 (body: huidige draft-meta), 413 |
| POST | `/themes/{id}/lint` | V | `{ css? }` (default: draft) → lint + selector-match | 200 `LintResult` |
| POST | `/themes/{id}/publish` | E | `{ message?, expected_lock_version }` | 201 `Version`, 409, 412, 422 `theme_lint_failed` |
| POST | `/themes/{id}/duplicate` | E | `{ name, slug?, service_id? }` | 201 `Theme` |
| GET | `/themes/{id}/versions` | V | Historie | 200 `Page<VersionSummary>` |
| GET | `/themes/{id}/versions/{n}` | V | Eén versie | 200 `Version` |
| GET | `/themes/{id}/diff?from=6&to=draft` | V | Diff (`n` of `draft`) | 200 `VersionDiff` |
| POST | `/themes/{id}/rollback` | E | `{ version_number, message? }` → nieuwe live versie | 201 `Version`, 409 (al live) |
| POST | `/themes/{id}/draft/reset` | E | Draft terugzetten naar versie `{ version_number }` zonder publiceren | 200 `Draft` |
| GET | `/themes/{id}/export?format=css\|bundle&version=` | V | `css` → `text/css` download; `bundle` → `application/zip` | 200 |
| POST | `/themes/import` | E | multipart `file` (`.css` / `.cssthema.zip`), `on_conflict: rename\|new_version\|fail`, `service_id?` | 201 `Theme`, 409, 422 |
| GET | `/themes/local-files` | V | Handgemaakte `*.css` in `CSS_FILES_DIR` (native install: `/var/lib/cssthema/css-files`): `[{name, slug, size_bytes, modified_at, importable, reason?, theme_id?}]` | 200 |
| POST | `/themes/local-files/import` | E | `{ names, publish: true, archive: true }` → per bestand een thema (v1 bron `import`, live bij `publish`); daarna verplaatst naar `.geimporteerd/`, zodat nginx naar de api doorvalt | 200 `{ imported: [Theme + source_file, archive_error?], skipped: [{name, reason}] }`, 422 |

Preciseringen (fase 1, 2026-10-05):
- ETag van thema en draft is `"lv-<lock_version>"`; `Theme` bevat ook `lock_version`, `draft_size_bytes`, `shadowed_by_file` (er staat een handgemaakt bestand met deze naam in `CSS_FILES_DIR`, dat nginx vóór het thema serveert) en `deleted_at`.
- `If-Match` is verplicht (428) bij `PATCH /themes/{id}`, `PUT …/draft`, `POST …/draft/reset` en `POST …/rollback`; bij `DELETE` wordt een meegestuurde `If-Match` gecontroleerd.
- Publiceren zonder wijziging t.o.v. de live versie → 409 `state_conflict`. Rollback lint de doelversie opnieuw.
- `GET …/export?format=css` zonder live versie → 409 (gebruik `version=n`).
- `POST /themes/import`: `publish` weggelaten = `.css` niet publiceren, bundel publiceert zijn `live_version`; `on_conflict=new_version` geeft 200 (bestaand thema).
- `GET /palettes` en `GET /themes/local-files` geven een lijst, geen `Page`.
- `GET /api/v1/dashboard` → `{ themes_total, themes_published, themes_draft_dirty, themes_deleted, palettes_total, recent: [Theme], local_files: {dir, total, importable} }`.
- Fase 1 heeft nog geen login: alle verzoeken gelden als de ingebouwde gebruiker *Beheerder* (admin). Fase 3 vervangt dat door OIDC.

### 4.7 Paletten

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/palettes` | V | Lijst (incl. ingebouwd) | 200 |
| POST | `/palettes` | E | `{ name, slug?, tokens }` | 201, 409, 422 |
| PATCH | `/palettes/{id}` | E | Niet voor ingebouwd (`409`) | 200 |
| DELETE | `/palettes/{id}` | E | Alleen als ongebruikt, anders 409 | 204 |
| POST | `/palettes/{id}/republish` | E | Herpubliceer alle gekoppelde thema's | 202 `Job` |

### 4.8 AI

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/ai/presets` | V | Beschikbare presets + gekoppeld palet | 200 |
| GET | `/ai/status` | V | Provider, model, budget, verbruik deze maand | 200 |
| POST | `/ai/generations` | E | `{ service_id, snapshot_id?, presets: [string], instruction?, engine: ai\|palette_mapping, include_screenshots: true }` → één generatie per preset | 202 `{ generations: [Generation] }`, 503 |
| GET | `/ai/generations?service_id=` | V | Lijst | 200 |
| GET | `/ai/generations/{id}` | V | Detail | 200 |
| POST | `/ai/generations/{id}/accept` | E | `{ target: new_theme, name, slug? }` of `{ target: theme_draft, theme_id }` | 201 `Theme` / 200 `Draft` |
| POST | `/ai/generations/{id}/reject` | E | | 204 |
| POST | `/ai/generations/{id}/refine` | E | `{ instruction }` → nieuwe generatie (later) | 202 |

### 4.9 Jobs

| Methode | Pad | Rol | Beschrijving | Responses |
|---|---|---|---|---|
| GET | `/jobs?status=&type=` | V | Lijst | 200 |
| GET | `/jobs/{id}` | V | Detail | 200 `Job` |
| GET | `/jobs/{id}/events` | V | **SSE**: `event: progress` / `done` / `failed` met `Job` als data | 200 `text/event-stream` |
| POST | `/jobs/{id}/cancel` | E (eigen) / A | | 202, 409 |

### 4.10 Admin

| Methode | Pad | Rol | Beschrijving |
|---|---|---|---|
| GET | `/audit-logs?actor=&action=&entity_type=&entity_id=&from=&to=` | A (E: eigen) | Lijst, `?format=csv` voor export |
| GET | `/settings` | A | Alle instellingen (geheimen gemaskeerd: `"••••1234"`) |
| PUT | `/settings/{key}` | A | Instelling wijzigen (bv. `npm.connection`, `ai.provider`, `fetch.allowlist`) |
| POST | `/settings/npm/test` | A | Test NPM-verbinding → `{ ok, host_count }` |
| POST | `/settings/ai/test` | A | Test AI-provider → `{ ok, model }` |

### 4.11 Publieke endpoints (zonder `/api/v1`)

| Methode | Pad | Beschrijving | Headers |
|---|---|---|---|
| GET/HEAD | `/{slug}.css` | Gepubliceerde versie | `Content-Type: text/css; charset=utf-8`, `ETag`, `Last-Modified`, `Cache-Control: public, max-age=60, stale-while-revalidate=600, stale-if-error=86400`, `Access-Control-Allow-Origin: *`, `X-Cssthema-Version` |
| GET/HEAD | `/themes/{slug}.css` | Idem | idem |
| GET/HEAD | `/themes/{slug}@{n}.css` | Vaste versie | `Cache-Control: public, max-age=31536000, immutable` |
| GET | `/themes/{slug}.user.css` | Stylus UserCSS (met `@updateURL`, `@-moz-document domain(...)` op basis van service-URL) | `text/css` |
| GET | `/themes/{slug}.user.js` | Userscript (`@match` op service-URL, injecteert in document + shadow roots, haalt CSS met `?v=`) | `application/javascript` |
| GET | `/themes/{slug}.ha.yaml` | Home Assistant theme-YAML (variabelen) | `application/yaml` |
| GET | `/api/v1/public/injection-map.json` | `{ "pve.domain.be": "https://…/proxmox.css", … }` voor eigen extensie (later) | `application/json` |
| GET | `/healthz` | Liveness | 200 `ok` |
| GET | `/readyz` | DB + Redis bereikbaar | 200 / 503 |
| GET | `/metrics` | Prometheus (alleen intern netwerk, geblokkeerd in nginx voor extern) | |

Gedrag:
- `If-None-Match` met huidige ETag → `304 Not Modified` (zonder body).
- Onbekende/ongepubliceerde slug → `404`, body `/* cssthema: theme "x" not found */`, `Cache-Control: public, max-age=10`.
- Oude slug na hernoemen → `301` naar nieuwe slug (90 dagen).
- Query `?v=…` wordt genegeerd voor de inhoud maar maakt de URL uniek (cache-busting).

## 5. Voorbeelden

### 5.1 Autosave van de draft

```http
PUT /api/v1/themes/0192f7a8-…/draft HTTP/1.1
Cookie: cssthema_session=…
X-CSRF-Token: 9f1c…
If-Match: "lv-12"
Content-Type: application/json

{ "css": ".x-panel-header { background: var(--ct-surface); }" }
```

```http
HTTP/1.1 200 OK
ETag: "lv-13"
Content-Type: application/json

{ "css": "…", "updated_at": "2026-10-05T12:04:31Z",
  "updated_by": { "id": "…", "display_name": "Jonas" }, "lock_version": 13 }
```

Conflict:

```http
HTTP/1.1 412 Precondition Failed
Content-Type: application/problem+json

{ "type": "https://cssthema.dev/problems/precondition-failed", "status": 412,
  "code": "precondition_failed", "title": "Draft is intussen gewijzigd",
  "current": { "etag": "\"lv-14\"", "updated_by": { "display_name": "Anna" },
               "updated_at": "2026-10-05T12:04:29Z" } }
```

### 5.2 Publiceren

```http
POST /api/v1/themes/0192f7a8-…/publish
{ "message": "Sidebar donkerder", "expected_lock_version": 13 }
```

```http
HTTP/1.1 201 Created
Location: /api/v1/themes/0192f7a8-…/versions/8

{ "id": "…", "version_number": 8, "source": "manual", "message": "Sidebar donkerder",
  "sha256": "ab12…", "size_bytes": 3481, "is_live": true,
  "created_by": { "display_name": "Jonas" }, "created_at": "2026-10-05T12:05:02Z",
  "css_source": "…", "css_compiled": "…", "lint_warnings": [] }
```

### 5.3 Publieke CSS

```http
GET /proxmox-nord.css HTTP/1.1
If-None-Match: "sha256-ab12cd34ef56"
```

```http
HTTP/1.1 304 Not Modified
ETag: "sha256-ab12cd34ef56"
Cache-Control: public, max-age=60, stale-while-revalidate=600, stale-if-error=86400
```

### 5.4 Job volgen via SSE

```
GET /api/v1/jobs/0192…/events
Accept: text/event-stream

event: progress
data: {"id":"0192…","status":"running","progress":40,"message":"Assets downloaden (86/214)"}

event: done
data: {"id":"0192…","status":"succeeded","progress":100,"result":{"snapshot_id":"0192…"}}
```

## 6. OpenAPI-aanpak

- Bron van waarheid is de code: FastAPI-routers met Pydantic-modellen, `response_model`, expliciete `responses={412: {"model": Problem}, …}` per route en `tags` per module.
- `operation_id` = `<tag>_<actie>` (bv. `themes_publish`) → leesbare namen in de gegenereerde TypeScript-client.
- CI exporteert `openapi.json` naar `backend/openapi.json` en faalt als het bestand niet up-to-date is; de frontend genereert er `src/api/schema.d.ts` uit.
- Schemathesis draait in CI tegen alle endpoints (property-based contract tests).
- Breaking-change-detectie met `oasdiff` op PR's.
