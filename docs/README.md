# cssthema — Ontwerpdocumentatie

> Status: **ontwerp, ter goedkeuring** · Versie 0.1 · 2026-10-05
> Conform de opdracht wordt pas code geschreven nadat dit ontwerp is goedgekeurd.

## Documenten

| # | Document | Inhoud |
|---|---|---|
| 1 | [Functionele analyse](01-functionele-analyse.md) | Rollen, begrippen, eisen per module met ID en prioriteit, RBAC-matrix, flows, niet-functionele eisen |
| 2 | [Technische architectuur](02-technische-architectuur.md) | Containers, ADR's, backend-lagen, CSS-pijplijn, levering + caching, jobs, DOM-capture, AI, auth, SSRF, frontend, deployment, backups, observability, tests |
| 3 | [Database-ontwerp](03-database-ontwerp.md) | ER-diagram, enums, tabellen, indexen, SQLAlchemy-stijl, kernqueries, migraties, volumes |
| 4 | [UI-wireframes](04-ui-wireframes.md) | Navigatie en wireframes van alle schermen, met de editor als kern |
| 5 | [API-specificatie](05-api-specificatie.md) | Conventies, foutmodel, schema's, alle endpoints, publieke CSS-endpoints, voorbeelden, OpenAPI-aanpak |
| 6 | [Repository-structuur](06-repository-structuur.md) | Volledige monorepo-boom en toelichting |
| 7 | [MVP-roadmap](07-mvp-roadmap.md) | MVP-definitie, fasen 0–4 met spikes en acceptatiecriteria, implementatiestrategie |
| 8 | [Productie-roadmap](08-productie-roadmap.md) | v0.5 → v1.0 → v2, exitcriteria |
| 9 | [Risicoanalyse](09-risicoanalyse.md) | 21 risico's met score en mitigatie, top-5 |
| 10 | [Theme-injectie](10-theme-injectie.md) | Injectiemethodes per app (NPM, native, Stylus, userscript, extensie) — functie 8 uit de opdracht |

## De belangrijkste ontwerpbeslissingen

1. **Modulaire monoliet**: één FastAPI-codebase met twee processen, `api` en `worker` (arq/Redis). Playwright draait alleen in de worker, nooit in het request-pad.
2. **Draft ≠ live**: de editor slaat continu een draft op ("live save"); alleen *publiceren* maakt een onveranderlijke versie die op `/{slug}.css` verschijnt. Een half getypte regel komt nooit op een loginpagina terecht.
3. **Rollback maakt een nieuwe versie** met de oude inhoud. Daardoor blijft de historie lineair en auditbaar, en verandert de ETag altijd mee.
4. **Gecompileerde CSS wordt bij het publiceren opgeslagen** (met SHA-256 als ETag) en via een nginx-microcache geserveerd, met `stale-if-error`. Als cssthema uitvalt, blijven de apps tot 24 u hun thema krijgen.
5. **De preview draait tegen een vastgelegde DOM-snapshot** in een gesandboxte iframe, inclusief Shadow DOM, zonder scripts. Wijzigingen zijn binnen ~100 ms zichtbaar. Een live-proxy-preview volgt na v1.0.
6. **Injectie gebeurt standaard same-origin** via een NPM-location `/__cssthema/` met `sub_filter`, zodat de CSP van apps zoals Nextcloud het thema niet blokkeert. Waar een app een eigen custom-CSS-optie heeft, gaat die voor.
7. **Paletten als gedeelde design tokens** (`--ct-*`): Nord, Dracula, Catppuccin en de andere presets zijn data. Eén paletwijziging kan alle gekoppelde thema's opnieuw publiceren.
8. **AI levert gestructureerde data** (variabelen en overrides), en cssthema rendert daar zelf de CSS van. Elke selector wordt tegen de snapshot gecontroleerd. Er is een gratis, deterministische "palette mapping" als fallback, en Ollama als lokale optie.
9. **Security**: OIDC via Authentik als BFF (alleen een httpOnly-cookie, geen tokens in de browser), RBAC met rol ∩ API-key-scopes, en een security-lint die externe `url()`/`@import` blokkeert (tegen CSS-exfiltratie op loginpagina's). Daarnaast een begrensde SSRF-allowlist voor de crawler en een audit log die alleen kan aanvullen (append-only).
10. **De MVP-knip** legt eerst de keten importeren → schrijven → publiceren → injecteren neer, plus security. Discovery, screenshots en AI komen daarna, omdat de grootste technische onzekerheden in de kernketen zitten.

## Open punten voor goedkeuring

| Punt | Voorgestelde keuze |
|---|---|
| UI-taal | Engels eerst, Nederlands in v1.0 |
| AI-provider standaard | Anthropic (model instelbaar), met Ollama en palette mapping als alternatieven |
| MVP zonder discovery/screenshots/AI | Ja, zie [07](07-mvp-roadmap.md) § 1 voor de motivatie |
| Publieke URL | Zowel `/{slug}.css` als `/themes/{slug}.css`, plus `/themes/{slug}@{n}.css` voor vaste versies |
