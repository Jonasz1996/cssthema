# 06 — Repository-structuur

> Status: **ontwerp, ter goedkeuring** · Versie 0.1 · 2026-10-05

## 1. Monorepo-indeling

```
cssthema/
├── README.md                         # Wat, quickstart (docker compose up), links naar docs
├── LICENSE
├── .env.example                      # Alle variabelen met uitleg (zie 02 § 6)
├── Makefile                          # make dev | test | lint | fmt | migrate | openapi | build
├── .editorconfig
├── .pre-commit-config.yaml           # ruff, mypy, prettier, eslint, gitleaks
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # lint + typecheck + test backend & frontend, migratiecheck, openapi-diff
│   │   ├── e2e.yml                   # compose-stack + Playwright e2e
│   │   ├── release.yml               # multi-arch images → ghcr.io, changelog, tag
│   │   └── security.yml              # Trivy, pip-audit, npm audit, CodeQL (wekelijks + PR)
│   ├── pull_request_template.md
│   └── dependabot.yml
│
├── backend/
│   ├── pyproject.toml                # uv-beheerd; deps: fastapi, sqlalchemy[asyncio], asyncpg, alembic,
│   │                                 # pydantic-settings, arq, redis, authlib, tinycss2, selectolax,
│   │                                 # structlog, cryptography, httpx; extra "worker": playwright, pillow
│   ├── uv.lock
│   ├── alembic.ini
│   ├── openapi.json                  # gegenereerd, gecontroleerd in CI
│   ├── src/cssthema/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app factory, middleware, routers
│   │   ├── worker.py                 # arq WorkerSettings (functies + cron)
│   │   ├── config.py                 # pydantic-settings
│   │   ├── logging.py
│   │   ├── api/
│   │   │   ├── deps.py               # db-sessie, current principal, require(permission)
│   │   │   ├── errors.py             # Problem Details + exception handlers
│   │   │   ├── pagination.py
│   │   │   ├── public.py             # /{slug}.css, /themes/…, user.css/js, ha.yaml, healthz
│   │   │   └── v1/
│   │   │       ├── auth.py
│   │   │       ├── users.py
│   │   │       ├── api_keys.py
│   │   │       ├── services.py
│   │   │       ├── imports.py
│   │   │       ├── snapshots.py
│   │   │       ├── discovery.py
│   │   │       ├── themes.py
│   │   │       ├── palettes.py
│   │   │       ├── ai.py
│   │   │       ├── jobs.py           # incl. SSE
│   │   │       ├── audit.py
│   │   │       └── settings.py
│   │   ├── schemas/                  # Pydantic request/response-modellen per module
│   │   ├── db/
│   │   │   ├── base.py               # DeclarativeBase, naming convention, mixins
│   │   │   ├── session.py
│   │   │   └── models/               # user.py, api_key.py, service.py, snapshot.py, screenshot.py,
│   │   │                             # asset.py, palette.py, theme.py, generation.py, job.py,
│   │   │                             # discovery.py, audit.py, setting.py
│   │   ├── repositories/             # query-logica per aggregate
│   │   ├── services/                 # business logica: theme_service, publish_service, import_service, …
│   │   ├── domain/                   # puur, zonder I/O
│   │   │   ├── css/
│   │   │   │   ├── compiler.py
│   │   │   │   ├── linter.py
│   │   │   │   ├── security_rules.py
│   │   │   │   └── minify.py
│   │   │   ├── dom/
│   │   │   │   ├── analyzer.py       # classes, ids, vars, kleuren
│   │   │   │   ├── components.py     # componentdetectie
│   │   │   │   └── sanitizer.py      # scripts/on*-attributen strippen
│   │   │   ├── fingerprints/         # per app: proxmox.py, nextcloud.py, home_assistant.py, …
│   │   │   ├── palettes/builtin.py   # Nord, Dracula, Catppuccin, …
│   │   │   ├── injection/            # snippet-templates per methode/app (Jinja2)
│   │   │   └── export/               # bundle-formaat, userstyle, userscript, HA yaml
│   │   ├── integrations/
│   │   │   ├── storage/              # base.py, filesystem.py, s3.py
│   │   │   ├── browser/              # Playwright pool, capture.py, screenshot.py, ssrf_guard.py
│   │   │   ├── npm_client.py
│   │   │   ├── oidc.py
│   │   │   └── ai/                   # base.py, anthropic.py, openai_compat.py, ollama.py, prompts/
│   │   ├── jobs/                     # arq-taken: snapshot.py, screenshot.py, discovery.py, ai.py, maintenance.py
│   │   ├── security/                 # sessions.py, csrf.py, api_keys.py, rbac.py, rate_limit.py, crypto.py
│   │   └── audit.py
│   ├── migrations/
│   │   ├── env.py
│   │   └── versions/
│   └── tests/
│       ├── conftest.py               # testcontainers, factories
│       ├── fixtures/html/            # echte (geanonimiseerde) pagina's per app voor analyzer-tests
│       ├── unit/
│       ├── integration/
│       └── contract/                 # schemathesis
│
├── frontend/
│   ├── package.json                  # pnpm
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   └── preview-bridge.js         # enige script in de preview-iframe
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app/                      # router, providers, layout (shell, sidebar, command palette)
│   │   ├── api/
│   │   │   ├── schema.d.ts           # gegenereerd uit openapi.json
│   │   │   ├── client.ts             # openapi-fetch + CSRF + foutafhandeling
│   │   │   └── queries/              # TanStack Query hooks per module
│   │   ├── features/
│   │   │   ├── dashboard/
│   │   │   ├── services/
│   │   │   ├── themes/               # browser, detail, versies, diff
│   │   │   ├── editor/
│   │   │   │   ├── EditorWorkspace.tsx
│   │   │   │   ├── Explorer.tsx
│   │   │   │   ├── MonacoPane.tsx
│   │   │   │   ├── PreviewPane.tsx
│   │   │   │   ├── monaco/           # completion provider, lint markers, thema voor Monaco zelf
│   │   │   │   ├── autosave.ts       # debounce, If-Match, offline buffer (IndexedDB)
│   │   │   │   └── store.ts          # Zustand: tabs, layout
│   │   │   ├── import/
│   │   │   ├── discovery/
│   │   │   ├── ai-studio/
│   │   │   ├── palettes/
│   │   │   ├── jobs/                 # SSE-hook useJobEvents
│   │   │   └── settings/             # users, api-keys, audit, integraties
│   │   ├── components/ui/            # shadcn/ui-componenten
│   │   ├── lib/                      # utils, format, i18n
│   │   ├── locales/                  # en.json, nl.json
│   │   └── styles/
│   └── tests/
│       ├── unit/
│       └── e2e/                      # Playwright
│
├── scripts/
│   ├── discover.py                   # CLI: NPM of URL-lijst → API (met API-key), voor cron
│   ├── export_all.py                 # alle thema's exporteren als bundels
│   ├── seed_dev.py                   # demo-data voor lokale ontwikkeling
│   ├── backup.sh                     # pg_dump + restic (gebruikt door backup-container)
│   ├── restore.sh
│   ├── restore-test.sh
│   └── capture_fixture.py            # nieuwe app-fixture voor analyzer-tests vastleggen
│
├── docker/
│   ├── backend.Dockerfile            # multi-stage: base → api (slim) / worker (playwright)
│   ├── frontend.Dockerfile           # node build → nginx-image met statics
│   ├── nginx/
│   │   ├── nginx.conf
│   │   ├── conf.d/cssthema.conf      # routing, cache, rate limits, headers
│   │   └── snippets/security-headers.conf
│   ├── backup/
│   │   └── Dockerfile
│   └── compose/
│       ├── docker-compose.yml        # productie
│       ├── docker-compose.dev.yml    # override: hot reload, poorten open, mailpit, mock OIDC
│       └── docker-compose.minio.yml  # optionele S3-storage
│
├── deploy/
│   └── k8s/                          # Kustomize (productiefase)
│       ├── base/
│       └── overlays/{homelab,ha}/
│
└── docs/
    ├── README.md                     # index + beslissingen
    ├── 01-functionele-analyse.md
    ├── 02-technische-architectuur.md
    ├── 03-database-ontwerp.md
    ├── 04-ui-wireframes.md
    ├── 05-api-specificatie.md
    ├── 06-repository-structuur.md
    ├── 07-mvp-roadmap.md
    ├── 08-productie-roadmap.md
    ├── 09-risicoanalyse.md
    ├── 10-theme-injectie.md
    ├── adr/                          # één bestand per architectuurbeslissing (vanaf implementatie)
    ├── ops/                          # installatie, upgrade, backup/restore, Grafana-dashboard
    └── apps/                         # per app: bekende selectors, valkuilen, voorbeeldthema
```

## 2. Toelichting op keuzes

| Keuze | Reden |
|---|---|
| `deploy/` naast `docker/` | `docker/` bevat images en compose (wat de gebruiker draait); `deploy/` bevat platform-specifieke manifests. Houdt `docker/` overzichtelijk. De gevraagde top-level mappen `frontend/ backend/ scripts/ docker/ docs/` blijven ongewijzigd. |
| `src/`-layout in backend | Voorkomt per ongeluk importeren uit de werkmap; nette packaging. |
| `uv` + `pnpm` | Snelste reproduceerbare lockfiles in beide ecosystemen. |
| Feature-mappen in frontend | Alles van één scherm bij elkaar; gedeelde UI in `components/`. |
| Eén backend-image, twee targets | `api` zonder Chromium (± 150 MB), `worker` met Chromium (± 1,5 GB). |
| Fixtures per app | De DOM-analyzer en fingerprints worden getest op echte pagina's van Proxmox, Nextcloud, enz., zodat regressies bij app-updates zichtbaar worden. |

## 3. Branching en releases

- `main` is altijd releasebaar; feature branches + PR met verplichte CI.
- Conventional Commits → automatisch CHANGELOG en semver-tags (`v0.1.0`).
- Images: `ghcr.io/jonasz1996/cssthema-{api,worker,web}:{version|latest}`, multi-arch.
- Database-migraties maken deel uit van de release; `api` voert ze uit bij start.

## 4. Lokale ontwikkeling

```bash
cp .env.example .env
make dev        # compose dev-stack: postgres, redis, mock-OIDC, api (reload), worker, vite dev server
make test       # backend + frontend tests
make openapi    # openapi.json + frontend types regenereren
```

De dev-stack bevat een mock OIDC-provider (bv. `ghcr.io/navikt/mock-oauth2-server`) zodat Authentik lokaal niet nodig is, plus een kleine "demo-app"-container met statische HTML om tegen te crawlen.
