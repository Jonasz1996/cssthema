# Installatie op Debian (zonder Docker)

cssthema draait als gewone services op één Debian 13-machine: nginx, de api (FastAPI in een Python-venv), een worker, PostgreSQL en Redis. Eén script installeert alles en werkt het later ook bij. Nginx Proxy Manager (NPM) staat op een andere machine en stuurt je CSS-domein naar deze container.

> **Stand van zaken (fase 1).** In het dashboard maak, bewerk en publiceer je thema's, met versies en terugzetten. De CSS-bestanden die je nu met de hand maakt, blijven werken en kan je importeren (§ 3). De eigen login komt in fase 3. Tot dan heeft het dashboard **geen login**: zet het in NPM achter Authentik (§ 4). De CSS-bestanden zelf blijven publiek, want je apps laden ze ook op hun loginpagina.

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

De eerste keer duurt het een paar minuten. `TRUSTED_PROXIES` is het adres waarmee NPM bij deze container aankomt (het LAN-IP van de NPM-host); alleen daarvan neemt nginx het echte client-IP uit `X-Forwarded-For` over.

## 3. Je bestaande CSS-bestanden

Zet ze in `/var/lib/cssthema/css-files/`:

```bash
scp oude-css-server:/pad/naar/css/*.css root@<ip-van-deze-container>:/var/lib/cssthema/css-files/
```

`/var/lib/cssthema/css-files/proxmox.css` is dan meteen `https://css.jouwdomein.be/proxmox.css`. Een bestand in deze map gaat voor op een thema met dezelfde naam in cssthema.

Om ze in het dashboard te bewerken, importeer je ze: **Import** → **CSS-bestanden op de server**, selecteer de bestanden en klik op **importeren**. Elk bestand wordt een thema met een eerste live versie en verhuist daarna naar `css-files/.geimporteerd/`; dezelfde URL serveert vanaf dan het thema. Vink je **Daarna archiveren** uit, dan blijft het bestand staan en blijft het voorgaan op het thema (het dashboard waarschuwt daar ook voor). Bestandsnamen moeten een geldige slug zijn (kleine letters, cijfers en streepjes): `Home_Assistant.css` hernoem je eerst naar `home-assistant.css` en pas je ook aan in de `sub_filter` van die app.

Wil je liever met `nano` blijven werken, dan kan dat: laat de bestanden gewoon in deze map staan.

Thema-scripts horen in dezelfde map: `/var/lib/cssthema/css-files/algemeen.js` is `https://css.jouwdomein.be/algemeen.js` (alleen platte namen met kleine letters, cijfers en streepjes).

## 4. Nginx Proxy Manager

Pas de bestaande proxy host van je CSS-domein aan (of maak er een):

| Tab | Veld | Waarde |
|---|---|---|
| Details | Scheme / Forward IP / Port | `http` / IP van deze container / `80` |
| | Cache Assets | **uit** (cssthema regelt zijn eigen cache) |
| | Block Common Exploits, Websockets Support | aan |
| SSL | | zoals je andere hosts (Let's Encrypt, Force SSL) |

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
| Eigen CSS-bestanden | `/var/lib/cssthema/css-files/` |
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
| NPM geeft *502 Bad Gateway* | Controleer IP en poort in NPM, en of `curl http://<ip>/healthz` vanaf de NPM-host werkt. |
| Het script stopt bij *Controle* | Het toont de laatste api-logs. Vaak is PostgreSQL of Redis niet gestart: `systemctl status postgresql redis-server`. |
| Een CSS-bestand geeft 404 | Staat het in `/var/lib/cssthema/css-files/` en klopt de naam exact (hoofdletters tellen)? |
| nginx start niet (*Address already in use*) | Er draait al een andere webserver op poort 80, bijvoorbeeld `apache2`: stop en verwijder die, en draai het script opnieuw. |

## Alternatief: Docker

Wie liever Docker gebruikt: `cp .env.example .env`, vul `POSTGRES_PASSWORD`, `SECRET_KEY` en `TRUSTED_PROXIES` in, en start met `make up`. De stack luistert dan op poort 8080 (zie [`docker/compose/`](../../docker/compose/)).

Je handgemaakte CSS-bestanden horen in één map op de host, die compose zowel in de `nginx`- als in de `api`-container op `/var/lib/cssthema/css-files` mount. Standaard is dat `css-files/` in de repo-root; een andere map zet je met een absoluut pad in `CSS_FILES_HOST_DIR` in `.env`. Mount de map niet alleen in `nginx`: dan serveert nginx het bestand, maar ziet de api het niet. Een thema met dezelfde slug staat dan als "live" in cssthema zonder waarschuwing, terwijl bezoekers het bestand krijgen, en importeren kan niet.

```bash
mkdir -p css-files && cp /pad/naar/je/*.css css-files/
sudo chown -R 10001:10001 css-files   # de api (uid 10001) archiveert na een import naar .geimporteerd/
```

Zonder schrijfrechten voor uid 10001 lukt importeren nog wel, maar meldt cssthema per bestand dat archiveren mislukte; het bestand blijft dan voorgaan op het thema.
