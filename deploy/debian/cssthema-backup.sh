#!/usr/bin/env bash
# cssthema-backup: back-ups van de installatie zonder Docker (deploy/debian/install.sh
# installeert dit als /usr/local/sbin/cssthema-backup, met een dagelijkse systemd-timer).
#
#   cssthema-backup [maak] [label]     database, css-files, storage, configuratie en commit
#   cssthema-backup lijst              bestaande back-ups, nieuwste onderaan
#   cssthema-backup terugzetten <map>  een back-up terugzetten (vraagt eerst bevestiging)
#
# Instellingen in /etc/cssthema/cssthema.env:
#   BACKUP_DIR=/var/backups/cssthema   zet dit op een gedeelde map (NFS, SMB, bind mount van
#                                      Proxmox) voor een kopie buiten de container
#   BACKUP_KEEP=14                     zoveel back-ups blijven bewaard, de oudste gaan weg
set -euo pipefail

ENV_FILE=/etc/cssthema/cssthema.env
APP_DIR=@APP_DIR@
DATA_DIR=/var/lib/cssthema

die() { printf 'cssthema-backup: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "draai dit als root"
[ -r "$ENV_FILE" ] || die "$ENV_FILE niet gevonden"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
BACKUP_DIR=${BACKUP_DIR:-/var/backups/cssthema}
BACKUP_KEEP=${BACKUP_KEEP:-14}
case $BACKUP_KEEP in '' | *[!0-9]*) die "BACKUP_KEEP moet een getal zijn" ;; esac
[ "$BACKUP_KEEP" -ge 1 ] || die "BACKUP_KEEP moet minstens 1 zijn"

psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }

maak() {
    local label=${1:-handmatig}
    case $label in *[!a-z0-9-]*) die "label mag alleen kleine letters, cijfers en - bevatten" ;; esac
    local name tmp
    name=$(date +%Y%m%d-%H%M%S)-$label
    install -d -m 0700 "$BACKUP_DIR"
    tmp=$(mktemp -d "$BACKUP_DIR/.bezig-XXXXXX")
    trap 'rm -rf "$tmp"' EXIT

    runuser -u postgres -- pg_dump -Fc "$POSTGRES_DB" >"$tmp/database.dump"
    tar -C "$DATA_DIR" -czf "$tmp/css-files.tar.gz" css-files
    if [ -d "$DATA_DIR/storage" ]; then
        tar -C "$DATA_DIR" -czf "$tmp/storage.tar.gz" storage
    fi
    # Bevat SECRET_KEY en het databasewachtwoord: zonder dit bestand is een terugzetting op
    # een nieuwe container lastiger. De back-upmap is daarom alleen leesbaar voor root.
    cp "$ENV_FILE" "$tmp/cssthema.env"
    # De code die nu draait (install.sh noteert die), niet wat er al binnengehaald is.
    if [ -s "$DATA_DIR/geinstalleerde-commit" ]; then
        cp "$DATA_DIR/geinstalleerde-commit" "$tmp/commit"
    else
        git -C "$APP_DIR" rev-parse HEAD >"$tmp/commit" 2>/dev/null || echo onbekend >"$tmp/commit"
    fi
    chmod -R go-rwx "$tmp"
    mv "$tmp" "$BACKUP_DIR/$name"
    trap - EXIT
    echo "$BACKUP_DIR/$name"

    # Bewaartermijn: alleen mappen die dit script maakte (beginnen met een datum).
    local old
    old=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | head -n "-$BACKUP_KEEP")
    if [ -n "$old" ]; then
        printf '%s\n' "$old" | while IFS= read -r dir; do rm -rf -- "$dir"; done
    fi
}

lijst() {
    [ -d "$BACKUP_DIR" ] || { echo "nog geen back-ups in $BACKUP_DIR"; return; }
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | while IFS= read -r dir; do
        printf '%s  %s  commit %s\n' "$(du -sh "$dir" | cut -f1)" "$dir" "$(cut -c1-7 "$dir/commit" 2>/dev/null)"
    done
}

terugzetten() {
    local src=${1:-} yes=${2:-}
    [ -n "$src" ] || die "gebruik: cssthema-backup terugzetten <map> (zie: cssthema-backup lijst)"
    [ -d "$src" ] || src=$BACKUP_DIR/$src
    [ -f "$src/database.dump" ] && [ -f "$src/css-files.tar.gz" ] || die "geen volledige back-up in $src"
    local commit current
    commit=$(cat "$src/commit" 2>/dev/null || echo onbekend)
    current=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo onbekend)

    echo "Terugzetten van $src"
    echo "Dit vervangt de database, css-files en storage. Eerst wordt een back-up van de huidige toestand gemaakt."
    if [ "$yes" != "-y" ]; then
        read -r -p "Typ ja om door te gaan: " answer
        [ "$answer" = ja ] || die "afgebroken"
    fi

    maak voor-terugzetten >/dev/null
    systemctl stop cssthema-api cssthema-worker

    psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid()" >/dev/null
    runuser -u postgres -- dropdb --if-exists "$POSTGRES_DB"
    runuser -u postgres -- createdb -E UTF8 -T template0 --locale=C.UTF-8 --owner="$POSTGRES_USER" "$POSTGRES_DB"
    runuser -u postgres -- pg_restore --no-owner --role="$POSTGRES_USER" -d "$POSTGRES_DB" <"$src/database.dump"

    rm -rf "${DATA_DIR:?}/css-files"
    tar -C "$DATA_DIR" -xzf "$src/css-files.tar.gz"
    chown -R cssthema:cssthema "$DATA_DIR/css-files"
    if [ -f "$src/storage.tar.gz" ]; then
        rm -rf "${DATA_DIR:?}/storage"
        tar -C "$DATA_DIR" -xzf "$src/storage.tar.gz"
        chown -R cssthema:cssthema "$DATA_DIR/storage"
    fi

    # Caches legen, anders blijft de oude CSS nog even geleverd worden.
    for cli in redis-cli valkey-cli; do
        if command -v "$cli" >/dev/null; then
            "$cli" -u "$REDIS_URL" FLUSHDB >/dev/null 2>&1 || true
            break
        fi
    done
    rm -rf /var/cache/nginx/css/*
    systemctl reload nginx || true

    if ! cmp -s "$src/cssthema.env" "$ENV_FILE"; then
        echo "Let op: de configuratie in de back-up verschilt van $ENV_FILE (die is niet aangepast)."
        echo "Vergelijk met: diff $src/cssthema.env $ENV_FILE"
    fi

    if [ "$commit" != onbekend ] && [ "$commit" != "$current" ]; then
        # Niet starten: de api zou de teruggezette database meteen naar het schema van de
        # huidige (nieuwere) code migreren.
        echo
        echo "Data teruggezet. De back-up hoort bij een andere versie van de code ($commit)."
        echo "Zet die code terug en start alles met:"
        echo "  git -C $APP_DIR checkout --detach $commit && bash $APP_DIR/deploy/debian/install.sh"
        echo "(Later terug naar de laatste versie: git -C $APP_DIR switch main && git -C $APP_DIR pull)"
    else
        systemctl start cssthema-api cssthema-worker
        echo "Teruggezet en gestart."
    fi
}

cmd=${1:-maak}
case $cmd in
    maak) shift || true; maak "$@" ;;
    lijst) lijst ;;
    terugzetten) shift; terugzetten "$@" ;;
    -h | --help | help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) maak "$cmd" ;;
esac
