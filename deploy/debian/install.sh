#!/usr/bin/env bash
# cssthema installeren of bijwerken op Debian 13 (of 12), zonder Docker:
# nginx + FastAPI in een venv, PostgreSQL en Redis uit Debian, systemd-services.
#
# Eerste keer (als root, in een lege container):
#   apt update && apt install -y git
#   git clone https://github.com/Jonasz1996/cssthema.git /opt/cssthema
#   TRUSTED_PROXIES=<ip-van-npm> PUBLIC_BASE_URL=https://css.jouwdomein.be \
#       bash /opt/cssthema/deploy/debian/install.sh
#
# Bijwerken: git -C /opt/cssthema pull && bash /opt/cssthema/deploy/debian/install.sh
# Vóór elke update maakt het script een back-up (cssthema-backup lijst); terugzetten met
# cssthema-backup terugzetten <map>. Daarnaast draait elke nacht een back-up (systemd-timer).
# Opnieuw draaien is veilig: configuratie, geheimen en data blijven staan. Geef je
# TRUSTED_PROXIES of PUBLIC_BASE_URL opnieuw mee, dan worden die in de configuratie aangepast.
set -euo pipefail

# Meegegeven bij het aanroepen; gaan voor op wat in de configuratie staat.
ARG_TRUSTED_PROXIES=${TRUSTED_PROXIES:-}
ARG_PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}

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

[ "$(id -u)" -eq 0 ] || die "draai dit script als root"
command -v apt-get >/dev/null || die "alleen Debian (of Ubuntu) met apt wordt ondersteund"
[ -f "$APP_DIR/backend/pyproject.toml" ] || die "repo niet gevonden in $APP_DIR"
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
PUBLIC_BASE_URL=http://${ip:-localhost}

# IP('s) van Nginx Proxy Manager, komma-gescheiden. nginx neemt het client-IP uit
# X-Forwarded-For alleen van deze adressen over (rate limit, audit).
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
chown root:cssthema "$ENV_FILE"
chmod 0640 "$ENV_FILE"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

step "PostgreSQL: gebruiker en database"
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
# Altijd UTF8, ook als de cluster iets anders heeft (een LXC zonder locale krijgt SQL_ASCII,
# en dan geeft elke é of ë een fout 500).
create_db() { runuser -u postgres -- createdb -E UTF8 -T template0 --locale=C.UTF-8 --owner="$POSTGRES_USER" "$1"; }
if [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")" != 1 ]; then
    create_db "$POSTGRES_DB"
else
    encoding=$(psql_admin -tAc "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname = '$POSTGRES_DB'")
    if [ "$encoding" != UTF8 ]; then
        echo "De database staat in $encoding; omzetten naar UTF8."
        systemctl stop cssthema-api cssthema-worker 2>/dev/null || true
        stamp=$(date +%Y%m%d%H%M%S)
        install -d -m 0700 "${BACKUP_DIR:-/var/backups/cssthema}"
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
nginx -t -q
systemctl -q enable nginx
systemctl reload-or-restart nginx

step "Back-ups (cssthema-backup, elke nacht)"
sed -e "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/deploy/debian/cssthema-backup.sh" >/usr/local/sbin/cssthema-backup
chmod 0755 /usr/local/sbin/cssthema-backup
install -m 0644 "$APP_DIR/deploy/debian/cssthema-backup.service" "$APP_DIR/deploy/debian/cssthema-backup.timer" \
    /etc/systemd/system/
# Vóór de migraties (die draaien bij het herstarten van de api) een back-up van de huidige
# toestand, behalve bij de eerste installatie.
if [ "$(psql_admin -d "$POSTGRES_DB" -tAc "SELECT to_regclass('public.alembic_version') IS NOT NULL")" = t ]; then
    echo "back-up vóór de update: $(/usr/local/sbin/cssthema-backup maak voor-update)"
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
  Dashboard:        via je domein in NPM (op http://${ip:-<ip>}/ alleen lezen)
  Eigen CSS-files:  $DATA_DIR/css-files/<naam>.css  ->  http://${ip:-<ip>}/<naam>.css
  Thema-scripts:    dashboard > Import > Scripts     ->  http://${ip:-<ip>}/<naam>.js
  Configuratie:     $ENV_FILE
  Back-ups:         ${BACKUP_DIR:-/var/backups/cssthema} (cssthema-backup lijst)
  Logs:             journalctl -u cssthema-api -u cssthema-worker -f
EOF
branch=$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
if [ -n "$branch" ] && [ "$branch" != main ] &&
    git -C "$APP_DIR" cat-file -e origin/main:backend/pyproject.toml 2>/dev/null; then
    echo
    echo "Let op: deze installatie volgt '$branch', maar nieuwe versies verschijnen op main. Overschakelen:"
    echo "  git -C $APP_DIR switch main && bash $APP_DIR/deploy/debian/install.sh"
fi
if [ "$TRUSTED_PROXIES" = 127.0.0.1 ]; then
    echo
    echo "Let op: zet het IP van Nginx Proxy Manager bij TRUSTED_PROXIES in $ENV_FILE en draai dit script opnieuw."
    echo "Tot dan kan je via NPM niets opslaan of uploaden: nginx aanvaardt wijzigingen alleen van TRUSTED_PROXIES."
fi
