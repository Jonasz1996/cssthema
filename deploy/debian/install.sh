#!/usr/bin/env bash
# cssthema installeren of bijwerken op Debian 13 (of 12), zonder Docker:
# nginx + FastAPI in een venv, PostgreSQL en Redis uit Debian, systemd-services.
#
# Eerste keer (als root, in een lege container):
#   apt update && apt install -y git
#   git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
#   DASHBOARD_HOST=cssthema.jouwdomein.be PUBLIC_BASE_URL=https://css.jouwdomein.be \
#       TRUSTED_PROXIES=<ip-van-npm> bash /opt/cssthema/deploy/debian/install.sh
#
# Bijwerken: git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh
# Vóór elke update maakt het script een back-up (cssthema-backup lijst); terugzetten met
# cssthema-backup terugzetten <map>. Daarnaast draait elke nacht een back-up (systemd-timer).
# Opnieuw draaien is veilig: configuratie, geheimen en data blijven staan. Geef je
# DASHBOARD_HOST, EXCLUDED_HOSTS, TRUSTED_PROXIES of PUBLIC_BASE_URL opnieuw mee, dan worden
# die in de configuratie aangepast.
set -euo pipefail

# Meegegeven bij het aanroepen; gaan voor op wat in de configuratie staat. Hostnamen mogen
# met spaties of komma's gescheiden zijn; in de configuratie komen ze komma-gescheiden.
hostlijst() { printf %s "$1" | tr ' ' ',' | tr -s ',' | sed -e 's/^,//' -e 's/,$//'; }
ARG_TRUSTED_PROXIES=${TRUSTED_PROXIES:-}
ARG_PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}
ARG_DASHBOARD_HOST=$(hostlijst "${DASHBOARD_HOST:-}")
ARG_EXCLUDED_HOSTS=$(hostlijst "${EXCLUDED_HOSTS:-}")

APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CONF_DIR=/etc/cssthema
ENV_FILE=$CONF_DIR/cssthema.env
DATA_DIR=/var/lib/cssthema
RUNTIME_DIR=/usr/local/lib/cssthema
VENV=$RUNTIME_DIR/venv
NODE_DIR=$RUNTIME_DIR/node
NODE_MAJOR=22
UV_VERSION="uv==0.8.17"  # dezelfde versie die backend/uv.lock schreef

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf 'cssthema-install: %s\n' "$*" >&2; exit 1; }
trap 'printf "cssthema-install: mislukt (regel %s), zie de melding hierboven\n" "$LINENO" >&2' ERR
# Stopt het script nadat het api en worker stopte (UTF8-omzetting), dan draaien ze weer:
# anders blijven alle thema's en /host-bundels weg tot iemand het merkt.
services_gestopt=0
afsluiten() {
    local status=$?
    if [ "$status" -ne 0 ] && [ "$services_gestopt" = 1 ]; then
        echo "cssthema-install: api en worker weer starten" >&2
        systemctl start cssthema-api cssthema-worker || true
    fi
}
trap afsluiten EXIT

[ "$(id -u)" -eq 0 ] || die "draai dit script als root"
command -v apt-get >/dev/null || die "alleen Debian (of Ubuntu) met apt wordt ondersteund"
[ -f "$APP_DIR/backend/pyproject.toml" ] || die "repo niet gevonden in $APP_DIR"
# Zonder DASHBOARD_HOST serveert nginx het dashboard nergens: stoppen vóór er iets verandert.
if [ -z "$ARG_DASHBOARD_HOST" ] && ! grep -q '^DASHBOARD_HOST=.' "$ENV_FILE" 2>/dev/null; then
    die "DASHBOARD_HOST ontbreekt: de hostnaam waarop je het dashboard opent (in NPM, achter
Authentik). Alleen daar serveert nginx het dashboard en de api; op elke andere host alleen de
publieke CSS en scripts. Er is nog niets aangepast. Draai het script opnieuw met die hostnaam, bv.:
  DASHBOARD_HOST=cssthema.jbogaert.be bash $APP_DIR/deploy/debian/install.sh"
fi
case $ARG_DASHBOARD_HOST,$ARG_EXCLUDED_HOSTS in
    *[!A-Za-z0-9.,-]*) die "DASHBOARD_HOST en EXCLUDED_HOSTS: alleen hostnamen, zonder schema of poort (bv. cssthema.jbogaert.be)" ;;
esac
export DEBIAN_FRONTEND=noninteractive

step "Pakketten installeren (nginx, PostgreSQL, Redis, Python)"
apt_install() { apt-get install -y -qq --no-install-recommends "$@" >/dev/null; }
apt-get update -qq
apt_install ca-certificates curl git xz-utils openssl nginx postgresql python3 python3-venv
if apt-cache show redis-server >/dev/null 2>&1; then
    REDIS_SERVICE=redis-server
else
    REDIS_SERVICE=valkey-server
fi
apt_install "$REDIS_SERVICE"
systemctl -q enable --now postgresql "$REDIS_SERVICE"

step "Gebruiker en mappen"
id cssthema >/dev/null 2>&1 ||
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin cssthema
install -d -m 0755 "$DATA_DIR" "$RUNTIME_DIR"
# Handgemaakte CSS en thema-scripts (bewerkbaar als root, bv. met nano). De api moet erin
# kunnen schrijven: scripts uploaden (altijd modus 0644, zodat nginx als www-data ze kan
# lezen), en na een import of vervangen archiveren naar .geimporteerd/ en .scripts-archief/.
install -d -m 0775 -o cssthema -g cssthema "$DATA_DIR/css-files"
install -d -m 0750 -o cssthema -g cssthema "$DATA_DIR/storage"
install -d -m 0750 -o root -g cssthema "$CONF_DIR"
install -d -m 0700 -o www-data -g www-data /var/cache/nginx/css

step "Configuratie ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    cat >"$ENV_FILE" <<EOF
# cssthema-configuratie. Na een wijziging: bash $APP_DIR/deploy/debian/install.sh
ENVIRONMENT=production
# Publiek CSS-domein (https, geen IP): de basis van de NPM-regel in elke proxy host.
PUBLIC_BASE_URL=http://${ip:-localhost}

# Hostna(a)m(en) van het dashboard (in NPM, achter Authentik), komma-gescheiden. Alleen
# daar serveert nginx het dashboard en de api.
DASHBOARD_HOST=
# Hosts die nooit thema's of scripts krijgen, naast het dashboard en het CSS-domein
# (bv. Authentik en NPM zelf), komma-gescheiden.
EXCLUDED_HOSTS=

# IP('s) van Nginx Proxy Manager, komma-gescheiden. nginx neemt het client-IP uit
# X-Forwarded-For alleen van deze adressen over (rate limit, audit), en alleen zij mogen
# de api gebruiken.
TRUSTED_PROXIES=127.0.0.1

POSTGRES_HOST=localhost
POSTGRES_USER=cssthema
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=cssthema
REDIS_URL=redis://localhost:6379/0

SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=

LOG_LEVEL=INFO
LOG_JSON=true
EOF
    echo "aangemaakt met nieuwe geheimen"
else
    echo "bestaat al, blijft staan"
fi
set_conf() { # set_conf NAAM WAARDE: regel in de configuratie vervangen of toevoegen
    case $2 in *[!A-Za-z0-9.:/,_-]*) die "ongeldige waarde voor $1: '$2'" ;; esac
    if grep -q "^$1=" "$ENV_FILE"; then
        sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
    else
        printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
    fi
    echo "$1=$2"
}
[ -z "$ARG_TRUSTED_PROXIES" ] || set_conf TRUSTED_PROXIES "$ARG_TRUSTED_PROXIES"
[ -z "$ARG_PUBLIC_BASE_URL" ] || set_conf PUBLIC_BASE_URL "$ARG_PUBLIC_BASE_URL"
[ -z "$ARG_DASHBOARD_HOST" ] || set_conf DASHBOARD_HOST "$ARG_DASHBOARD_HOST"
[ -z "$ARG_EXCLUDED_HOSTS" ] || set_conf EXCLUDED_HOSTS "$ARG_EXCLUDED_HOSTS"
chown root:cssthema "$ENV_FILE"
chmod 0640 "$ENV_FILE"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

step "PostgreSQL: gebruiker"
psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_USER'")" != 1 ]; then
    psql_admin -v user="$POSTGRES_USER" -v pw="$POSTGRES_PASSWORD" <<'SQL'
CREATE ROLE :"user" LOGIN PASSWORD :'pw';
SQL
else
    # Wachtwoord gelijk houden met de .env, ook als het daar is aangepast.
    psql_admin -v user="$POSTGRES_USER" -v pw="$POSTGRES_PASSWORD" <<'SQL'
ALTER ROLE :"user" WITH LOGIN PASSWORD :'pw';
SQL
fi
bestaande_db=0
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")" = 1 ] &&
    [ "$(psql_admin -d "$POSTGRES_DB" -tAc "SELECT to_regclass('public.alembic_version') IS NOT NULL")" = t ]; then
    bestaande_db=1
fi

if [ "$bestaande_db" = 1 ]; then
    step "Databaseschema en code"
    # Kent deze code de migratie van de database niet, dan is de code ouder dan wat er
    # draaide (bv. na `git switch` naar een oudere branch): de api zou niet meer starten.
    # Stoppen vóór er iets herstart of gemigreerd wordt.
    db_revisie=$(psql_admin -d "$POSTGRES_DB" -tAc "SELECT version_num FROM alembic_version")
    code_revisies=$(sed -n 's/^revision[^=]*= *"\([^"]*\)".*/\1/p' "$APP_DIR"/backend/migrations/versions/*.py)
    case $'\n'"$code_revisies"$'\n' in
        *$'\n'"$db_revisie"$'\n'*) ;;
        *)
            vorige=$(cat "$DATA_DIR/geinstalleerde-commit" 2>/dev/null || true)
            case $vorige in
                "" | onbekend) vorige="<commit>" zoek="
(De vorige versies staan in: git -C $APP_DIR reflog)" ;;
                *) zoek="" ;;
            esac
            die "de database staat op migratie $db_revisie, die de code in $APP_DIR niet kent
($(git -C "$APP_DIR" log -1 --format='%h %s' 2>/dev/null || echo 'onbekende commit')): die code is ouder dan de database.
Er is niets herstart of gemigreerd; cssthema draait verder zoals het was. Zet de code terug op de
versie die draaide en draai daarmee het script opnieuw:
  git -C $APP_DIR checkout --detach $vorige && bash $APP_DIR/deploy/debian/install.sh$zoek"
            ;;
    esac
    echo "database op migratie $db_revisie, die deze code kent"
fi

step "Back-ups (cssthema-backup, elke nacht)"
sed -e "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/deploy/debian/cssthema-backup.sh" >/usr/local/sbin/cssthema-backup
chmod 0755 /usr/local/sbin/cssthema-backup
install -m 0644 "$APP_DIR/deploy/debian/cssthema-backup.service" "$APP_DIR/deploy/debian/cssthema-backup.timer" \
    /etc/systemd/system/
# Vóór de update (venv, dashboard, nginx, UTF8-omzetting en migraties) een back-up van de
# huidige toestand, behalve bij de eerste installatie.
if [ "$bestaande_db" = 1 ]; then
    # De back-up noteert welke code draaide (geinstalleerde-commit, aan het einde van elke
    # geslaagde run geschreven). Oudere versies schreven dat niet: dan de commit van vóór de
    # laatste `git pull` of `git switch`, en anders "onbekend" (terugzetten start dan niet).
    if [ ! -s "$DATA_DIR/geinstalleerde-commit" ]; then
        vorige=$(git -C "$APP_DIR" rev-parse -q --verify 'HEAD@{1}' 2>/dev/null || echo onbekend)
        echo "$vorige" >"$DATA_DIR/geinstalleerde-commit"
        echo "geen $DATA_DIR/geinstalleerde-commit; aangenomen dat $vorige draaide (HEAD@{1})"
    fi
    # Apart toewijzen: in een argument breekt een mislukte $(...) `set -e` niet af.
    if ! backup_dir=$(/usr/local/sbin/cssthema-backup maak voor-update); then
        echo "De back-up vóór de update is mislukt; de update stopt (er is nog niets gemigreerd)." >&2
        echo "Los de fout hierboven op, of sla de back-up bewust over met SKIP_BACKUP=1." >&2
        [ "${SKIP_BACKUP:-0}" = 1 ] || exit 1
    else
        echo "back-up vóór de update: $backup_dir"
    fi
fi

step "Backend: Python-venv in $VENV"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --disable-pip-version-check "$UV_VERSION"
(
    cd "$APP_DIR/backend"
    UV_PROJECT_ENVIRONMENT=$VENV UV_PYTHON_DOWNLOADS=never \
        "$VENV/bin/uv" sync --frozen --no-dev --inexact --python "$VENV/bin/python"
)

step "Frontend bouwen (Node.js $NODE_MAJOR, alleen voor de build)"
if [ "$("$NODE_DIR/bin/node" --version 2>/dev/null | cut -d. -f1)" != "v$NODE_MAJOR" ]; then
    case "$(uname -m)" in
        x86_64) node_arch=x64 ;;
        aarch64) node_arch=arm64 ;;
        *) die "geen Node.js-build voor $(uname -m)" ;;
    esac
    base=https://nodejs.org/dist/latest-v$NODE_MAJOR.x
    line=$(curl -fsSL "$base/SHASUMS256.txt" | grep " node-v.*-linux-$node_arch.tar.xz\$")
    tarball=${line##* }
    tmp=$(mktemp -d)
    curl -fsSL "$base/$tarball" -o "$tmp/$tarball"
    (cd "$tmp" && echo "$line" | sha256sum -c --quiet -)
    rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
    tar -xJf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1 --no-same-owner
    rm -rf "$tmp"
fi
# Het archief is van uid 1000; root draait deze binaries, dus root moet eigenaar zijn.
chown -R root:root "$NODE_DIR"
(
    cd "$APP_DIR/frontend"
    export PATH=$NODE_DIR/bin:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    corepack pnpm install --frozen-lockfile
    # In een aparte map bouwen en pas daarna omwisselen: een mislukte build laat het
    # draaiende dashboard staan (vite maakt de uitvoermap eerst leeg).
    rm -rf dist.nieuw
    log=$(mktemp)
    { corepack pnpm exec tsc -b && corepack pnpm exec vite build --outDir dist.nieuw --emptyOutDir; } >"$log" 2>&1 ||
        { cat "$log" >&2; rm -f "$log"; rm -rf dist.nieuw; die "dashboard bouwen mislukt; het vorige dashboard blijft draaien"; }
    rm -f "$log"
    rm -rf dist.oud
    if [ -d dist ]; then mv dist dist.oud; fi
    mv dist.nieuw dist
    rm -rf dist.oud
)

step "nginx"
site_src=$APP_DIR/docker/nginx/conf.d/cssthema.conf
for pattern in 'server api:8000 resolve;' 'root /usr/share/nginx/html;' \
    'include /etc/nginx/snippets/' 'listen 8081;'; do
    grep -qF "$pattern" "$site_src" || die "nginx-config veranderd: '$pattern' niet gevonden in $site_src"
done
install -d /etc/nginx/snippets/cssthema
install -m 0644 "$APP_DIR"/docker/nginx/snippets/*.conf /etc/nginx/snippets/cssthema/
sed -e 's|server api:8000 resolve;|server 127.0.0.1:8000;|' \
    -e "s|root /usr/share/nginx/html;|root $APP_DIR/frontend/dist;|" \
    -e 's|include /etc/nginx/snippets/|include /etc/nginx/snippets/cssthema/|' \
    -e 's|listen 8081;|listen 127.0.0.1:8081;|' \
    "$site_src" >/etc/nginx/sites-available/cssthema
ln -sf /etc/nginx/sites-available/cssthema /etc/nginx/sites-enabled/cssthema
rm -f /etc/nginx/sites-enabled/default
TRUSTED_PROXIES=$TRUSTED_PROXIES CSSTHEMA_REAL_IP_CONF=/etc/nginx/conf.d/cssthema-real-ip.conf \
    sh "$APP_DIR/docker/nginx/entrypoint/40-cssthema-real-ip.sh"
DASHBOARD_HOST=$DASHBOARD_HOST CSSTHEMA_DASHBOARD_HOST_CONF=/etc/nginx/conf.d/cssthema-dashboard-host.conf \
    sh "$APP_DIR/docker/nginx/entrypoint/41-cssthema-dashboard-host.sh"
nginx -t -q
systemctl -q enable nginx
systemctl reload-or-restart nginx

step "PostgreSQL: database (UTF8)"
# Altijd UTF8, ook als de cluster iets anders heeft (een LXC zonder locale krijgt SQL_ASCII,
# en dan geeft elke é of ë een fout 500).
create_db() { runuser -u postgres -- createdb -E UTF8 -T template0 --locale=C.UTF-8 --owner="$POSTGRES_USER" "$1"; }
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")" != 1 ]; then
    create_db "$POSTGRES_DB"
else
    encoding=$(psql_admin -tAc "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = '$POSTGRES_DB'")
    if [ "$encoding" != UTF8 ]; then
        echo "De database staat in $encoding; omzetten naar UTF8."
        services_gestopt=1
        systemctl stop cssthema-api cssthema-worker 2>/dev/null || true
        stamp=$(date +%Y%m%d%H%M%S)
        [ -d "${BACKUP_DIR:-/var/backups/cssthema}" ] || install -d -m 0700 "${BACKUP_DIR:-/var/backups/cssthema}"
        dump=${BACKUP_DIR:-/var/backups/cssthema}/voor-utf8-$stamp.dump
        runuser -u postgres -- pg_dump -Fc "$POSTGRES_DB" >"$dump"
        new_db=${POSTGRES_DB}_utf8_$stamp
        create_db "$new_db"
        if ! runuser -u postgres -- pg_restore --no-owner --role="$POSTGRES_USER" -d "$new_db" <"$dump"; then
            runuser -u postgres -- dropdb "$new_db"
            die "omzetten naar UTF8 mislukt; de database is niet aangepast (dump: $dump)"
        fi
        old_db=${POSTGRES_DB}_$(echo "$encoding" | tr '[:upper:]' '[:lower:]')_$stamp
        psql_admin -v old="$POSTGRES_DB" -v bak="$old_db" -v new="$new_db" <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'old' AND pid <> pg_backend_pid();
ALTER DATABASE :"old" RENAME TO :"bak";
ALTER DATABASE :"new" RENAME TO :"old";
SQL
        echo "Omgezet. De oude database staat nog als $old_db (weg: runuser -u postgres -- dropdb $old_db)."
    fi
fi

step "Services (systemd)"
for unit in cssthema-api cssthema-worker; do
    sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@VENV@|$VENV|g" \
        "$APP_DIR/deploy/debian/$unit.service" >"/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl -q enable cssthema-api cssthema-worker
systemctl -q enable --now cssthema-backup.timer
systemctl restart cssthema-api cssthema-worker
services_gestopt=0

step "Controle"
for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1/readyz >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
if ! ready=$(curl -fsS http://127.0.0.1/readyz); then
    journalctl -u cssthema-api -n 30 --no-pager >&2 || true
    die "cssthema reageert niet op /readyz; zie de logs hierboven"
fi
echo "$ready"
# Welke code nu draait: de back-ups noteren dit, zodat terugzetten de juiste versie noemt.
git -C "$APP_DIR" rev-parse HEAD >"$DATA_DIR/geinstalleerde-commit" 2>/dev/null || true

ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
cat <<EOF

cssthema draait.
  Dashboard:        https://${DASHBOARD_HOST%%,*}/ via NPM (achter Authentik; niet op http://${ip:-<ip>}/)
  Eigen CSS-files:  $DATA_DIR/css-files/<naam>.css  ->  http://${ip:-<ip>}/<naam>.css
  Thema-scripts:    dashboard > Import > Scripts     ->  http://${ip:-<ip>}/<naam>.js
  Configuratie:     $ENV_FILE
  Back-ups:         ${BACKUP_DIR:-/var/backups/cssthema} (cssthema-backup lijst)
  Logs:             journalctl -u cssthema-api -u cssthema-worker -f
EOF
branch=$(git -C "$APP_DIR" branch --show-current 2>/dev/null || true)
if [ -n "$branch" ] && [ "$branch" != main ] &&
    git -C "$APP_DIR" cat-file -e origin/main:backend/pyproject.toml 2>/dev/null; then
    echo
    # Alleen als main alles van deze branch bevat: anders is overschakelen een stap terug.
    if git -C "$APP_DIR" merge-base --is-ancestor HEAD origin/main; then
        echo "Let op: deze installatie volgt '$branch', maar nieuwe versies verschijnen op main. Overschakelen:"
        echo "  git -C $APP_DIR switch main && git -C $APP_DIR pull --ff-only && bash $APP_DIR/deploy/debian/install.sh"
    else
        echo "Let op: deze installatie volgt '$branch', met commits die (nog) niet op main staan. Blijf"
        echo "op deze branch tot ze op main staan; dit script zegt dan hoe je overschakelt."
    fi
fi
if [ "$TRUSTED_PROXIES" = 127.0.0.1 ]; then
    echo
    echo "Let op: zet het IP van Nginx Proxy Manager bij TRUSTED_PROXIES in $ENV_FILE en draai dit script opnieuw."
    echo "Tot dan geeft de api via NPM 403: nginx laat /api/ alleen toe van TRUSTED_PROXIES."
fi
# PUBLIC_BASE_URL komt in de NPM-regel van elke proxy host: http of een IP werkt daar niet.
base_host=${PUBLIC_BASE_URL#*://}
base_host=${base_host%%/*}
slecht_adres=""
case $PUBLIC_BASE_URL in
    https://*) ;;
    *) slecht_adres="geen https: apps op https blokkeren CSS en scripts van http (mixed content)" ;;
esac
case ${base_host%:*} in
    # Een IPv4-adres eindigt op een cijfer (een domein nooit), een IPv6-adres staat tussen [ ].
    \[* | *[0-9]) slecht_adres="${slecht_adres:+$slecht_adres; }een IP-adres: geen geldig certificaat, en de CSP van apps noemt domeinen" ;;
esac
if [ -n "$slecht_adres" ]; then
    printf '\n\033[1;33mLet op: PUBLIC_BASE_URL=%s is %s.\033[0m\n' "$PUBLIC_BASE_URL" "$slecht_adres"
    echo "Dat adres komt in de NPM-regel van elke proxy host. Zet je publieke CSS-domein (in NPM zonder"
    echo "login) en draai dit script opnieuw, bv.:"
    echo "  PUBLIC_BASE_URL=https://css.jbogaert.be bash $APP_DIR/deploy/debian/install.sh"
fi
