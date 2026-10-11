# 11 — Projectreview en stappenplan

> Status: **voorstel** · Versie 0.1 · 2026-10-11
>
> Getoetst: de volledige repo op de PR #8-branch (commit b6c40b2: backend, frontend, nginx, installer, CI, docs, capture-script) en de thema's in de projectmap (`algemeen.css`, `algemeen.js`, 58 × `alg-<app>.css`), naast de ontwerpdocumenten 01–10 en hoe cssthema echt draait (Debian-LXC achter NPM + Authentik, thema's cross-origin vanaf `https://css.jbogaert.be`).

## Kort

De basis is goed. Alle controles zijn groen: backend 462 tests (+ ruff en mypy schoon), frontend 549 tests, lint, typecheck en build. De preview-sandbox, de zip-verwerking, de schrijfbeveiliging en de cache-generatieteller zitten degelijk in elkaar. Er is geen enkele ernstige bug gevonden.

Wat wel aandacht vraagt:

1. **Een paar kleine bugs die in jouw opstelling echt kunnen bijten** (database-codering, de linter weigert inline SVG's, `algemeen.css` zit vlak onder de groottelimiet, een mislukte update laat het dashboard kapot achter). Allemaal klein werk.
2. **Geen automatische backups** en geen veilig terugrolpad bij een update.
3. **Het uitrollen van thema's over ~100 diensten is nu handwerk**: per proxy host een eigen `sub_filter` met 2 à 3 bestanden, en elke app laadt de volle 472 KB van `algemeen.css`. Hier zit de grootste winst.
4. **Fase 2 en 3 uit de roadmap zijn nog niet begonnen** (diensten, snapshots, login/rollen). Die mogen slimmer aansluiten op wat je al hebt: de zips van `vastleggen.py` en Authentik vóór NPM.

Hieronder staat alles in vier blokken. Elk punt heeft een nummer en een grootte (**S** = uurtje, **M** = halve tot hele dag, **L** = meerdere dagen). Zeg gewoon welke nummers eerst mogen, bijvoorbeeld "A en C1".

---

## Blok A — Verbeteringen aan wat er al staat

### A1. Bugs en risico's (aanrader: alles in één keer, samen ± 1 dag)

| # | Wat ik vond | Waar | Oplossing | Grootte |
|---|---|---|---|---|
| A1.1 | De database wordt aangemaakt met de codering van de Postgres-cluster. Op een LXC zonder locale is dat `SQL_ASCII`, en dan geeft elke naam met een é of ë een fout 500 (nagespeeld: 2 tests falen op SQL_ASCII). | `deploy/debian/install.sh:122` | `createdb -E UTF8 -T template0`, plus een controle in `/readyz`. | S |
| A1.2 | De linter weigert elke `<`, dus ook inline SVG's (`url("data:image/svg+xml;utf8,<svg…")`) en `@media (width < 600px)`. Publiceren is dan geblokkeerd; veel handgemaakte thema's gebruiken zulke SVG's. | `backend/src/cssthema/domain/css/linter.py:286` | `<` toestaan binnen strings en `url()`. | S |
| A1.3 | `algemeen.css` is 472 KB, de limiet per thema is 512 KB. Nog een paar fixes en opslaan faalt met een 413; de editor toont de limiet nergens. | `config.py:41`, `StatusBar.tsx` | Limiet naar 1 MB en tonen in de statusbalk; structureel: C2. | S |
| A1.4 | Een update bouwt de frontend rechtstreeks in de live map. Faalt de build, dan is het dashboard kapot (500). | `install.sh:153-160` | In een tijdelijke map bouwen en pas daarna omwisselen. | S |
| A1.5 | Elke herstart draait `alembic upgrade head`, zonder dump vooraf en zonder bijgehouden vorige commit. Terugrollen na een slechte update kan niet. | `install.sh:11`, `cssthema-api.service:13` | `pg_dump` + `git rev-parse HEAD` vóór de migratie, en een "terugrollen"-sectie in de docs. | S |
| A1.6 | De publieke NPM-location `~ \.(css|js)$` laat alle HTTP-methodes door zonder Authentik. Nu is er geen schrijfroute die op `.css`/`.js` eindigt, maar het is een valkuil. | `docs/ops/installatie-debian.md:88` en het gegenereerde snippet | `limit_except GET HEAD { deny all; }` en de regex verankeren. | S |
| A1.7 | Wie langs Authentik op het dashboard komt, kan JavaScript uitrollen naar ~100 apps. Schrijfrecht hangt nu alleen af van het IP van NPM. | `docker/nginx/conf.d/cssthema.conf:13-22` | In Authentik de applicatie voor css.jbogaert.be beperken tot een admin-groep (jouw kant, 5 minuten); later D3. | S |
| A1.8 | Bestanden uit `css-files/` krijgen geen `Access-Control-Allow-Origin`, thema's uit de database wel. Fonts of `crossorigin`-links uit css-files werken daardoor niet cross-origin. | `cssthema.conf:87-106` | `add_header Access-Control-Allow-Origin "*" always;` | S |
| A1.9 | Na publiceren wordt de Redis-cache één keer geleegd. Mislukt dat (time-out), dan blijft de oude CSS tot 1 uur staan. | `services/css_delivery.py:199-224` | Opnieuw proberen en de TTL naar 5 minuten. | S |
| A1.10 | Een bundel-import heeft geen limiet op het aantal versies en lint alles binnen één request (± 1 s per versie van 460 KB). | `services/import_export.py:371` | Maximum ± 200 versies. | S |
| A1.11 | Kleine dingen: duplicate kan aan een verwijderde dienst hangen (`theme_service.py:406`); `vite build --sourcemap` faalt (`vite.config.ts:91`); grijze hinttekst haalt het contrast niet (`--ui-dim: #777`); te grote CSS laat de preview leeg zonder melding; `.js`/fonts met hoofdletters of submap vallen in de SPA (200 text/html). | zie kolom 2 | Elk een paar regels. | S |

### A2. Update- en beheerpad

| # | Wat | Grootte |
|---|---|---|
| A2.1 | **Automatische backups**: systemd-timer met `pg_dump -Fc`, tar van `css-files/` (incl. archieven) en `/etc/cssthema/cssthema.env` (de sleutels!), met bewaartermijn en een kopie naar een andere host. Plus een geteste restore-instructie. | M |
| A2.2 | **Bewaking**: `/readyz` publiek bereikbaar maken (eigen NPM-location, alleen GET) zodat Uptime Kuma het kan volgen; `OnFailure=` in de systemd-units. | S |
| A2.3 | **Systemd verharden**: `ProtectSystem=strict`, `ReadWritePaths=/var/lib/cssthema`, `PrivateTmp`, worker na `postgresql.service`; `server_tokens off`; Node-versie vastpinnen; journald-limiet; geen access-log voor de ± 100 apps die CSS ophalen. | S |
| A2.4 | **Naar `main`**: na het mergen van PR #8 volgt `/opt/cssthema` nog de oude branch. `install.sh` waarschuwt dan en de docs krijgen `git switch main`. | S |
| A2.5 | **Opkuis**: `.scripts-archief/` en `.geimporteerd/` groeien onbeperkt; de scriptlijst hasht bij elke oproep alle bestanden opnieuw. | S |

### A3. CI en repo

| # | Wat | Grootte |
|---|---|---|
| A3.1 | CI draait bij `push` alleen op `main`; ook op werkbranches laten draaien. | S |
| A3.2 | Testen tegen PostgreSQL 17 (dat draait op Debian 13), niet alleen 16. | S |
| A3.3 | Shellcheck, actionlint en ruff op `scripts/` (nu 10 meldingen in `vastleggen.py`). | S |
| A3.4 | Installatietest die een **upgrade** doet (vorige release → nieuwe) in plaats van enkel een verse installatie. | M |
| A3.5 | Dependabot: `target-branch: main`, Node-majors negeren (de node-26-PR botst met Node 22), images in `docker/compose` meenemen. | S |
| A3.6 | Tests voor wat nu ontbreekt: een CSS van ± 500 KB (snelheid), cache-invalidatie tegen echte Redis, de `PreviewPane`-component. | M |

### A4. Snelheid van de editor bij grote thema's

| # | Wat | Grootte |
|---|---|---|
| A4.1 | Bij elke toetsaanslag gaat de volle stylesheet naar de preview en wordt de grootte opnieuw berekend. Bij 470 KB gaat typen haperen (afgeleid uit de code, niet gemeten). Preview en grootte vertragen boven ± 200 KB. | S |
| A4.2 | Hoofdbundel 512 KB: andere pagina's ook lazy laden. Monaco laadt alle editorfuncties (3,9 MB); alleen de gebruikte importeren. | M |

### A5. Capture-script `vastleggen.py`

| # | Wat | Grootte |
|---|---|---|
| A5.1 | Mislukte diensten worden nooit opnieuw geprobeerd (elke bestaande `info.json` telt als klaar, `:772`). Nieuwe optie `--fouten` die alleen niet-ok diensten overdoet; handig als je de 35 uitgevallen diensten weer start. | S |
| A5.2 | URL's worden met querystring bewaard; daar kunnen tokens in zitten (Plex `X-Plex-Token`, Jellyfin `api_key`). Zulke parameters wegfilteren. | S |
| A5.3 | Een zip-deel kan één dienst boven 24 MB uitkomen; overzicht.html linkt naar bestanden in andere delen. | S |

### A6. Documentatie gelijktrekken met de praktijk

| # | Wat | Grootte |
|---|---|---|
| A6.1 | ADR-11 en docs 02/04/09/10 noemen de same-origin route `/__cssthema/` als standaard; in werkelijkheid laad je cross-origin vanaf `css.jbogaert.be`, met `/alg-thema/` als omweg voor CSP-apps. Bijwerken, plus de cachetekst (bestanden zijn `no-cache` + ETag, niet "60 s"). | S |
| A6.2 | De thema's (`algemeen.*`, 58 × `alg-*.css`, sub_filter-conf) staan alleen in de projectmap en in je database, niet in git. Een map `themes/` in de repo met lint in CI, zodat elke wijziging een versie heeft en terug te vinden is. | S |

---

## Blok B — Wat aan jouw kant nog openstaat

Dit kan ik niet voor je doen, maar het blokkeert wel een deel van het bovenstaande:

1. PR #8 nakijken en mergen naar `main`, en in GitHub `main` als standaardbranch zetten. Daarna kunnen dependabot-PR's #1 t/m #7 dicht (ze wijzen naar de oude branch).
2. Bevestigen of `css.jbogaert.be` in NPM nu naar de cssthema-LXC (192.168.10.154) wijst. Controle: `curl -sI https://css.jbogaert.be/alg-proxmox.css` moet `200` geven.
3. In Authentik de app voor css.jbogaert.be beperken tot jezelf of een admin-groep (A1.7).

---

## Blok C — Nieuwe features met de meeste winst voor ~100 diensten (mijn aanbeveling)

### C1. Eén regel voor alle proxy hosts (M) ★

Nu staat in elke proxy host een eigen `sub_filter` met 2 à 3 bestanden, en elke wijziging betekent NPM-hosts één voor één aanpassen. Voorstel:

- cssthema krijgt een endpoint `https://css.jbogaert.be/host/<hostnaam>.css` dat per host de juiste stapel samenvoegt (bv. `algemeen` + `alg-proxmox`) in **één** response, en idem `/host/<hostnaam>.js` (leeg voor kluizen zoals Vaultwarden).
- nginx kan variabelen gebruiken in `sub_filter`, dus de regel is voor **elke** host identiek:
  ```nginx
  sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css"><script src="https://css.jbogaert.be/host/$host.js" defer></script></head>';
  sub_filter_once on;
  proxy_set_header Accept-Encoding "";
  ```
- Die regel kan één keer in NPM's globale `/data/nginx/custom/server_proxy.conf` (geldt voor alle proxy hosts), in plaats van 100 keer in Advanced.
- In het dashboard een pagina **Hosts**: lijst van hosts met per host de gekoppelde thema's, script aan/uit, en een "thema uit"-schakelaar.

Resultaat: een app een ander thema geven of het netwerk uitzetten is één klik in het dashboard, zonder NPM aan te raken. De CSP-apps (Vaultwarden, Nextcloud …) houden hun `/alg-thema/`-uitzondering.

### C2. `algemeen.css` opsplitsen (M)

472 KB met ± 3.000 `!important` wordt op elke app geladen, ook de regels voor ExtJS, Gitea, Syncthing en tientallen andere apps die daar niets doen. Voorstel: splitsen in een kern (tokens, basis, formulieren, tabellen) plus modules per framework en per app. Met C1 voegt de server per host alleen de nodige modules samen (geschat ± 60–120 KB per app in plaats van 472 KB, afgeleid, niet gemeten). Lost ook A1.3 op en maakt fouten per app makkelijker te vinden.

### C3. Thema-gezondheidscheck per host (M)

Een job die periodiek elke host opent (Playwright in de worker, of via `vastleggen.py`) en controleert: laadt de CSS, laadt het script, zijn er CSP-fouten, is de pagina nog donker? Het dashboard toont per host groen/oranje/rood. Zo merk je meteen dat een app-update je thema brak, zonder zelf 100 apps af te lopen.

### C4. Thema-varianten via tokens (S–M)

Alle thema's gebruiken al alleen `--alg-*`-tokens. Een variant (Nord, Dracula, Catppuccin, of een lichte versie) is dan een klein bestand dat alleen de tokens overschrijft. Met C1 kies je per host of globaal een variant. Dit is ook de goedkoopste eerste stap richting het AI-deel uit de opdracht.

---

## Blok D — Roadmap-features (fase 2–4 en v0.5+), aangepast aan hoe je het gebruikt

| # | Feature | Wat anders dan in het ontwerp | Grootte |
|---|---|---|---|
| D1 | **Diensten + snapshots importeren** (fase 2.1–2.3, 2.6) | Begin met het importeren van de zips van `vastleggen.py` als diensten en snapshots, in plaats van eerst een eigen crawler op de server te bouwen. Die zips hebben al DOM, CSS, kleuren en screenshots per dienst, en worden gemaakt met jouw login. | L |
| D2 | **Preview tegen de echte app** (fase 2.9–2.11) | De editor toont het thema op de vastgelegde pagina van die dienst, met autocomplete op de classes van die app en een waarschuwing als een selector nergens matcht. | L |
| D3 | **Login en rollen** (fase 3) | Authentik zit al vóór NPM. Eerst de `X-authentik-username`/`groups`-headers van NPM vertrouwen (alleen van TRUSTED_PROXIES) en daarop rollen Admin/Editor/Viewer zetten; de volledige OIDC-flow uit het ontwerp is pas nodig als je cssthema ooit zonder forward-auth draait. Daarbij: API-keys en een audit-log-pagina (de rijen worden al geschreven). | M |
| D4 | **NPM-koppeling in het dashboard** (v0.5) | Proxy hosts uit de NPM-API lezen (met MFA-code, zoals `vastleggen.py` al doet) om de Hosts-pagina van C1 automatisch te vullen. Later optioneel: de sub_filter zelf via de API zetten. | M |
| D5 | **Voor/na-screenshots** in de thema browser (v0.5) | Komen uit de capture-zips of de gezondheidscheck (C3). | M |
| D6 | **AI-voorstellen** (v0.6) | Claude krijgt de snapshot + screenshots van een dienst en schrijft een `alg-<app>.css` op de bestaande tokens, als concept dat je in de editor nakijkt. Zo werk ik nu ook met de hand. | L |
| D7 | **Shadow DOM-apps** (v0.7) | Voor Home Assistant een thema-YAML op dezelfde tokens, voor Authentik de Custom CSS van het merk; userstyle-/userscript-export voor apps die geen injectie toelaten. | M |
| D8 | **Editor-comfort** | Ctrl+K-commandopalet en Ctrl+P snel openen (stonden in het ontwerp), paletten bewerken en dupliceren, voor/na-schakelaar in de preview. | M |
| D9 | **Kubernetes, multi-arch images, k6-loadtest** (fase 4 / v0.8) | Voor jouw opstelling (één LXC, geen Docker) weinig nut. Mijn voorstel: laten vallen of helemaal achteraan. | — |

---

## Voorgestelde volgorde

1. **A1 + A2.1 + A2.4** (bugs, backups, overstap naar main): klein, en maakt updates veilig. ± 1,5 dag.
2. **C1 + C2** (één regel voor alle hosts, `algemeen.css` opsplitsen): de grootste winst in het dagelijks gebruik. ± 2 dagen.
3. **A6.2 + A3** (thema's in git, CI bijwerken).
4. **C3** (gezondheidscheck), daarna **D1 + D2** (snapshots en preview tegen de echte app).
5. **D3**, daarna naar behoefte C4, D4–D8.

Kies je liever iets anders eerst, zeg dan de nummers.
