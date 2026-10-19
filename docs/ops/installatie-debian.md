# Installatie op Debian (zonder Docker)

cssthema draait als gewone services op één Debian 13-machine: nginx, de api (FastAPI in een Python-venv), een worker, PostgreSQL en Redis. Eén script installeert alles en werkt het later ook bij. Nginx Proxy Manager (NPM) staat op een andere machine en stuurt je publieke CSS-domein (zonder login) naar deze container. Het dashboard open je rechtstreeks op het LAN, of via een tweede domein in NPM achter Authentik.

> **Stand van zaken.** In het dashboard maak, bewerk en publiceer je thema's, met versies en terugzetten. Op **Hosts** kies je per proxy host welke thema's en scripts hij krijgt, met één regel in NPM voor alle hosts (§ 4). Op **Services** staan de vastgelegde pagina's van je apps, voor de preview in de editor. De CSS-bestanden die je nu met de hand maakt, blijven werken en kan je importeren (§ 3). De eigen login komt in fase 3. Tot dan heeft het dashboard **geen login**: open het alleen op het LAN, of zet het in NPM achter Authentik (§ 2 en § 4). De CSS-bestanden zelf blijven publiek, want je apps laden ze ook op hun loginpagina.

> **Overstappen van een oude CSS-server of een oudere versie?** Volg [uitrol.md](uitrol.md): één lijst in de juiste volgorde, met per stap een controle en een weg terug.

## 1. Container (Proxmox)

| Instelling | Waarde |
|---|---|
| Template | `debian-13-standard` |
| Unprivileged | ja |
| CPU / RAM / swap | 2 cores / 2048 MB / 512 MB |
| Disk | 8 GB |
| Netwerk | vast IP of DHCP-reservering, bereikbaar vanaf NPM |

## 2. Installeren

Kies eerst waar je het dashboard opent:

- **Alleen op het LAN** (het eenvoudigst): op `http://<ip-van-de-container>/`, zonder NPM en zonder login. NPM stuurt alleen het CSS-domein naar de container.
- **Via NPM, achter Authentik**: op `https://cssthema.jouwdomein.be/`, ook van buiten je netwerk (§ 4, *Dashboard achter Authentik*).

Als root in de container, met je eigen adressen. Dashboard op het LAN (container `192.168.1.20`, je pc in `192.168.1.0/24`):

```bash
apt update && apt install -y git
git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
DASHBOARD_HOST=192.168.1.20 \
TRUSTED_PROXIES=192.168.1.0/24 \
PUBLIC_BASE_URL=https://css.jouwdomein.be \
EXCLUDED_HOSTS=authentik.jouwdomein.be,npm.jouwdomein.be \
  bash /opt/cssthema/deploy/debian/install.sh
```

Via NPM wordt dat `DASHBOARD_HOST=cssthema.jouwdomein.be` en `TRUSTED_PROXIES=192.168.1.10` (het IP van je NPM-host).

| Instelling | Wat |
|---|---|
| `DASHBOARD_HOST` | **Verplicht.** Het adres waarop je het dashboard opent: het IP van de container (alleen op het LAN) of een hostnaam in NPM achter Authentik; meerdere mag, met spaties of komma's. Alleen daar serveert nginx het dashboard en de api. Elk ander adres (het CSS-domein, elke andere proxy host) krijgt alleen de publieke bestanden. Zonder deze waarde stopt het script voor het iets verandert. |
| `PUBLIC_BASE_URL` | Je publieke CSS-domein, met `https` en een domeinnaam (geen IP): het begin van de NPM-regel in elke proxy host (§ 4). Het script waarschuwt bij `http` of een IP. |
| `TRUSTED_PROXIES` | Wie de api mag gebruiken, lezen én schrijven (naast de container zelf); IP's of netwerken, met komma's. Dashboard op het LAN: het netwerk van je pc, bv. `192.168.1.0/24`. Via NPM: alleen het LAN-IP van de NPM-host. Van deze adressen neemt nginx ook het echte client-IP uit `X-Forwarded-For` over. Zie § 4, *Wie mag de api gebruiken*. |
| `EXCLUDED_HOSTS` | Optioneel: hostnamen die nooit thema's of scripts krijgen, naast het dashboard en het CSS-domein. Zet hier Authentik en elke beheerpagina van NPM (§ 4, *Nooit de regel*). |

Het script ([`deploy/debian/install.sh`](../../deploy/debian/install.sh)):

- installeert nginx, PostgreSQL, Redis (of Valkey) en Python uit Debian;
- maakt `/etc/cssthema/cssthema.env` aan met willekeurige wachtwoorden en sleutels, en zet de waarden hierboven daarin;
- maakt bij een bestaande installatie eerst een back-up (§ 6);
- zet de backend in een venv (`/usr/local/lib/cssthema/venv`) en bouwt het dashboard met een eigen Node.js (alleen voor de build, raakt Debian niet);
- installeert de nginx-site en de systemd-services `cssthema-api` en `cssthema-worker`;
- eindigt met een controle: `{"status":"ok","checks":{"database":"ok","database_encoding":"ok","redis":"ok"}}`.

De eerste keer duurt het een paar minuten. Daarna open je het dashboard op `http://192.168.1.20/` (LAN; http, want daar is geen certificaat) of via NPM op `https://cssthema.jouwdomein.be/` (§ 4). Op elk ander adres staan alleen de publieke bestanden. Een waarde later veranderen: geef ze opnieuw mee vóór `bash`, of pas ze aan in `/etc/cssthema/cssthema.env` en draai het script opnieuw.

## 3. Je bestaande CSS-bestanden

Zet ze in `/var/lib/cssthema/css-files/`, met de submappen erbij. Op deze container (`rsync` moet ook op de oude server staan):

```bash
apt install -y rsync
rsync -rlt --exclude='.*' root@oude-css-server:/pad/naar/css/ /var/lib/cssthema/css-files/
chmod -R u=rwX,go=rX /var/lib/cssthema/css-files/*
```

`-rlt` in plaats van `-a` laat eigenaar en rechten van `css-files` zelf staan (de api moet erin kunnen schrijven); `chmod` maakt alles leesbaar voor nginx.

`/var/lib/cssthema/css-files/proxmox.css` is dan meteen `https://css.jouwdomein.be/proxmox.css`, en `css-files/css/donker.css` is `https://css.jouwdomein.be/css/donker.css`. Een bestand in deze map gaat voor op een thema met dezelfde naam in cssthema.

Om ze in het dashboard te bewerken, importeer je ze: **Import** → **CSS-bestanden op de server**, selecteer de bestanden en klik op **importeren**. Elk bestand wordt een thema met een eerste live versie en verhuist daarna naar `css-files/.geimporteerd/`; dezelfde URL serveert vanaf dan het thema. Vink je **Daarna archiveren** uit, dan blijft het bestand staan en blijft het voorgaan op het thema (het dashboard waarschuwt daar ook voor). Dat kan alleen voor bestanden direct in de map, met een naam die een geldige slug is (kleine letters, cijfers en streepjes): `Home_Assistant.css` hernoem je eerst naar `home-assistant.css`, en de link naar de oude naam pas je aan of laat je via *Hosts* lopen (§ 4).

Wil je liever met `nano` blijven werken, dan kan dat: laat de bestanden gewoon in deze map staan.

### Thema-scripts (`.js`)

Scripts zoals `algemeen.js` (de bewegende netwerkachtergrond) staan in dezelfde map: `/var/lib/cssthema/css-files/algemeen.js` is `https://css.jouwdomein.be/algemeen.js`. Je hoeft ze niet meer met de hand te kopiëren: in het dashboard upload je ze via **Import** → **Scripts**. Daar zie je ook welke scripts er staan, met hun publieke URL, en kan je ze bekijken, downloaden, vervangen en verwijderen.

- De naam wordt de URL: `Algemeen.js` wordt `algemeen`, `Netwerk Achtergrond` wordt `netwerk-achtergrond` (2 tot 64 kleine letters, cijfers en streepjes). `preview-bridge` is gereserveerd voor het dashboard. Een script in een submap of met hoofdletters serveert nginx niet.
- Alleen `.js`-bestanden in UTF-8, hoogstens 512 KB.
- Bestaat de naam al, dan vraagt het dashboard of je wil vervangen. De vorige versie gaat naar `css-files/.scripts-archief/<naam>.<tijdstip>.js`; verwijderen verplaatst het bestand ook daarheen. Die map is nooit publiek.
- Het script is meteen live (nginx serveert het bestand met `Cache-Control: no-cache`); er zijn geen versies of drafts zoals bij thema's.
- Een script kopiëren met `scp` mag nog steeds; zorg dan dat het leesbaar is voor nginx (`chmod 0644`). Het dashboard toont een waarschuwing als dat niet zo is.

In je apps komt een script via de regel voor alle hosts (§ 4): koppel het op **Hosts** aan een host, of aan `*` voor alle hosts zonder eigen koppeling.

### Diensten en snapshots (vastleggen.py)

Het capture-script `vastleggen.py` (op je pc, zie zijn README) legt per app de pagina vast zonder scripts, met de CSS van de app en screenshots zonder en met thema, en maakt daar zips van (delen van hoogstens 24 MB). Upload die zips in het dashboard op **Services**: elke app wordt een dienst met zijn snapshot. Een nieuwe zip van dezelfde app werkt de snapshot van die pagina bij. Was de app toen stuk of onbereikbaar (fout, geen HTML, Authentik-login of HTTP 5xx), dan blijft de vorige, goede snapshot staan; de kaart toont dan de nieuwe status en tijd, en "snapshot van <datum>". Screenshots en CSS waar niets meer naar verwijst, ruimt cssthema zelf op na elke import en bij het verwijderen van een dienst.

- In de editor kies je in de preview een snapshot in plaats van de demopagina: je ziet je thema dan op de vastgelegde pagina van de app, en de editor vult classes, id's en CSS-variabelen van die app aan.
- De snapshots, CSS en screenshots staan in `/var/lib/cssthema/storage/` (en dus in de back-ups). Ze bevatten de tekst van de vastgelegde pagina's, geen wachtwoorden; leg je met `--anoniem` vast, dan ook geen paginatekst.
- Afbeeldingen van de app zelf (logo's, iconen) laadt de preview niet: die komen van de app en de preview mag niets van buiten laden.

## 4. Nginx Proxy Manager

Eén proxy host wijst naar deze container, of twee als het dashboard via NPM gaat:

| Proxy host | Voor | Login | Advanced |
|---|---|---|---|
| `css.jouwdomein.be` (host van `PUBLIC_BASE_URL`) | thema-CSS, scripts, lettertypes, `/host/…`, `/readyz` | geen | leeg |
| `cssthema.jouwdomein.be` (`DASHBOARD_HOST`), alleen als je het dashboard niet op het LAN opent | dashboard en api | Authentik | het Authentik-blok hieronder |

Open je het dashboard op het LAN, maak dan geen proxy host voor het dashboard. Bestaat er nog een, dan geeft die voortaan een `404`: verwijder hem.

nginx van cssthema kijkt zelf naar de hostnaam. Het dashboard (de pagina's, `/assets/`, `/preview-bridge.js`) en de hele api staan alleen op `DASHBOARD_HOST`. Elk ander adres krijgt daar een `404` en ziet alleen de publieke bestanden: het CSS-domein, een proxy host die je zou vergeten af te schermen, en het IP van de container als het dashboard via NPM gaat. Daarom mag het CSS-domein een gewone proxy host zijn, zonder login en zonder Advanced-config.

Voor beide hosts:

| Tab | Veld | Waarde |
|---|---|---|
| Details | Scheme / Forward IP / Port | `http` / IP van deze container / `80` |
| | Cache Assets | **uit** (cssthema regelt zijn eigen cache) |
| | Block Common Exploits | aan |
| | Access List | *Publicly Accessible* (Authentik beschermt het dashboard) |
| SSL | | zoals je andere hosts (Let's Encrypt, Force SSL) |
| Custom locations | | **leeg** |

### Dashboard achter Authentik

Bij **Advanced** van `cssthema.jouwdomein.be` (vervang het adres van de outpost door het jouwe):

```nginx
# Dashboard en api: alleen na Authentik-login (tot cssthema zelf een login heeft).
location / {
    proxy_pass $forward_scheme://$server:$port;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffers 8 16k;
    proxy_buffer_size 32k;

    auth_request /outpost.goauthentik.io/auth/nginx;
    error_page 401 = @goauthentik_proxy_signin;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header Set-Cookie $auth_cookie;
}

location /outpost.goauthentik.io {
    proxy_pass http://192.168.1.20:9000/outpost.goauthentik.io;
    proxy_set_header Host $host;
    proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
    add_header Set-Cookie $auth_cookie;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
}

location @goauthentik_proxy_signin {
    internal;
    add_header Set-Cookie $auth_cookie;
    return 302 /outpost.goauthentik.io/start?rd=$request_uri;
}
```

Authentik moet het domein kennen: gebruik je forward auth per domein (*domain level*), dan is dat al zo; anders maak je in Authentik een applicatie met een *Proxy Provider* (*Forward auth, single application*) voor `https://cssthema.jouwdomein.be` en hang je die aan je outpost. Beperk die applicatie tot jezelf of een admin-groep (*Wie mag de api gebruiken*, hieronder).

### CSS-domein zonder login

`css.jouwdomein.be` krijgt geen Advanced-config. Wil je dat apps niet blijven wachten als cssthema hapert (NPM wacht standaard 90 s, en een stylesheet houdt het tonen van een pagina tegen), dan mag je er deze twee regels zetten; de `location /` van NPM neemt ze over:

```nginx
proxy_connect_timeout 1s;
proxy_read_timeout 5s;
```

### Controle

Van buiten je netwerk (bv. via 4G):

```bash
curl -sI 'https://css.jouwdomein.be/host/*.css'                                       # 200, content-type: text/css
curl -sI https://css.jouwdomein.be/proxmox.css                                       # 200 (een bestand of thema dat bestaat)
curl -s -o /dev/null -w '%{http_code}\n' https://css.jouwdomein.be/api/v1/meta       # 404
curl -s -o /dev/null -w '%{http_code}\n' https://cssthema.jouwdomein.be/api/v1/meta  # via NPM: 302 (naar Authentik); dashboard op het LAN: 404 of een fout van NPM; nooit 200
```

Dashboard via NPM: `https://cssthema.jouwdomein.be/` in de browser stuurt je eerst naar Authentik en toont daarna het dashboard. Dashboard op het LAN: `http://<ip-van-de-container>/` toont op je pc het dashboard.

Bewaking: `https://css.jouwdomein.be/readyz` is zonder login bereikbaar en geeft `200` met `"status":"ok"` als database en Redis werken (anders `503`). Zet die URL in Uptime Kuma (*HTTP(s) - Keyword*, keyword `"status":"ok"`).

### Eén domein voor dashboard en CSS

Gebruik je maar één domein voor allebei, zet dan `DASHBOARD_HOST` op dat domein en `PUBLIC_BASE_URL` op `https://` plus hetzelfde domein. Die proxy host laat dan de publieke bestanden door zonder login, en de rest via Authentik. Bij **Advanced**, vóór het Authentik-blok van hierboven (`location /`, `location /outpost.goauthentik.io` en `location @goauthentik_proxy_signin`):

```nginx
# Thema-CSS, thema-scripts (bv. algemeen.js), lettertypes en /host/...: publiek, want apps
# laden ze ook op hun loginpagina. Alleen lezen (GET/HEAD) en alleen platte namen, /themes/...,
# /host/... (ook /host/*.css, de bundel van hosts zonder eigen koppeling) en /css/....
location ~ "^/(?:themes/|host/|css/)?(?:\*|[A-Za-z0-9][A-Za-z0-9._@-]*)\.(?:css|js|woff2?|ttf|otf)$" {
    limit_except GET HEAD { deny all; }
    proxy_pass $forward_scheme://$server:$port;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 1s;
    proxy_read_timeout 5s;
}

# Gezondheid voor Uptime Kuma of een andere monitor (zonder login, alleen lezen).
location = /readyz {
    limit_except GET HEAD { deny all; }
    proxy_pass $forward_scheme://$server:$port;
    proxy_set_header Host $host;
}
```

Laden je apps bestanden uit een andere submap dan `css/`, zet die dan ook in de regex, of verplaats ze. De korte timeouts zorgen dat een app niet tot 90 s op zijn stylesheet wacht als cssthema hapert. Controle zoals hierboven, met `https://<domein>/api/v1/meta` → `302`.

### Eén regel voor alle hosts

Elke proxy host van een app krijgt dezelfde regel bij **Advanced**. NPM vult `$host` in met de hostnaam van het verzoek, en cssthema levert op `/host/<hostnaam>.css` en `.js` de thema's en scripts die je op de pagina **Hosts** aan die hostnaam koppelt (samengevoegd tot één bestand). De koppeling `*` geldt voor elke host zonder eigen koppeling. De pagina Hosts toont de regel met jouw `PUBLIC_BASE_URL` ingevuld; hier met `https://css.jouwdomein.be`:

```nginx
# cssthema: zelfde regel in elke proxy host
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jouwdomein.be/host/$host.css"><script src="https://css.jouwdomein.be/host/$host.js" defer></script></head>';
sub_filter_once on;
set $ct_ae $http_accept_encoding;
if ($http_accept ~* "text/html") { set $ct_ae ""; }
more_set_input_headers "Accept-Encoding: $ct_ae";
# /cssthema
```

- `sub_filter` werkt alleen op HTML die niet gecomprimeerd is. De laatste drie regels halen `Accept-Encoding` weg bij paginaverzoeken (de browser vraagt `text/html`), zodat de app die pagina ongecomprimeerd stuurt; scripts, CSS en JSON van de app blijven gecomprimeerd. Een `proxy_set_header Accept-Encoding ""` in Advanced werkt in NPM niet: de eigen `location /` van NPM zet zijn eigen `proxy_set_header`-regels, en dan gelden die van de server niet meer. `more_set_input_headers` wel (getest op NPM 2.16). Gevolg: ook NPM zelf comprimeert die HTML-pagina's niet meer, want zijn `gzip` kijkt naar dezelfde header. Dat kost wat bandbreedte bij grote pagina's; scripts, CSS, afbeeldingen en JSON blijven gecomprimeerd.
- De regel heeft geen `location /`, dus de `location /` van NPM blijft, met de Access List en de websockets van die host.
- `# cssthema…` en `# /cssthema` markeren het blok, zodat [`scripts/npm/regel.py`](../../scripts/npm/README.md) het in elke host kan vinden en vervangen.
- Zet de regel in elke proxy host apart, niet in de globale `server_proxy.conf` van NPM: die geldt voor elke host, ook voor de hosts die de regel nooit mogen krijgen.

**Apps met een strenge CSP.** Laadt een app geen CSS van een ander domein (Content-Security-Policy), dan haalt NPM de bestanden via `/alg-thema/` op het domein van de app zelf. Standaard alleen de CSS, zodat bijvoorbeeld een wachtwoordkluis (Vaultwarden) nooit JavaScript van cssthema krijgt:

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
    proxy_pass https://css.jouwdomein.be/;
}
# /cssthema
```

De `location ^~ /alg-thema/` laat alleen lezen door en stuurt de cookies en de login van de app niet mee naar cssthema. Had de host al een `location ^~ /alg-thema/`, vervang die dan door deze: twee keer dezelfde location keurt NPM af.

Blokkeert een app alleen scripts van een ander domein (bv. Portainer, qBittorrent, Pi-hole), dan kan de variant met script. Gebruik ze niet voor een wachtwoordkluis, Authentik of NPM zelf:

> **Let op:** met deze variant draait het script van cssthema op het domein van de app zelf. Het kan dan alles wat jij in die app kan (je sessie, de api van de app). Wie je dashboard kan wijzigen, kan dat dus ook.

```nginx
# cssthema: zelfde regel in elke proxy host (eigen domein, CSS en script)
sub_filter '</head>' '<link rel="stylesheet" href="/alg-thema/host/$host.css"><script src="/alg-thema/host/$host.js" defer></script></head>';
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
    proxy_pass https://css.jouwdomein.be/;
}
# /cssthema
```

**Nooit de regel** in deze hosts:

| Host | Waarom |
|---|---|
| het dashboard (`DASHBOARD_HOST`) | een thema of script zou het dashboard zelf kunnen breken of overnemen |
| het CSS-domein (host van `PUBLIC_BASE_URL`) | serveert alleen de bestanden |
| Authentik en elke beheerpagina van NPM (bij jbogaert.be: `authentik.jbogaert.be`, `nginx.jbogaert.be` en `nginx105.jbogaert.be`) | de login van al je apps en het beheer van alle hosts: zet ze in `EXCLUDED_HOSTS` (§ 2) |
| apps met hun eigen achtergrond (bij jbogaert.be: `allow.jbogaert.be` en `aiverslag.jbogaert.be`) | hun netwerkcanvas botst met dat van `algemeen.js`; krijgen ze de regel toch, zet hun koppeling op **Hosts** dan uit |

cssthema zelf injecteert daar ook niets: voor `DASHBOARD_HOST`, de host van `PUBLIC_BASE_URL` en `EXCLUDED_HOSTS` geven `/host/<host>.css` en `.js` een lege bundel, ook als de regel er per ongeluk staat.

**Uitrollen:**

1. Open **Hosts** en plak bij **Importeren** je regels per host (zoals `themes/hosts-modules.conf` uit de repo, of je oude `npm-sub_filter-per-dienst.conf`): elke `# hostnaam` met de `sub_filter` eronder wordt een koppeling, en `# *` de koppeling voor alle hosts zonder eigen regel. `themes/hosts-modules.conf` zet `*` op de lichte stapel modules met script `algemeen` ([themes/README.md](../../themes/README.md#de-koppeling-)).
2. Zonder zo'n bestand maak je `*` met de hand: thema's `alg-kern`, `alg-fw-bootstrap`, `alg-fw-tabler`, `alg-fw-adminlte`, `alg-fw-material`, `alg-fw-vue`, `alg-fw-overig` en script `algemeen`. Niet het thema `algemeen`: dat maakt grote apps traag.
3. Zet de regel in de proxy hosts:
   - met [`scripts/npm/regel.py`](../../scripts/npm/README.md): eerst een droge run (toont per host wat er verandert), dan één host, dan de rest. Het script bewaart vooraf de Advanced-config van elke host en kan die terugzetten;
   - of met de hand: vervang in één proxy host de oude `sub_filter`, `sub_filter_once` en `proxy_set_header Accept-Encoding ""` door de regel, kijk of de app er goed uitziet, en doe dan de rest. Staat er nog een eigen `location / { … }` (het oude snippet uit *Import* → *Scripts*), haal dat hele blok weg: dan komt de `location /` van NPM terug, met de Access List van die host.

Daarna verander je een thema of de bestanden van een host alleen nog in het dashboard, nooit meer in NPM. De volgorde voor een overstap staat in [uitrol.md](uitrol.md), stap 6.

Een host zonder eigen koppeling krijgt een redirect naar `/host/*.css` (en `.js`): al die hosts delen zo één gecachte bundel, en een wijziging aan `*` is meteen overal zichtbaar.

**Cache.** Browsers krijgen `/host/…` en de thema-CSS met `Cache-Control: public, no-cache, stale-if-error=86400`: bij elke paginalaad vragen ze met de ETag of er iets veranderd is (meestal een `304` zonder inhoud). nginx van cssthema houdt de bundels zelf 60 s vast, ververst ze na elke wijziging in het dashboard, en levert bij uitval van de api nog tot een dag de laatste versie. Een wijziging zie je dus bij de volgende paginalaad, zonder Ctrl+F5. Eén uitzondering: krijgt een host die `*` volgde een eigen koppeling, dan bewaren browsers de redirect naar `*.css` nog tot een minuut (`max-age=60`) en volgen ze hem daarna nog één paginalaad terwijl ze nakijken; daarna laden ze de nieuwe bundel.

**Gezondheid.** De pagina Hosts toont per host:

- *laatst geladen*: wanneer een browser `/host/<host>.css` ophaalde (op ± 1 minuut). Hosts die de regel gebruiken maar geen eigen koppeling hebben, staan apart onder *Geladen zonder eigen koppeling*;
- ontbrekende thema's of scripts in een koppeling;
- het resultaat van de controle: cssthema opent `https://<host>/` en kijkt of de regel in de pagina staat en of de Content-Security-Policy van de app het CSS-domein toelaat. Dat gebeurt elke dag om 06:15 (worker) en met de knop *Alles controleren*. Hosts achter Authentik tonen *achter login*: daar zegt *laatst geladen* meer. De container moet de hostnamen van je apps kunnen opzoeken en bereiken (meestal via NPM).

### Wie mag de api gebruiken

Tot fase 3 heeft cssthema geen eigen login. De bescherming is dus waar het dashboard staat: alleen op het LAN, of achter Authentik in NPM. nginx van cssthema zorgt dat niemand eromheen kan:

- **Alleen op `DASHBOARD_HOST`.** Elke proxy host die niet in `DASHBOARD_HOST` staat (zoals het CSS-domein), krijgt voor het dashboard en `/api/` een `404`. Staat het dashboard op het LAN (`DASHBOARD_HOST` is het IP van de container), dan komt het via geen enkele proxy host van NPM naar buiten: NPM geeft altijd de eigen naam van de proxy host door als `Host`. Schrijf in NPM dan ook nooit zelf een `proxy_pass http://<ip-van-de-container>` zonder `proxy_set_header Host $host;`: zonder die regel stuurt nginx het IP als `Host`, en dat is het dashboard.
- **Alleen van `TRUSTED_PROXIES`.** De hele api, lezen en schrijven, aanvaardt nginx alleen van de adressen in `TRUSTED_PROXIES` en van de container zelf. Van elders geeft dat `403` (*Alleen via de reverse proxy*), ook met een verzonnen `Host`- of `X-Forwarded-For`-header: nginx kijkt naar het adres van de verbinding zelf.

Verder:

- **Dashboard op het LAN:** iedereen in het netwerk uit `TRUSTED_PROXIES` kan zonder login thema's en scripts in al je apps zetten. Zet daar dus alleen het netwerk van je eigen pc (bv. je beheer-VLAN), geen gastnetwerk. Toestellen in dat netwerk kunnen hun IP in het auditlog verzinnen (`X-Forwarded-For`). NPM hoeft er niet in. Staat NPM in een ander netwerk, dan ziet nginx alle CSS-verzoeken als komend van NPM en delen je apps samen één limiet van 50 verzoeken per seconde; voor een thuisnetwerk is dat ruim.
- **Dashboard via NPM:** zet alleen het IP van NPM in `TRUSTED_PROXIES` (§ 2), en niet meer dan dat.
- Wie langs Authentik op het dashboard komt, kan thema's en scripts uitrollen naar al je apps. Beperk de applicatie van het dashboard in Authentik daarom tot jezelf of een admin-groep: *Applications* → de app → *Policy / Group / User Bindings* → bind je admin-groep (zonder binding mag elke Authentik-gebruiker erin). Het CSS-domein heeft geen Authentik nodig.
- Docker: de standaardwaarde `172.16.0.0/12` vertrouwt elk Docker-netwerk op de host. Maak ze krapper, bv. alleen het subnet van het NPM-netwerk (`docker network inspect <netwerk>`).
- Beter nog: laat poort 80 alleen open voor NPM (en, met het dashboard op het LAN, voor het netwerk van je pc), met de firewall van Proxmox. Op de Proxmox-host, in `/etc/pve/firewall/<id>.fw` (`<id>` is het nummer van de container; vervang het IP door dat van NPM):

  ```ini
  [OPTIONS]
  enable: 1
  policy_in: ACCEPT

  [RULES]
  IN ACCEPT -source 192.168.1.10 -p tcp -dport 80 # NPM
  IN DROP -p tcp -dport 80 # de rest
  ```

  Met het dashboard op het LAN zet je vóór de `DROP`-regel nog een regel met het netwerk van je pc, bv. `IN ACCEPT -source 192.168.1.0/24 -p tcp -dport 80 # mijn pc`.

  `policy_in: ACCEPT` laat het andere verkeer (SSH, ping) gewoon door; alleen poort 80 is beperkt, tot NPM (en je pc). Zit je pc in hetzelfde netwerk als de container, dan opent de extra regel poort 80 voor dat hele netwerk: zet dan liever alleen het IP van je pc. Dit werkt alleen als ook de firewall van het datacenter aan staat (*Datacenter* → *Firewall* → *Options* → *Firewall*: *Yes*) en *Firewall* aangevinkt is bij de netwerkkaart van de container (*Network* → `net0`). Zet je de datacenter-firewall voor het eerst aan: Proxmox laat de webinterface (8006) en SSH dan standaard alleen toe vanaf het netwerk van de host zelf. Controle vanaf een toestel dat niet in die regels staat: `curl -m 3 http://<ip-van-de-container>/readyz` loopt in een timeout; via NPM werkt alles.
- Daarnaast weigert de api zelf wijzigingen die van een andere webpagina komen (CSRF), ook van een andere app op hetzelfde domein: alleen het dashboard zelf mag schrijven. curl en scripts op de server zelf werken gewoon.

## 5. Bijwerken

```bash
git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh
```

Configuratie, wachtwoorden, database en CSS-bestanden blijven staan; databasemigraties draaien vanzelf. Voor het script de database, de code-omgeving of nginx aanraakt, maakt het een back-up (`…-voor-update`, met de commit en de databasemigratie die toen draaiden; § 6). Het stopt nog daarvoor als:

- `DASHBOARD_HOST` nergens staat (eerste update naar deze versie): geef het één keer mee, met het IP van de container of de hostnaam in NPM (§ 2), bv. `DASHBOARD_HOST=192.168.1.20 TRUSTED_PROXIES=192.168.1.0/24 bash /opt/cssthema/deploy/debian/install.sh`;
- de database op een migratie staat die de code niet kent (de code is ouder dan de database, bv. na een `git checkout` van een oudere versie). De api blijft draaien; de melding zegt welke versie je moet uitchecken.

Mislukt het bouwen van het dashboard, dan blijft het vorige dashboard draaien. Mislukt de back-up, dan stopt de update vóór de migraties; los de fout op, of sla de back-up bewust over met `SKIP_BACKUP=1` vóór `bash`.

**Naar main overschakelen.** Toont `git -C /opt/cssthema branch --show-current` iets anders dan `main` (bv. `claude/css-theme-builder-design-adj6mk`), dan zegt het script na elke update of je kan overschakelen en hoe. Vanaf een versie van vóór de back-ups (zoals `ab3b5b9`) doe je dat zo, met eerst de versie die nu draait:

```bash
git -C /opt/cssthema rev-parse HEAD > /var/lib/cssthema/geinstalleerde-commit
git -C /opt/cssthema fetch && git -C /opt/cssthema switch main
DASHBOARD_HOST=192.168.1.20 TRUSTED_PROXIES=192.168.1.0/24 bash /opt/cssthema/deploy/debian/install.sh
```

(Via NPM: `DASHBOARD_HOST=cssthema.jouwdomein.be TRUSTED_PROXIES=<ip-van-npm>`, zie § 2.)

Zonder die eerste regel leidt het script de vorige versie af uit `git reflog` (`HEAD@{1}`), en anders noteert het `onbekend`. De volledige overstap staat in [uitrol.md](uitrol.md).

**Terug naar de vorige versie** na een slechte update:

```bash
cssthema-backup lijst                                  # zoek de back-up die eindigt op -voor-update
cssthema-backup terugzetten 20261011-120000-voor-update
```

Dat zet database, CSS-bestanden en storage terug (na nog een back-up van de huidige toestand). Hoort de back-up bij een andere databasemigratie dan de code die er nu staat, dan start het de api niet en toont het het commando om de bijbehorende code terug te zetten: `git -C /opt/cssthema checkout --detach <commit> && bash /opt/cssthema/deploy/debian/install.sh`. Die commit komt dan ook in `/var/lib/cssthema/geinstalleerde-commit`, zodat de volgende back-up weet bij welke code de database hoort (ook als de oudere versie dat bestand zelf niet schrijft). Is de commit `onbekend`, dan start het ook niet: zoek de versie met `git -C /opt/cssthema reflog`. Later weer naar de laatste versie: `git -C /opt/cssthema switch main && git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh`.

## 6. Waar staat wat

| Wat | Waar |
|---|---|
| Code | `/opt/cssthema` |
| Configuratie en geheimen | `/etc/cssthema/cssthema.env` (alleen leesbaar voor root en de dienst) |
| Eigen CSS-bestanden en thema-scripts | `/var/lib/cssthema/css-files/` (vervangen en verwijderde scripts in `.scripts-archief/`, geïmporteerde CSS in `.geimporteerd/`) |
| Uploads, exports en vastgelegde pagina's | `/var/lib/cssthema/storage/` |
| Geïnstalleerde versie en laatste back-up | `/var/lib/cssthema/geinstalleerde-commit`, `/var/lib/cssthema/laatste-backup` |
| Python-venv en Node.js | `/usr/local/lib/cssthema/` |
| nginx-site | `/etc/nginx/sites-available/cssthema` (wordt bij elke run overschreven: pas `docker/nginx/conf.d/cssthema.conf` in de repo aan) |
| Uit `TRUSTED_PROXIES` en `DASHBOARD_HOST` | `/etc/nginx/conf.d/cssthema-real-ip.conf` en `cssthema-dashboard-host.conf` (ook bij elke run opnieuw) |
| Back-ups | `/var/backups/cssthema/` (instelbaar met `BACKUP_DIR`) |

### Back-ups

Elke nacht om ± 03:30 maakt `cssthema-backup.timer` een back-up, en `install.sh` maakt er een vóór elke update. Elke back-up is een map met:

- `database.dump`: de hele database (`pg_dump -Fc`);
- `css-files.tar.gz` (met `.geimporteerd/` en `.scripts-archief/`) en `storage.tar.gz`;
- `cssthema.env`: de configuratie met de geheimen;
- `commit` en `revisie`: de versie van de code en de databasemigratie van dat moment. Terugzetten vergelijkt `revisie` met de code die er nu staat.

Na elke geslaagde back-up staat het tijdstip in `/var/lib/cssthema/laatste-backup`; `cssthema-backup lijst` toont het ook. De laatste 14 back-ups blijven bewaard. In `/etc/cssthema/cssthema.env`:

```bash
BACKUP_DIR=/mnt/backup/cssthema   # liefst een map buiten de container (NFS, SMB, bind mount)
BACKUP_KEEP=30
```

Een bind mount van Proxmox maak je op de Proxmox-host. In een unprivileged container is root daar uid `100000`, dus die moet in de map kunnen schrijven:

```bash
mkdir -p /srv/backup/cssthema && chown 100000:100000 /srv/backup/cssthema
pct set <id> -mp0 /srv/backup/cssthema,mp=/mnt/backup/cssthema   # daarna de container herstarten
```

`cssthema-backup` maakt `BACKUP_DIR` aan als die ontbreekt (modus `0700`), en waarschuwt als een eigen `BACKUP_DIR` op dezelfde schijf staat als de container zelf: dan is de mount er niet en blijft de back-up in de container.

| Wat | Commando |
|---|---|
| Nu een back-up maken | `cssthema-backup` |
| Back-ups bekijken | `cssthema-backup lijst` |
| Terugzetten | `cssthema-backup terugzetten <map>` |
| Wanneer draait de volgende | `systemctl list-timers cssthema-backup.timer` |

Een back-up van de hele container in Proxmox (vzdump) neemt ook alles mee.

## 7. Handige commando's en problemen

| Wat | Commando |
|---|---|
| Status | `systemctl status cssthema-api cssthema-worker nginx` |
| Logs volgen | `journalctl -u cssthema-api -u cssthema-worker -f` |
| Herstarten | `systemctl restart cssthema-api cssthema-worker` |
| Gezondheid | `curl http://127.0.0.1/readyz` |
| De api vanaf de server zelf | `curl -H 'Host: 192.168.1.20' http://127.0.0.1/api/v1/meta` (de waarde uit `DASHBOARD_HOST`: het IP van de container, of `cssthema.jouwdomein.be` via NPM) |

| Symptoom | Oorzaak en oplossing |
|---|---|
| `install.sh` stopt met *DASHBOARD_HOST ontbreekt* | Er is nog niets aangepast. Draai het opnieuw met het adres van je dashboard (§ 2): `DASHBOARD_HOST=192.168.1.20 TRUSTED_PROXIES=192.168.1.0/24 bash /opt/cssthema/deploy/debian/install.sh`. |
| `install.sh` stopt met *de database staat op migratie …, die de code … niet kent* | De code in `/opt/cssthema` is ouder dan de database. Er is niets herstart; de api draait verder. Zet de versie uit de melding terug (of `git -C /opt/cssthema switch main && git -C /opt/cssthema pull`) en draai het script opnieuw. |
| `install.sh` waarschuwt *PUBLIC_BASE_URL=… is geen https* of *een IP-adres* | Dat adres komt in de regel van elke proxy host, en apps op https laden niets van http of van een IP zonder geldig certificaat. Draai het opnieuw met `PUBLIC_BASE_URL=https://css.jouwdomein.be`. |
| `cssthema-backup terugzetten` zegt *Data teruggezet, niet gestart* | De back-up hoort bij een andere versie van de code. Voer het commando uit de melding uit (`git … checkout --detach <commit> && bash …/install.sh`). |
| Het dashboard of `/api/…` geeft `404` (*De api staat alleen op de host(s) uit DASHBOARD_HOST*) | Die hostnaam staat niet in `DASHBOARD_HOST`: `grep DASHBOARD_HOST /etc/cssthema/cssthema.env` en `cat /etc/nginx/conf.d/cssthema-dashboard-host.conf`. Pas aan met `DASHBOARD_HOST=… bash /opt/cssthema/deploy/debian/install.sh`. Op het CSS-domein staat het dashboard bewust niet, en op `http://<ip>/` alleen als dat IP in `DASHBOARD_HOST` staat. |
| De api geeft `403` *Alleen via de reverse proxy* (of *Schrijven kan alleen via de reverse proxy*), of het dashboard toont geen thema's en geen Hosts | Het verzoek kwam niet van een adres in `TRUSTED_PROXIES`: `cat /etc/nginx/conf.d/cssthema-real-ip.conf`. Dashboard op het LAN: zet het netwerk van je pc erin (`ipconfig` op Windows), bv. `TRUSTED_PROXIES=192.168.1.0/24 bash /opt/cssthema/deploy/debian/install.sh`. Via NPM: het IP waarmee NPM aankomt (zie § 4, *Wie mag de api gebruiken*). Het IP van de container zelf helpt niet. |
| Een app krijgt geen thema, en in de paginabron staat geen `/host/…` | `sub_filter` grijpt niet. Staat er nog een oude regel met `proxy_set_header Accept-Encoding ""`? Die werkt in NPM niet bij apps die hun HTML comprimeren: vervang hem door de regel uit § 4. Schrijft de app `</head>` anders (hoofdletters), dan vindt `sub_filter` het ook niet. |
| NPM toont de proxy host als *Offline*, of de nieuwe Advanced-config doet niets | De configtest van NPM faalt: ga met de muis over *Offline* voor de fout. NPM blijft intussen de vorige config gebruiken. Bij `duplicate location "/"` staat er nog iets in de tab *Custom locations*: maak die leeg. Bij `duplicate location "/alg-thema/"` staat de oude `location ^~ /alg-thema/` er nog naast de regel. |
| `/<naam>.js` of `.css` geeft een 404 van een andere nginx dan die van deze container | Het domein komt niet bij cssthema uit. Met `server: openresty` in `curl -sI` stuurt NPM nog naar je oude server (Forward IP, of de host staat *Offline*); met een andere `server:` loopt het domein niet via NPM (DNS, port forward). |
| NPM geeft *502 Bad Gateway* | Controleer IP en poort in NPM, en of `curl http://<ip>/healthz` vanaf de NPM-host werkt. |
| Het script stopt bij *Controle* | Het toont de laatste api-logs. Vaak is PostgreSQL of Redis niet gestart: `systemctl status postgresql redis-server`. |
| Een CSS-bestand geeft 404 | Staat het in `/var/lib/cssthema/css-files/` en klopt de naam exact (hoofdletters tellen)? |
| Een script uploaden geeft *CSS_FILES_DIR is niet schrijfbaar voor de api* | De api draait als `cssthema` en moet in de map kunnen schrijven: draai het script opnieuw (het zet `cssthema:cssthema` en `0775`), of `chown cssthema:cssthema /var/lib/cssthema/css-files`. |
| Een script geeft 403 | Het bestand is niet leesbaar voor nginx (bv. met de hand gezet met modus `0600`): `chmod 0644 /var/lib/cssthema/css-files/<naam>.js`. Via het dashboard geüploade scripts krijgen altijd `0644`. |
| nginx start niet (*Address already in use*) | Er draait al een andere webserver op poort 80, bijvoorbeeld `apache2`: stop en verwijder die, en draai het script opnieuw. |

## Alternatief: Docker

Wie liever Docker gebruikt: `cp .env.example .env`, vul `POSTGRES_PASSWORD`, `SECRET_KEY`, `TRUSTED_PROXIES`, `DASHBOARD_HOST` en `PUBLIC_BASE_URL` in, en start met `make up`. De stack luistert dan op poort 8080 (zie [`docker/compose/`](../../docker/compose/)). Het dashboard staat alleen op `DASHBOARD_HOST` (standaard `localhost`, dus `http://localhost:8080/`), en alleen de adressen in `TRUSTED_PROXIES` mogen de api gebruiken (§ 4, *Wie mag de api gebruiken*); maak de standaardwaarde `172.16.0.0/12` dus krapper als er nog andere containers op de host draaien.

Je handgemaakte CSS-bestanden horen in één map op de host, die compose zowel in de `nginx`- als in de `api`-container op `/var/lib/cssthema/css-files` mount. Standaard is dat `css-files/` in de repo-root; een andere map zet je met een absoluut pad in `CSS_FILES_HOST_DIR` in `.env`. Mount de map niet alleen in `nginx`: dan serveert nginx het bestand, maar ziet de api het niet. Een thema met dezelfde slug staat dan als "live" in cssthema zonder waarschuwing, terwijl bezoekers het bestand krijgen, en importeren kan niet.

```bash
mkdir -p css-files && cp /pad/naar/je/*.css css-files/
sudo chown -R 10001:10001 css-files   # de api (uid 10001) schrijft scripts en archiveert na een import
```

Zonder schrijfrechten voor uid 10001 lukt importeren nog wel, maar meldt cssthema per bestand dat archiveren mislukte; het bestand blijft dan voorgaan op het thema. Scripts uploaden lukt dan niet (*CSS_FILES_DIR is niet schrijfbaar voor de api*).
