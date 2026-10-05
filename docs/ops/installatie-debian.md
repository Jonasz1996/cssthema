# Installatie op een lege Debian-container

Deze handleiding zet cssthema op een verse Debian 13 (trixie): een LXC-container op Proxmox VE, of een VM. Alle commando's draai je als `root` in de container.

> **Stand van zaken (fase 0).** Je krijgt de draaiende stack: dashboard, api, worker, PostgreSQL en Redis. Thema's maken en publiceren komt in fase 1, inloggen via Authentik in fase 3. Tot dan heeft cssthema **geen login**. Zet het dus niet open naar internet; laat NPM het alleen binnen je LAN aanbieden (of met een Access List).

## 1. Container aanmaken (Proxmox)

| Instelling | Waarde |
|---|---|
| Template | `debian-13-standard` (via *local* → *CT Templates* → *Templates*) |
| Unprivileged | ja |
| CPU | 2 cores |
| RAM / swap | 4096 MB / 1024 MB (het bouwen van de images heeft het meeste nodig) |
| Disk | 20 GB |
| Netwerk | vast IP-adres of een DHCP-reservering, NPM moet het kunnen bereiken |

Docker in een LXC heeft twee *features* nodig. Zet ze aan vóór je de container start: *Options* → *Features* → **nesting** en **keyctl** aanvinken. Of op de Proxmox-host:

```bash
pct set <CTID> --features nesting=1,keyctl=1
```

Start de container en log in als root (console of SSH).

## 2. Docker installeren

De officiële Docker-pakketten, niet `docker.io` uit Debian (die is te oud voor de compose-plugin die we gebruiken):

```bash
apt update && apt upgrade -y
apt install -y ca-certificates curl git make

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Controleer:

```bash
docker run --rm hello-world
docker compose version
```

## 3. cssthema ophalen

```bash
git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
cd /opt/cssthema
```

## 4. Configureren

Maak `.env` aan en vul de geheimen met willekeurige waarden. Vervang `cssthema.jouwdomein.be` door het domein dat je in NPM gaat gebruiken.

```bash
cp .env.example .env
sed -i \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
  -e "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 32)|" \
  -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://cssthema.jouwdomein.be|" \
  .env
chmod 600 .env
```

Zet daarna in `.env` het IP-adres van je Nginx Proxy Manager bij `TRUSTED_PROXIES` (zie [§ 6](#6-nginx-proxy-manager-koppelen)), bijvoorbeeld:

```bash
sed -i "s|^TRUSTED_PROXIES=.*|TRUSTED_PROXIES=172.16.0.0/12,192.168.1.10|" .env
```

De overige waarden in `.env` mogen blijven staan. `POSTGRES_PASSWORD` geldt alleen bij de eerste start: daarna staat het in de database, en een nieuw wachtwoord in `.env` werkt dan niet meer.

## 5. Starten

```bash
make up
```

Dat bouwt de images en start de vijf containers. De eerste keer duurt het een aantal minuten (Node- en Python-afhankelijkheden downloaden). Daarna:

```bash
docker compose -f docker/compose/docker-compose.yml --env-file .env ps   # alles "healthy"
curl -fsS http://localhost:8080/readyz
# {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

Open `http://<IP-van-de-container>:8080` in je browser: je ziet het dashboard met *System status* op groen.

## 6. Nginx Proxy Manager koppelen

In NPM: *Hosts* → *Proxy Hosts* → *Add Proxy Host*:

| Tab | Veld | Waarde |
|---|---|---|
| Details | Domain Names | `cssthema.jouwdomein.be` |
| | Scheme | `http` |
| | Forward Hostname / IP | IP van de cssthema-container |
| | Forward Port | `8080` |
| | Cache Assets | **uit** (cssthema regelt zijn eigen cache) |
| | Block Common Exploits | aan |
| | Websockets Support | aan |
| SSL | SSL Certificate | *Request a new SSL Certificate* (Let's Encrypt) |
| | Force SSL, HTTP/2 Support | aan |

Zolang er geen login is (tot fase 3): kies bij *Access List* een lijst die alleen je LAN toelaat.

**TRUSTED_PROXIES.** cssthema neemt het client-IP uit `X-Forwarded-For` alleen over van adressen in `TRUSTED_PROXIES`. Dat moet het adres zijn waarmee NPM bij cssthema aankomt:

- NPM in een andere LXC of VM: het LAN-IP van die container (`hostname -I` daar).
- NPM in Docker op dezelfde machine als cssthema: de standaardwaarde `172.16.0.0/12` volstaat.

Na een wijziging: `make up`.

## 7. Bijwerken

```bash
cd /opt/cssthema
git pull
make up
```

Migraties draaien automatisch bij het starten van de api. Je data staat in Docker-volumes (`cssthema_pgdata`, `cssthema_storage`) en blijft bewaard.

## 8. Handige commando's

| Wat | Commando |
|---|---|
| Logs volgen | `make logs` |
| Stoppen | `make down` |
| Status | `docker compose -f docker/compose/docker-compose.yml --env-file .env ps` |
| Logs van één service | `docker compose -f docker/compose/docker-compose.yml --env-file .env logs -f api` |

## 9. Problemen

| Symptoom | Oorzaak en oplossing |
|---|---|
| `docker run` geeft *permission denied* of een fout over `sysctl` | De LXC-features ontbreken: zet **nesting** en **keyctl** aan (§ 1) en herstart de container. |
| Bouwen stopt met *Killed* of *exit code 137* | Te weinig geheugen: geef de container meer RAM of swap. |
| Poort 8080 is al bezet | Zet `HTTP_PORT` in `.env` op een andere poort en gebruik die in NPM. |
| NPM geeft *502 Bad Gateway* | Controleer IP en poort in NPM, en of `curl http://<IP>:8080/healthz` vanaf de NPM-machine werkt. |
| `/readyz` geeft `"database":"error"` | Kijk in `make logs` naar de `postgres`- en `api`-regels. |
