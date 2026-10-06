# Spike S1 — Injectie via Nginx Proxy Manager (`sub_filter`, same-origin)

> Fase 0 · 2026-10-05 · Status: **mechanisme bevestigd op NPM 2.16.0**; nog te testen op de echte apps

## Vraag

Werkt het snippet uit [10-theme-injectie](../10-theme-injectie.md) § 2.2 in een echte NPM? Concreet:

1. Laat NPM zijn eigen `location /` weg als *Advanced* er zelf een bevat?
2. Werkt `sub_filter` als de upstream gecomprimeerd antwoordt (zoals `pveproxy`)?
3. Omzeilt same-origin laden een strikte CSP (`style-src 'self'`, zoals bij Nextcloud)?
4. Blijven websockets en de NPM-opties (*Block Common Exploits*, *Websockets Support*) werken?

## Opzet

Alles in Docker, lokaal:

- **NPM** `jc21/nginx-proxy-manager:latest` (versie 2.16.0). Proxy hosts zijn aangemaakt via de NPM-API, met *Block Common Exploits* en *Websockets Support* aan.
- **Nep-app** (aiohttp) als stand-in voor Proxmox:
  - HTML gecomprimeerd (deflate/gzip als de client dat vraagt);
  - header `Content-Security-Policy: default-src 'self'; style-src 'self'`;
  - een eigen stylesheet;
  - een websocket-echo op `/ws`.
- **cssthema-stub** die `/themes/proxmox.css` serveert.
- **Chromium** (Playwright) laadt de pagina's via NPM en meet de berekende stijl en CSP-fouten.

## Resultaten

| # | Test | Resultaat |
|---|---|---|
| 1 | Gegenereerde NPM-config (`/data/nginx/proxy_host/1.conf`) | ✓ NPM laat zijn standaard-`location /` weg zodra *Advanced* een `location /` bevat. Onze location met `include conf.d/include/proxy.conf` neemt het over. *Block Common Exploits* en de websocket-headers op serverniveau blijven staan. |
| 2 | HTML via NPM, client vraagt gzip | ✓ `<link href="/__cssthema/proxmox.css">` staat vóór `</head>`. NPM comprimeert het resultaat zelf weer naar de browser. |
| 3 | Zonder `proxy_set_header Accept-Encoding ""` | ✗ Geen injectie (0 treffers): de upstream antwoordt gecomprimeerd en `sub_filter` ziet niets. **De regel is dus verplicht.** |
| 4 | `/__cssthema/proxmox.css` | ✓ `200`, `text/css`, inhoud van cssthema |
| 5 | Browser, same-origin variant | ✓ Thema toegepast (`background = rgb(46, 52, 64)`), geen CSP-fout |
| 6 | Browser, directe link naar een ander domein | ✗ Geblokkeerd door CSP (`Refused to load the stylesheet … violates … style-src 'self'`). **Same-origin is daarmee bevestigd als standaard.** |
| 7 | Websocket-handshake via NPM | ✓ `101 Switching Protocols` |
| 8 | Andere responses (eigen CSS van de app) | ✓ Onaangetast; `sub_filter` raakt alleen `text/html` |
| 9 | cssthema-stack volledig onbereikbaar | HTML laadt direct. De CSS-request faalt na de `proxy_connect_timeout` van **2 s** met `504`. |

## Besluiten

- Het snippet uit docs/10 § 2.2 klopt en wordt de basis voor de snippet-generator (fase 4).
- `proxy_set_header Accept-Encoding "";` is verplicht. De snippet-generator zet die regel er altijd in.
- **Nieuw punt (#9):** een stylesheet in `<head>` blokkeert het renderen. Ligt de hele cssthema-stack plat, dan wacht de pagina tot de timeout verloopt.
  - Valt alleen de api uit, dan serveert de cssthema-nginx stale CSS (spike S3) en speelt dit niet.
  - Maatregel: `proxy_connect_timeout 1s` in het gegenereerde snippet (was 2 s).
  - Aanbeveling in de docs: koppel NPM aan het Docker-netwerk `cssthema_edge` (`proxy_pass http://cssthema-nginx/themes/`; `cssthema-nginx` is een netwerkalias in de compose), zodat er geen DNS- of TLS-hairpin in het pad zit.

## Nog open, alleen te testen in jouw omgeving

Dezelfde test op de echte Proxmox, Nextcloud, Grafana en UniFi achter jouw NPM:

- Spelt de app `</head>` precies zo?
- Heeft de app afwijkende CSP-headers?
- Blijven noVNC en de console werken?

Daarvoor is in fase 4 de knop **"Test injectie"** gepland (F-IN-03). Tot die tijd kun je het snippet handmatig op één host proberen.
