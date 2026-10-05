# Spike S3 — CSS-cache: purge of korte TTL?

> Fase 0 · 2026-10-05 · Status: **afgerond, besluit genomen**

## Vraag

Hoe zorgen we dat een nieuwe publicatie direct op `/{slug}.css` staat, terwijl nginx de CSS cachet (docs/02 § 3.3)? Open-source nginx heeft geen `proxy_cache_purge` (dat zit alleen in NGINX Plus of in een extra module).

## Besluit

**Korte TTL (60 s) + een interne refresh-server die de cache-entry overschrijft.**

- De publieke server cachet CSS 60 s (`proxy_cache_valid 200 60s`) met `proxy_cache_revalidate on` (na afloop een goedkope conditionele request met ETag) en `proxy_cache_use_stale error timeout …` (verouderde CSS blijft beschikbaar als de api plat ligt).
- De cache-sleutel is alleen `$uri`. `?v=…` en `Host` tellen niet mee.
- Een tweede `server` op poort **8081** gebruikt dezelfde cache-zone en sleutel, met `proxy_cache_bypass 1`. Een `GET http://nginx:8081/{slug}.css` haalt de CSS dus altijd vers bij de api op en **overschrijft** de entry. De api roept dit na elke publicatie en rollback aan (fase 1).
- Poort 8081 wordt niet gepubliceerd en is alleen binnen het compose-netwerk bereikbaar.
- Lukt de refresh-call niet, dan is de vertraging hooguit 60 s. Er is dus geen harde afhankelijkheid.

Configuratie: `docker/nginx/conf.d/cssthema.conf` en `docker/nginx/snippets/css-cache.conf`.

## Getest (nginx 1.27 + stub-upstream)

| # | Scenario | Resultaat |
|---|---|---|
| 1 | Eerste request | `MISS`, inhoud v1 |
| 2 | Tweede request | `HIT`, inhoud v1 |
| 3 | Upstream gewijzigd naar v2, binnen 60 s | `HIT`, nog v1 (verwacht) |
| 4 | `?v=abc` | `HIT`: dezelfde entry, de query telt niet mee |
| 5 | `GET :8081/proxmox.css` (intern) | geeft v2 terug |
| 6 | Publiek request direct daarna | `HIT`, inhoud **v2** ✓ |
| 7 | Poort 8081 van buitenaf | niet gepubliceerd ✓ |
| 8 | Upstream gestopt, na verloop van de TTL (70 s) | `STALE`, inhoud v2 ✓ (`stale-if-error`) |
| 9 | Upstream gestopt, slug nooit gecachet | `504`: de app valt terug op zijn standaard-look |
| 10 | Ongeldige slug `/Bad_Slug.css` | `404` met `/* cssthema: not found */` (eerst kwam de SPA terug; opgelost) |

## Gevolgen voor fase 1

- De publish-service roept na de commit `http://nginx:8081/{slug}.css` en `/themes/{slug}.css` aan (best effort, timeout 2 s, fout wordt gelogd).
- De api moet `ETag` en `Last-Modified` meesturen, zodat `proxy_cache_revalidate` met `304` werkt.
- `@{n}`-URL's zijn onveranderlijk en hebben geen refresh nodig.
