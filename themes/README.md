# Thema's van jbogaert.be

Deze map bevat de thema's die cssthema op css.jbogaert.be serveert. Upload ze via het dashboard
(*Import* > *Uploaden*, een zip van de map mag ook) en kies daarbij:

- *Publiceren*: **Ja, publiceren**. Met *Standaard* wordt een `.css` alleen een draft, en een draft
  krijgt geen enkele host: de bundel van *Hosts* meldt dan `"alg-kern" niet gevonden`.
- *Als de slug al bestaat*: **Nieuwe versie van het bestaande thema**. Anders maakt een tweede upload
  kopieën (`alg-kern-2` ...) en blijven de hosts aan de oude versie hangen.

Elke `.css` wordt zo een thema in de database (met versies), elke `.js` een script.

| Pad | Wat |
|---|---|
| `algemeen.css`, `algemeen.js` | Het algemene thema (stijl van allow en aiverslag) met de netwerkachtergrond. Werkt op elke app, maar is groot (ca. 470 KB) en traag in grote apps (zie *Modules*). |
| `apps/alg-<app>.css` | Per-app-aanvullingen; laden na het algemene thema of de modules. |
| `modules/alg-*.css` | `algemeen.css` in stukken, zodat een app alleen laadt wat hij nodig heeft (30 tot 130 KB, meestal ca. 50 KB, in plaats van 470 KB). |
| `varianten/alg-var-*.css` | Kleurvarianten (Nord, Dracula, Catppuccin, Gruvbox, Oceaan): alleen de `--alg-*`-tokens. |
| `hosts-modules.conf` | Per host de lichte stapel modules, om te importeren op de pagina *Hosts*. |

## Modules

`algemeen.css` blijft de bron. Pas dat bestand aan en maak de modules opnieuw met
`python scripts/themes/modules.py`. CI controleert met `--check` dat ze bij elkaar horen en dat elke
naam in `hosts-modules.conf` bestaat.

- `alg-kern`: tokens, basis, formulieren, tabellen, hulpklassen. Altijd als eerste.
- `alg-fw-<framework>`: `bootstrap`, `tabler`, `adminlte`, `material`, `vue`, `bulma`, `overig`
  (Fomantic/Semantic UI, PatternFly, Ant Design) of `extjs` (Proxmox). Tabler en AdminLTE horen
  bovenop `bootstrap`.
- `alg-app-<app>`: het blok van één app uit `algemeen.css` (bv. `alg-app-nextcloud`).

Volgorde voor een host: `alg-kern`, frameworks, `alg-app-*`, daarna `alg-<app>` uit `apps/`.

Waarom niet gewoon `algemeen.css` overal: het herkent elke app aan haar `<head>`
(`html:has(> head > meta[...])`) en Bulma aan de pagina (`body:has(...)`). Met zo'n `:has()` over
het hele document herberekent de browser bij elke DOM-wijziging de hele pagina: 75 tot 200 ms per
nieuwe regel in een logvenster of lijst van 6000 elementen (Dozzle, Proxmox, Uptime Kuma). Een
`alg-app-*`-module gaat alleen naar de host van die app en `alg-fw-bulma` alleen naar Bulma-apps;
daar is die herkenning overbodig en vervangt `modules.py` ze door `:not(...)`, met dezelfde
specificiteit. Zo kost dezelfde wijziging met de modules 0,1 tot 2 ms.

## Eén regel voor alle hosts

Op de pagina *Hosts* koppel je per hostnaam welke thema's en scripts hij krijgt; `*` geldt voor
elke host zonder eigen koppeling. Elke proxy host in NPM krijgt dezelfde regel bij **Advanced**
(de pagina toont hem met jouw `PUBLIC_BASE_URL`; uitleg in `docs/ops/installatie-debian.md`, § 4):

```nginx
# cssthema: zelfde regel in elke proxy host
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jbogaert.be/host/$host.css"><script src="https://css.jbogaert.be/host/$host.js" defer></script></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
# /cssthema
```

Weigert een app stylesheets van een ander domein (CSP met `style-src 'self'`, bv. Vaultwarden,
qBittorrent, Pi-hole), gebruik dan in die proxy host de variant via het eigen domein. Die geeft de
themabestanden door onder `/alg-thema/`, alleen GET en zonder cookies, en standaard **zonder
script**: zo krijgt een wachtwoordkluis nooit JavaScript van cssthema op haar eigen domein.

```nginx
# cssthema: zelfde regel in elke proxy host (eigen domein, alleen CSS)
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/host/$host.css"></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
location ^~ /alg-thema/ {
    limit_except GET HEAD { deny all; }
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 5s;
    proxy_ssl_server_name on;
    proxy_pass https://css.jbogaert.be/;
}
# /cssthema
```

Wil je bij een app die scripts van een ander domein weigert toch het netwerk (Portainer, dat alleen
het script weigert; ook qBittorrent en Pi-hole, die ook de stylesheet weigeren), gebruik dan de
variant *(eigen domein, CSS en script)* van de pagina *Hosts*: dezelfde regels, met in de
`sub_filter` ook `<script src="/alg-thema/host/$host.js" defer></script>`. Nooit bij een
wachtwoordkluis of een andere app waar je geheimen intypt.

### Nooit de regel

| Host | Waarom |
|---|---|
| het dashboard (`cssthema.jbogaert.be`, `DASHBOARD_HOST`) | een thema of script kan het dashboard zelf breken of overnemen |
| `css.jbogaert.be` (de host van `PUBLIC_BASE_URL`) | levert de bestanden zelf |
| Authentik (`authentik.jbogaert.be`) en de beheerpagina's van NPM (`nginx.jbogaert.be`, `nginx105.jbogaert.be`) | de login van al je apps en het beheer van alle hosts; zet ze in `EXCLUDED_HOSTS` |
| `allow.jbogaert.be`, `aiverslag.jbogaert.be` | tekenen hun eigen netwerk en hebben hun eigen stijl; krijgen ze de regel toch, zet hun koppeling op *Hosts* uit |

Voor het dashboard, de host van `PUBLIC_BASE_URL` en `EXCLUDED_HOSTS` geeft cssthema ook zelf een
lege bundel (*staat uit*), ook als de regel er per ongeluk staat.

### De koppeling `*`

`*` geldt voor elke host zonder eigen koppeling (bij jbogaert.be zo'n 35 hosts, o.a. photoprism,
guacamole, stirlingpdf en sftpgo). `hosts-modules.conf` zet hem bij het importeren (de eerste
koppeling in het bestand) op deze stapel, in deze volgorde, met script `algemeen`:

`alg-kern`, `alg-fw-bootstrap`, `alg-fw-tabler`, `alg-fw-adminlte`, `alg-fw-material`, `alg-fw-vue`,
`alg-fw-overig`

Dat is `algemeen.css` zonder de app-blokken, zonder Bulma (dat zonder herkenning ook gewone `.box`-
en `.button`-klassen zou raken) en zonder ExtJS (alleen Proxmox, en die hosts hebben een eigen
regel). Ongeveer 210 KB in plaats van 470 KB, en geen `:has()` over het hele document. Zet `*` niet
op `algemeen`: dan worden alle apps zonder eigen koppeling traag. Een Bulma-app geef je een eigen
koppeling met `alg-fw-bulma` erbij.

`hosts-modules.conf` importeer je op de pagina *Hosts* (*Importeren*). De stapels zijn gecontroleerd
door de vastgelegde pagina's (`vastleggen.py`) met de modules en met het volledige `algemeen.css` te
renderen: pixel-identiek. Meestal was dat alleen de loginpagina. Ziet een app er na het inloggen
anders uit, voeg dan de ontbrekende `alg-fw-*` toe (of zet die host op de stapel van `*` plus zijn
`alg-app-*` en `alg-<app>`). Grafana en Gitea zijn niet vastgelegd (de app lag plat of zat achter
Authentik) en staan er daarom zo in.

## Kleurvarianten

Een variant verandert alleen de kleuren (de `--alg-*`-tokens) en laadt als **laatste**. Op de
pagina *Hosts* zet je hem onderaan de lijst van een host, of bij `*` voor alle hosts zonder
eigen koppeling. Bijvoorbeeld `alg-kern`, `alg-fw-bootstrap`, `alg-portainer`, `alg-var-nord`.

De bestanden komen uit `scripts/themes/varianten.py` (pas daar de kleuren aan en draai het
script; CI controleert met `--check`). Het script houdt knoppen en statusvlakken op minstens
4.5:1 contrast. Lettertypes en andere bestanden in een thema: gebruik een absolute URL
(`https://css.jbogaert.be/inter.woff2`), want in `/host/<host>.css` wijst een relatieve URL
naar `/host/`.
