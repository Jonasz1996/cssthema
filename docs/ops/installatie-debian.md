# Installatie op Debian (zonder Docker)

cssthema draait als gewone services op één Debian 13-machine: nginx, de api (FastAPI in een Python-venv), een worker, PostgreSQL en Redis. Eén script installeert alles en werkt het later ook bij. Nginx Proxy Manager (NPM) staat op een andere machine en stuurt je CSS-domein naar deze container.

> **Stand van zaken (fase 1).** In het dashboard maak, bewerk en publiceer je thema's, met versies en terugzetten. De CSS-bestanden die je nu met de hand maakt, blijven werken en kan je importeren (§ 3); thema-scripts (`.js`) upload je in het dashboard. De eigen login komt in fase 3. Tot dan heeft het dashboard **geen login**: zet het in NPM achter Authentik (§ 4). De CSS-bestanden zelf blijven publiek, want je apps laden ze ook op hun loginpagina.

## 1. Container (Proxmox)

| Instelling | Waarde |
|---|---|
| Template | `debian-13-standard` |
| Unprivileged | ja |
| CPU / RAM / swap | 2 cores / 2048 MB / 512 MB |
| Disk | 8 GB |
| Netwerk | vast IP of DHCP-reservering, bereikbaar vanaf NPM |

## 2. Installeren

Als root in de container. Vervang het IP door dat van je NPM-host en het domein door je CSS-domein:

```bash
apt update && apt install -y git
git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
TRUSTED_PROXIES=192.168.1.10 PUBLIC_BASE_URL=https://css.jouwdomein.be \
  bash /opt/cssthema/deploy/debian/install.sh
```

Het script ([`deploy/debian/install.sh`](../../deploy/debian/install.sh)):

- installeert nginx, PostgreSQL, Redis (of Valkey) en Python uit Debian;
- maakt `/etc/cssthema/cssthema.env` aan met willekeurige wachtwoorden en sleutels;
- zet de backend in een venv (`/usr/local/lib/cssthema/venv`) en bouwt het dashboard met een eigen Node.js (alleen voor de build, raakt Debian niet);
- installeert de nginx-site en de systemd-services `cssthema-api` en `cssthema-worker`;
- eindigt met een controle: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

De eerste keer duurt het een paar minuten. `TRUSTED_PROXIES` is het adres waarmee NPM bij deze container aankomt (het LAN-IP van de NPM-host); alleen daarvan neemt nginx het echte client-IP uit `X-Forwarded-For` over. Het bepaalt ook wie iets mag wijzigen: zie § 4, *Wie mag schrijven*. Zonder dat IP kan je in het dashboard via NPM niets opslaan of uploaden (403).

## 3. Je bestaande CSS-bestanden

Zet ze in `/var/lib/cssthema/css-files/`:

```bash
scp oude-css-server:/pad/naar/css/*.css root@<ip-van-deze-container>:/var/lib/cssthema/css-files/
```

`/var/lib/cssthema/css-files/proxmox.css` is dan meteen `https://css.jouwdomein.be/proxmox.css`. Een bestand in deze map gaat voor op een thema met dezelfde naam in cssthema.

Om ze in het dashboard te bewerken, importeer je ze: **Import** → **CSS-bestanden op de server**, selecteer de bestanden en klik op **importeren**. Elk bestand wordt een thema met een eerste live versie en verhuist daarna naar `css-files/.geimporteerd/`; dezelfde URL serveert vanaf dan het thema. Vink je **Daarna archiveren** uit, dan blijft het bestand staan en blijft het voorgaan op het thema (het dashboard waarschuwt daar ook voor). Bestandsnamen moeten een geldige slug zijn (kleine letters, cijfers en streepjes): `Home_Assistant.css` hernoem je eerst naar `home-assistant.css` en pas je ook aan in de `sub_filter` van die app.

Wil je liever met `nano` blijven werken, dan kan dat: laat de bestanden gewoon in deze map staan.

### Thema-scripts (`.js`)

Scripts zoals `algemeen.js` (de bewegende netwerkachtergrond) staan in dezelfde map: `/var/lib/cssthema/css-files/algemeen.js` is `https://css.jouwdomein.be/algemeen.js`. Je hoeft ze niet meer met de hand te kopiëren: in het dashboard upload je ze via **Import** → **Scripts**. Daar zie je ook welke scripts er staan, met hun publieke URL, en kan je ze bekijken, downloaden, vervangen en verwijderen.

- De naam wordt de URL: `Algemeen.js` wordt `algemeen`, `Netwerk Achtergrond` wordt `netwerk-achtergrond` (2 tot 64 kleine letters, cijfers en streepjes). `preview-bridge` is gereserveerd voor het dashboard.
- Alleen `.js`-bestanden in UTF-8, hoogstens 512 KB.
- Bestaat de naam al, dan vraagt het dashboard of je wil vervangen. De vorige versie gaat naar `css-files/.scripts-archief/<naam>.<tijdstip>.js`; verwijderen verplaatst het bestand ook daarheen. Die map is nooit publiek.
- Het script is meteen live (nginx serveert het bestand met `Cache-Control: no-cache`); er zijn geen versies of drafts zoals bij thema's.
- Een script kopiëren met `scp` mag nog steeds; zorg dan dat het leesbaar is voor nginx (`chmod 0644`). Het dashboard toont een waarschuwing als dat niet zo is.

In de proxy host van een app laad je het script naast de CSS, bijvoorbeeld:

```nginx
sub_filter '</head>' '<link rel="stylesheet" href="https://css.jouwdomein.be/algemeen.css"><script src="https://css.jouwdomein.be/algemeen.js" defer></script></head>';
```

Het volledige snippet voor *Advanced* (met `Accept-Encoding` en de websocket-regels) kopieer je in het dashboard onder **Import** → **Scripts**. Het is een eigen `location /`, en die vervangt die van NPM: heeft de proxy host van die app een **Access List** (basic auth, allow/deny), dan geldt die er niet meer en staat de app open. Kopieer die regels dan uit `/data/nginx/proxy_host/<id>.conf` (in NPM) in de location.

In NPM moet de `location` voor publieke bestanden op je CSS-domein zowel `.css` als `.js` doorlaten (§ 4).

## 4. Nginx Proxy Manager

Pas de bestaande proxy host van je CSS-domein aan (of maak er een):

| Tab | Veld | Waarde |
|---|---|---|
| Details | Scheme / Forward IP / Port | `http` / IP van deze container / `80` |
| | Cache Assets | **uit** (cssthema regelt zijn eigen cache) |
| | Block Common Exploits, Websockets Support | aan |
| SSL | | zoals je andere hosts (Let's Encrypt, Force SSL) |
| Custom locations | | **leeg**: de Advanced-config hieronder heeft zelf een `location /` |

Bij **Advanced** het volgende. CSS en thema-scripts blijven publiek, de rest (dashboard en api) gaat via Authentik. Vervang het adres van de outpost door het jouwe:

```nginx
# Thema-CSS en thema-scripts (bv. algemeen.js): publiek, want apps laden ze ook op hun loginpagina.
location ~ \.(css|js)$ {
    proxy_pass $forward_scheme://$server:$port;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

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

Authentik moet het domein kennen: gebruik je forward auth per domein (*domain level*), dan is dat al zo; anders maak je in Authentik een applicatie met een *Proxy Provider* (*Forward auth, single application*) voor `https://css.jouwdomein.be` en hang je die aan je outpost.

Controle:

```bash
curl -I https://css.jouwdomein.be/proxmox.css   # 200, content-type: text/css, zonder login
```

`https://css.jouwdomein.be/` in de browser stuurt je eerst naar Authentik en toont daarna het dashboard. De `sub_filter`-regels in je andere proxy hosts hoeven niet te veranderen.

### Wie mag schrijven

Tot fase 3 heeft cssthema geen eigen login: Authentik in NPM is de enige bescherming. Wie poort 80 van deze container rechtstreeks bereikt (een ander toestel op het LAN, een container op hetzelfde Docker-netwerk), komt niet langs Authentik. Daarom aanvaardt nginx van cssthema wijzigingen via de api (opslaan, publiceren, importeren, scripts uploaden of verwijderen) alleen van de adressen in `TRUSTED_PROXIES` en van de container zelf. Van elders geeft dat `403` (*Schrijven kan alleen via de reverse proxy*); lezen blijft mogen, dus `http://<ip>/` toont het dashboard wel, maar zonder dat je iets kan wijzigen. Een verzonnen `X-Forwarded-For` helpt niet: nginx kijkt naar het adres van de verbinding zelf.

- Zet daarom het IP van NPM in `TRUSTED_PROXIES` (§ 2), en niet meer dan dat.
- Docker: de standaardwaarde `172.16.0.0/12` vertrouwt elk Docker-netwerk op de host. Maak ze krapper, bv. alleen het subnet van het NPM-netwerk (`docker network inspect <netwerk>`).
- Beter nog: laat poort 80 alleen open voor NPM, bv. met een firewallregel op de container (nftables) of in Proxmox (*Firewall* van de container).
- Daarnaast weigert de api zelf wijzigingen die van een andere webpagina komen (CSRF), ook van een andere app op hetzelfde domein: alleen het dashboard zelf mag schrijven. curl en scripts op de server zelf werken gewoon.

## 5. Bijwerken

```bash
git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh
```

Configuratie, wachtwoorden, database en CSS-bestanden blijven staan; databasemigraties draaien vanzelf. Wil je `TRUSTED_PROXIES` of `PUBLIC_BASE_URL` veranderen, geef ze dan opnieuw mee vóór `bash` (zoals in § 2), of pas ze aan in `/etc/cssthema/cssthema.env` en draai het script opnieuw.

## 6. Waar staat wat

| Wat | Waar |
|---|---|
| Code | `/opt/cssthema` |
| Configuratie en geheimen | `/etc/cssthema/cssthema.env` (alleen leesbaar voor root en de dienst) |
| Eigen CSS-bestanden en thema-scripts | `/var/lib/cssthema/css-files/` (vervangen en verwijderde scripts in `.scripts-archief/`, geïmporteerde CSS in `.geimporteerd/`) |
| Uploads en exports | `/var/lib/cssthema/storage/` |
| Python-venv en Node.js | `/usr/local/lib/cssthema/` |
| nginx-site | `/etc/nginx/sites-available/cssthema` (wordt bij elke run overschreven: pas `docker/nginx/conf.d/cssthema.conf` in de repo aan) |

Een back-up van de container in Proxmox (vzdump) neemt alles mee. Alleen de database: `runuser -u postgres -- pg_dump cssthema > cssthema.sql`.

## 7. Handige commando's en problemen

| Wat | Commando |
|---|---|
| Status | `systemctl status cssthema-api cssthema-worker nginx` |
| Logs volgen | `journalctl -u cssthema-api -u cssthema-worker -f` |
| Herstarten | `systemctl restart cssthema-api cssthema-worker` |
| Gezondheid | `curl http://127.0.0.1/readyz` |

| Symptoom | Oorzaak en oplossing |
|---|---|
| NPM toont de proxy host als *Offline*, of de nieuwe Advanced-config doet niets | De configtest van NPM faalt: ga met de muis over *Offline* voor de fout. NPM blijft intussen de vorige config gebruiken. Bij `duplicate location "/"` staat er nog iets in de tab *Custom locations*: maak die leeg. |
| `/<naam>.js` of `.css` geeft een 404 van een andere nginx dan die van deze container | Het domein komt niet bij cssthema uit. Met `server: openresty` in `curl -sI` stuurt NPM nog naar je oude server (Forward IP, of de host staat *Offline*); met een andere `server:` loopt het domein niet via NPM (DNS, port forward). |
| NPM geeft *502 Bad Gateway* | Controleer IP en poort in NPM, en of `curl http://<ip>/healthz` vanaf de NPM-host werkt. |
| Het script stopt bij *Controle* | Het toont de laatste api-logs. Vaak is PostgreSQL of Redis niet gestart: `systemctl status postgresql redis-server`. |
| Een CSS-bestand geeft 404 | Staat het in `/var/lib/cssthema/css-files/` en klopt de naam exact (hoofdletters tellen)? |
| Een script uploaden geeft *CSS_FILES_DIR is niet schrijfbaar voor de api* | De api draait als `cssthema` en moet in de map kunnen schrijven: draai het script opnieuw (het zet `cssthema:cssthema` en `0775`), of `chown cssthema:cssthema /var/lib/cssthema/css-files`. |
| Opslaan of uploaden geeft *Schrijven kan alleen via de reverse proxy* (403) | Het verzoek kwam niet van een adres in `TRUSTED_PROXIES`. Open het dashboard via je domein (NPM), en controleer dat het IP waarmee NPM aankomt in `TRUSTED_PROXIES` staat: `cat /etc/nginx/conf.d/cssthema-real-ip.conf` (zie § 4, *Wie mag schrijven*). |
| Een script geeft 403 | Het bestand is niet leesbaar voor nginx (bv. met de hand gezet met modus `0600`): `chmod 0644 /var/lib/cssthema/css-files/<naam>.js`. Via het dashboard geüploade scripts krijgen altijd `0644`. |
| nginx start niet (*Address already in use*) | Er draait al een andere webserver op poort 80, bijvoorbeeld `apache2`: stop en verwijder die, en draai het script opnieuw. |

## Alternatief: Docker

Wie liever Docker gebruikt: `cp .env.example .env`, vul `POSTGRES_PASSWORD`, `SECRET_KEY` en `TRUSTED_PROXIES` in, en start met `make up`. De stack luistert dan op poort 8080 (zie [`docker/compose/`](../../docker/compose/)). Alleen de adressen in `TRUSTED_PROXIES` mogen via de api iets wijzigen (§ 4, *Wie mag schrijven*); maak de standaardwaarde `172.16.0.0/12` dus krapper als er nog andere containers op de host draaien.

Je handgemaakte CSS-bestanden horen in één map op de host, die compose zowel in de `nginx`- als in de `api`-container op `/var/lib/cssthema/css-files` mount. Standaard is dat `css-files/` in de repo-root; een andere map zet je met een absoluut pad in `CSS_FILES_HOST_DIR` in `.env`. Mount de map niet alleen in `nginx`: dan serveert nginx het bestand, maar ziet de api het niet. Een thema met dezelfde slug staat dan als "live" in cssthema zonder waarschuwing, terwijl bezoekers het bestand krijgen, en importeren kan niet.

```bash
mkdir -p css-files && cp /pad/naar/je/*.css css-files/
sudo chown -R 10001:10001 css-files   # de api (uid 10001) schrijft scripts en archiveert na een import
```

Zonder schrijfrechten voor uid 10001 lukt importeren nog wel, maar meldt cssthema per bestand dat archiveren mislukte; het bestand blijft dan voorgaan op het thema. Scripts uploaden lukt dan niet (*CSS_FILES_DIR is niet schrijfbaar voor de api*).
