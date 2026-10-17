# Uitrol: van de oude CSS-server naar cssthema

Eén lijst, in deze volgorde. Doe bij elke stap eerst de **controle** voor je verdergaat; gaat er iets mis, dan staat bij de stap de **weg terug**. De uitleg en alle opties staan in [installatie-debian.md](installatie-debian.md).

Vertrekpunt: `css.jbogaert.be` wijst nog naar de oude CSS-server, de LXC (192.168.10.154) draait commit `ab3b5b9` van de branch `claude/css-theme-builder-design-adj6mk`, en PR #8 en #9 zijn nog niet gemerged.

| | |
|---|---|
| Dashboard (`DASHBOARD_HOST`) | `cssthema.jbogaert.be`, in NPM achter Authentik |
| Publiek CSS-domein (`PUBLIC_BASE_URL`) | `https://css.jbogaert.be`, in NPM zonder login |
| cssthema (LXC) | `192.168.10.154`, poort 80 |
| Krijgen nooit de regel | `cssthema.jbogaert.be`, `css.jbogaert.be`, `authentik.jbogaert.be` en de beheerpagina's van NPM `nginx.jbogaert.be` en `nginx105.jbogaert.be` (die laatste drie in `EXCLUDED_HOSTS`), en `allow.jbogaert.be` en `aiverslag.jbogaert.be` (eigen netwerkachtergrond; krijgen ze de regel toch, zet hun koppeling op *Hosts* uit) |

`<ip-van-npm>` is het LAN-IP waarmee Nginx Proxy Manager bij de LXC aankomt.

## 0. Staat het dashboard nu open?

Open op je gsm via 4G (wifi uit) `https://cssthema.jbogaert.be/api/v1/meta`, of van een machine buiten je netwerk:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://cssthema.jbogaert.be/api/v1/meta
```

- **Controle:** je krijgt de Authentik-login (curl: `302`), een `401` of een `403`. Krijg je JSON (curl: `200`), dan kan iedereen op internet thema's en scripts in al je apps zetten. Zet dan nu het Authentik-blok uit [installatie-debian.md § 4](installatie-debian.md#dashboard-achter-authentik) in de Advanced-config van die proxy host en controleer opnieuw.
- Laat `css.jbogaert.be` naar de oude server wijzen tot stap 5.
- **Weg terug:** niet nodig, je kijkt alleen.

## 1. PR's mergen (GitHub)

1. PR #9: **Create a merge commit** naar zijn basis, `claude/css-theme-builder-design-adj6mk`.
2. PR #8: **Create a merge commit** naar `main`. Nooit *Squash and merge* of *Rebase and merge*: dat geeft tientallen conflicten en een andere geschiedenis dan die op de LXC.
3. *Settings* → *General* → *Default branch*: `main`.
4. Sluit de open Dependabot-PR's. Dependabot maakt voortaan elke maand per ecosysteem één PR met alle kleine updates (grote apart), tegen `main`.

Verwijder de oude branch nog niet: de LXC volgt hem tot stap 2.

- **Controle** (op de LXC; zegt `main bevat alles`):

  ```bash
  git -C /opt/cssthema fetch -q && git -C /opt/cssthema merge-base --is-ancestor \
    origin/claude/css-theme-builder-design-adj6mk origin/main && echo "main bevat alles"
  ```

- **Weg terug:** op de LXC is nog niets veranderd. Een merge maak je ongedaan met *Revert* op de pagina van de PR (GitHub maakt daar een nieuwe PR voor).

## 2. De LXC naar main overzetten (één keer)

Als root op de LXC. Kijk eerst wat er nu ingesteld is:

```bash
grep -E '^(PUBLIC_BASE_URL|TRUSTED_PROXIES|DASHBOARD_HOST)=' /etc/cssthema/cssthema.env
```

`TRUSTED_PROXIES` moet het IP van NPM zijn. `PUBLIC_BASE_URL` wordt `https://css.jbogaert.be`, ook als er nu `http://192.168.10.154` staat: dat adres komt in de regel van elke proxy host. Dan:

```bash
git -C /opt/cssthema rev-parse HEAD > /var/lib/cssthema/geinstalleerde-commit   # ab3b5b9: wat nu draait
git -C /opt/cssthema fetch
git -C /opt/cssthema switch main
DASHBOARD_HOST=cssthema.jbogaert.be PUBLIC_BASE_URL=https://css.jbogaert.be \
  TRUSTED_PROXIES=<ip-van-npm> EXCLUDED_HOSTS=authentik.jbogaert.be,nginx.jbogaert.be,nginx105.jbogaert.be \
  bash /opt/cssthema/deploy/debian/install.sh
```

De eerste regel zorgt dat de back-up vóór de update weet dat hij bij `ab3b5b9` hoort (die versie schreef dat bestand nog niet). Het script maakt die back-up voor het de database, de code-omgeving of nginx aanraakt. Het zet de database om naar UTF8 als dat nodig is (de oude blijft staan als `cssthema_sql_ascii_<tijdstip>`), en stopt zonder iets te veranderen als `DASHBOARD_HOST` ontbreekt.

- **Controle:**

  ```bash
  cssthema-backup lijst      # onderaan: …-voor-update  commit ab3b5b9  migratie 0002
  curl -s http://127.0.0.1/readyz
  # {"status":"ok","checks":{"database":"ok","database_encoding":"ok","redis":"ok"}}
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: css.jbogaert.be' http://127.0.0.1/api/v1/meta   # 404
  curl -s -H 'Host: cssthema.jbogaert.be' http://127.0.0.1/api/v1/meta                               # JSON
  ```

  `https://cssthema.jbogaert.be/` toont na Authentik het dashboard met je thema's.
- **Weg terug:**

  ```bash
  cssthema-backup terugzetten <map-die-eindigt-op-voor-update>
  ```

  Dat zet database, CSS-bestanden en storage terug. Omdat die back-up bij `ab3b5b9` hoort, start het de api niet en toont het het commando om die code terug te zetten: `git -C /opt/cssthema checkout --detach ab3b5b9… && bash /opt/cssthema/deploy/debian/install.sh`.

## 3. De bestanden van de oude server kopiëren

Alles wat je apps nu van `https://css.jbogaert.be` laden, moet ook op de LXC bestaan, submappen inbegrepen (bv. `/css/thebogaertbay-dark.css`). Op de LXC (`rsync` moet ook op de oude server staan):

```bash
apt install -y rsync
rsync -rlt --exclude='.*' root@<oude-css-server>:/pad/naar/css/ /var/lib/cssthema/css-files/
chmod -R u=rwX,go=rX /var/lib/cssthema/css-files/*
```

`-rlt` in plaats van `-a`: zo blijven eigenaar en rechten van `css-files` zelf staan (de api moet erin kunnen schrijven), en `chmod` maakt alles leesbaar voor nginx.

- **Controle:** welke URL's laden je apps? Op de machine van NPM (pas het pad naar zijn `data`-map aan):

  ```bash
  grep -hoE "https://css\.jbogaert\.be/[^\"' )]+" /pad/naar/npm/data/nginx/proxy_host/*.conf \
    | grep -v '\$host' | sort -u > css-urls.txt
  ```

  Kopieer `css-urls.txt` naar de LXC en kijk of elk adres er bestaat (geen uitvoer = alles in orde):

  ```bash
  while read -r url; do
    pad=${url#https://css.jbogaert.be}
    code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: css.jbogaert.be' "http://127.0.0.1$pad")
    [ "$code" = 200 ] || echo "$code $pad"
  done < css-urls.txt
  ```

  Een `404` voor een `.js` in een submap of met hoofdletters: nginx serveert scripts alleen als `/<naam>.js` met kleine letters, cijfers en streepjes. Hernoem het bestand en pas de link in die proxy host aan, of laat die host het script via *Hosts* krijgen (stap 6).
- **Weg terug:** verwijder de gekopieerde bestanden. Niemand ziet ze nog: `css.jbogaert.be` wijst nog naar de oude server.

## 4. Thema's en koppelingen in het dashboard

1. Upload de thema's uit `themes/` zoals [themes/README.md](../../themes/README.md) beschrijft (*Import* → *Uploaden*, een zip van de map mag). Kies bij *Publiceren* **Ja, publiceren**: met *Standaard* wordt een `.css` alleen een draft, en dan zijn de bundels van *Hosts* leeg.
2. Staat een thema ook als bestand in `css-files` (uit stap 3), dan gaat het bestand voor en zie je in het dashboard een waarschuwing. Zet zo'n bestand opzij zodra het thema live is:

   ```bash
   cd /var/lib/cssthema/css-files && mkdir -p .geimporteerd
   for f in /opt/cssthema/themes/*.css /opt/cssthema/themes/*/*.css; do
     n=$(basename "$f"); if [ -f "$n" ]; then mv -v "$n" .geimporteerd/; fi
   done
   ```

3. *Hosts*: maak de koppeling `*` (thema `algemeen`, script `algemeen`), en plak `themes/hosts-modules.conf` bij *Importeren*.

- **Controle:**

  ```bash
  curl -s -H 'Host: css.jbogaert.be' 'http://127.0.0.1/host/*.css' | head -c 300; echo
  curl -sL -H 'Host: css.jbogaert.be' http://127.0.0.1/host/nextcloud.jbogaert.be.css | head -c 300; echo
  ```

  Beide tonen CSS, geen lege bundel. Herhaal ook de controle van stap 3: alles moet nog `200` geven.
- **Weg terug:** koppelingen verwijder je op *Hosts*, thema's archiveer je op *Thema's*, en een opzijgezet bestand zet je terug met `mv .geimporteerd/<naam>.css .`. Nog steeds niets publiek.

## 5. NPM: dashboard en CSS-domein

Bewaar eerst de huidige instellingen van `css.jbogaert.be` (Forward IP en de tekst bij *Advanced*): dat is de weg terug.

1. `cssthema.jbogaert.be`: Forward `http` / `192.168.10.154` / `80`, bij *Advanced* het Authentik-blok uit [installatie-debian.md § 4](installatie-debian.md#dashboard-achter-authentik). Beperk de applicatie in Authentik tot jezelf of je admin-groep.
2. `css.jbogaert.be`: Forward `http` / `192.168.10.154` / `80`, *Cache Assets* uit, *Advanced* leeg, *Custom locations* leeg. nginx van cssthema serveert op deze hostnaam alleen publieke bestanden.

- **Controle** (via 4G of van buiten je netwerk):

  ```bash
  curl -sI 'https://css.jbogaert.be/host/*.css'                                       # 200, content-type: text/css
  curl -s -o /dev/null -w '%{http_code}\n' https://css.jbogaert.be/api/v1/meta       # 404
  curl -s -o /dev/null -w '%{http_code}\n' https://cssthema.jbogaert.be/api/v1/meta  # 302 naar Authentik, nooit 200
  ```

  Herhaal de lus van stap 3 met `https://css.jbogaert.be$pad` in plaats van `http://127.0.0.1$pad` (en zonder `-H 'Host: …'`), en open een paar apps: ze zien eruit als voorheen, want hun oude regels laden dezelfde bestanden.
- **Weg terug:** zet bij `css.jbogaert.be` het Forward IP en de *Advanced*-tekst van de oude server terug.

## 6. De regel in alle proxy hosts

Elke app krijgt dezelfde regel (de hoofdregel uit [installatie-debian.md § 4, *Eén regel voor alle hosts*](installatie-debian.md#eén-regel-voor-alle-hosts)); apps met een strenge CSP de variant voor het eigen domein. Nooit in de hosts uit de tabel bovenaan.

- **Met het script** `scripts/npm/regel.py` (uitleg in [scripts/npm/README.md](../../scripts/npm/README.md)): eerst de droge run, die per host de diff toont; dan één host; dan de rest. Het script bewaart vooraf de Advanced-config van elke host.
- **Met de hand:** vervang in *Advanced* de oude regels `sub_filter`, `sub_filter_once` en `proxy_set_header Accept-Encoding ""` door de regel. Staat er een eigen `location / { … }` (het oude snippet uit *Import* → *Scripts*), haal dat hele blok weg: dan komt de `location /` van NPM terug, met de Access List van die host. Een bestaande `location ^~ /alg-thema/` vervang je door die uit de variant.

- **Controle:** in NPM staat de host *Online* (anders keurde NPM de config af en draait hij nog de vorige). Voor een app zonder Authentik, met compressie zoals een browser:

  ```bash
  curl -sL -H 'Accept: text/html' --compressed https://<host>/ | grep -o 'css\.jbogaert\.be/host/[^"]*'
  ```

  toont `css.jbogaert.be/host/<host>.css` en `.js`. Apps achter Authentik bekijk je in de browser (paginabron) of in stap 7.
- **Weg terug:** met het script zet je de bewaarde Advanced-config terug (zie de README). Met de hand plak je de oude regels terug; bewaar ze daarom eerst. Wil je een app alleen zonder thema, zonder NPM aan te raken: zet zijn koppeling op *Hosts* uit.

## 7. Controle op de pagina Hosts

Klik op *Alles controleren*. Hosts achter Authentik tonen *achter login*: open zo'n app één keer in de browser, dan vult *laatst geladen* zich. Hosts die `*` volgen staan onder *Geladen zonder eigen koppeling*.

- **Controle** (op de LXC; toont alleen hosts met een probleem):

  ```bash
  curl -s -H 'Host: cssthema.jbogaert.be' http://127.0.0.1/api/v1/hosts/health | python3 -c '
  import json, sys
  for h in json.load(sys.stdin)["hosts"]:
      if h["level"] in ("warn", "error"):
          print(h["level"], h["hostname"], (h["check"] or {}).get("detail", ""), h["missing_styles"], h["missing_scripts"])'
  ```

- **Weg terug:** per host de koppeling aanpassen of uitzetten op *Hosts*; dat werkt meteen in de app, zonder NPM.

## 8. Bewaking

In Uptime Kuma een monitor *HTTP(s) - Keyword* op `https://css.jbogaert.be/readyz` met keyword `"status":"ok"`. Die geeft `503` als de database of Redis niet werkt.

Back-ups: elke nacht om ± 03:30, en vóór elke update. Zet ze liefst buiten de container ([installatie-debian.md § 6](installatie-debian.md#back-ups)).

- **Controle:**

  ```bash
  curl -s https://css.jbogaert.be/readyz           # {"status":"ok",…}
  cat /var/lib/cssthema/laatste-backup             # (op de LXC) niet ouder dan een dag
  ```

- **Weg terug:** niet nodig.

## Daarna

- Een week niets gemerkt? Zet de oude CSS-server uit.
- Volgt de LXC `main` (`git -C /opt/cssthema branch --show-current`)? Dan mag de oude branch weg op GitHub.
- De oude database van vóór de UTF8-omzetting: `runuser -u postgres -- psql -l | grep cssthema_` en `runuser -u postgres -- dropdb cssthema_sql_ascii_<tijdstip>`.
- Bijwerken gaat voortaan met `git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh` ([installatie-debian.md § 5](installatie-debian.md#5-bijwerken)).
