#!/usr/bin/env bash
# cssthema-backup: back-ups van de installatie zonder Docker (deploy/debian/install.sh
# installeert dit als /usr/local/sbin/cssthema-backup, met een dagelijkse systemd-timer).
#
#   cssthema-backup [maak] [label]     database, css-files, storage, configuratie, commit
#                                      en databasemigratie
#   cssthema-backup lijst              bestaande back-ups, nieuwste onderaan
#   cssthema-backup terugzetten <map>  een back-up terugzetten (vraagt eerst bevestiging)
#
# Instellingen in /etc/cssthema/cssthema.env:
#   BACKUP_DIR=/var/backups/cssthema   zet dit op een gedeelde map (NFS, SMB, bind mount van
#                                      Proxmox) voor een kopie buiten de container
#   BACKUP_KEEP=14                     zoveel back-ups blijven bewaard, de oudste gaan weg
# Na elke geslaagde back-up staat het tijdstip in /var/lib/cssthema/laatste-backup.
set -euo pipefail

ENV_FILE=/etc/cssthema/cssthema.env
APP_DIR=@APP_DIR@
DATA_DIR=/var/lib/cssthema
STANDAARD_BACKUP_DIR=/var/backups/cssthema

die() { printf 'cssthema-backup: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "draai dit als root"
[ -r "$ENV_FILE" ] || die "$ENV_FILE niet gevonden"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
BACKUP_DIR=${BACKUP_DIR:-$STANDAARD_BACKUP_DIR}
BACKUP_KEEP=${BACKUP_KEEP:-14}
case $BACKUP_KEEP in '' | *[!0-9]*) die "BACKUP_KEEP moet een getal zijn" ;; esac
[ "$BACKUP_KEEP" -ge 1 ] || die "BACKUP_KEEP moet minstens 1 zijn"

psql_admin() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# De laatste migratie(s) van de code in APP_DIR: revisies die geen down_revision van een
# andere zijn. Daarop moet een teruggezette database staan, anders migreert de api hem bij
# het starten naar een ander schema (of start hij niet).
code_heads() {
    local versions=$APP_DIR/backend/migrations/versions revs downs rev
    revs=$(sed -n 's/^revision[^=]*= *"\([^"]*\)".*/\1/p' "$versions"/*.py)
    downs=$(sed -n 's/^down_revision[^=]*= *"\([^"]*\)".*/\1/p' "$versions"/*.py)
    for rev in $revs; do
        case $'\n'"$downs"$'\n' in *$'\n'"$rev"$'\n'*) ;; *) echo "$rev" ;; esac
    done
}

tmp=  # globaal: de EXIT-trap draait na het einde van maak(), waar een `local` al weg is
opruimen() { if [ -n "$tmp" ]; then rm -rf -- "$tmp"; fi; }
trap opruimen EXIT

maak() {
    local label=${1:-handmatig} prune=${2:-ja}
    case $label in *[!a-z0-9-]*) die "label mag alleen kleine letters, cijfers en - bevatten" ;; esac
    local name
    name=$(date +%Y%m%d-%H%M%S)-$label
    # Alleen aanmaken als hij ontbreekt: install -d zet ook de rechten van een bestaande map,
    # en dat mag root niet op een bind mount van Proxmox (unprivileged LXC) of NFS.
    [ -d "$BACKUP_DIR" ] || install -d -m 0700 "$BACKUP_DIR"
    if [ "$BACKUP_DIR" != "$STANDAARD_BACKUP_DIR" ] &&
        [ "$(stat -c %d "$BACKUP_DIR")" = "$(stat -c %d /)" ]; then
        echo "cssthema-backup: let op: $BACKUP_DIR is geen aparte mount (NFS, SMB, bind mount); de back-up staat dan gewoon in de container. Is de share wel aangekoppeld?" >&2
    fi
    # Halve back-ups van een vorige, afgebroken run (bevatten ook cssthema.env).
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.bezig-*' -mmin +60 -exec rm -rf -- {} +
    tmp=$(mktemp -d "$BACKUP_DIR/.bezig-XXXXXX")

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
    # En de migratie van de database: terugzetten vergelijkt die met de code.
    psql_admin -d "$POSTGRES_DB" -tAc "SELECT version_num FROM alembic_version" >"$tmp/revisie" 2>/dev/null ||
        echo onbekend >"$tmp/revisie"
    chmod -R go-rwx "$tmp"
    mv "$tmp" "$BACKUP_DIR/$name"
    tmp=
    date -Iseconds >"$DATA_DIR/laatste-backup"
    echo "$BACKUP_DIR/$name"

    [ "$prune" = ja ] || return 0
    # Bewaartermijn: alleen mappen die dit script maakte (beginnen met een datum).
    local old
    old=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | head -n "-$BACKUP_KEEP")
    if [ -n "$old" ]; then
        printf '%s\n' "$old" | while IFS= read -r dir; do rm -rf -- "$dir"; done
    fi
}

lijst() {
    [ -d "$BACKUP_DIR" ] || { echo "nog geen back-ups in $BACKUP_DIR"; return; }
    local dir commit
    find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort | while IFS= read -r dir; do
        commit=$(cat "$dir/commit" 2>/dev/null || echo onbekend)
        [ "$commit" = onbekend ] || commit=${commit:0:7}
        printf '%s  %s  commit %s  migratie %s\n' "$(du -sh "$dir" | cut -f1)" "$dir" \
            "$commit" "$(cat "$dir/revisie" 2>/dev/null || echo ?)"
    done
    if [ -s "$DATA_DIR/laatste-backup" ]; then
        echo "laatste geslaagde back-up: $(cat "$DATA_DIR/laatste-backup")"
    fi
}

terugzetten() {
    local src=${1:-} yes=${2:-}
    [ -n "$src" ] || die "gebruik: cssthema-backup terugzetten <map> (zie: cssthema-backup lijst)"
    [ -d "$src" ] || src=$BACKUP_DIR/$src
    [ -f "$src/database.dump" ] && [ -f "$src/css-files.tar.gz" ] || die "geen volledige back-up in $src"
    local commit current revisie heads
    commit=$(cat "$src/commit" 2>/dev/null || true)
    commit=${commit:-onbekend}
    current=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo onbekend)
    # Back-ups van vóór de migratie-notitie hebben geen revisie: dan alleen op de commit.
    revisie=$(cat "$src/revisie" 2>/dev/null || true)
    heads=$(code_heads)

    echo "Terugzetten van $src"
    echo "Dit vervangt de database, css-files en storage. Eerst wordt een back-up van de huidige toestand gemaakt."
    if [ "$yes" != "-y" ]; then
        read -r -p "Typ ja om door te gaan: " answer
        [ "$answer" = ja ] || die "afgebroken"
    fi

    # Zonder bewaartermijn: die zou de back-up die je terugzet (de oudste) kunnen wissen.
    maak voor-terugzetten nee >/dev/null
    [ -f "$src/database.dump" ] || die "$src verdween tijdens het terugzetten; er is niets gewijzigd"
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

    # Alleen starten als de code bij de teruggezette database past: de api migreert bij het
    # starten naar het schema van de code die er nu staat, en een nieuwere code zou de
    # teruggezette database zo meteen weer omzetten.
    if [ "$commit" = onbekend ]; then
        echo
        echo "Data teruggezet, niet gestart: de back-up weet niet bij welke versie van de code hij hoort"
        echo "(databasemigratie ${revisie:-onbekend}; de code hier staat op ${heads//$'\n'/, }). Zoek die versie"
        echo "met git -C $APP_DIR reflog en start alles met:"
        echo "  git -C $APP_DIR checkout --detach <commit> && bash $APP_DIR/deploy/debian/install.sh"
    elif { [ -n "$revisie" ] && [ "$revisie" != "$heads" ]; } || { [ -z "$revisie" ] && [ "$commit" != "$current" ]; }; then
        echo
        echo "Data teruggezet, niet gestart. De back-up hoort bij een andere versie van de code ($commit${revisie:+, databasemigratie $revisie})."
        echo "Zet die code terug en start alles met:"
        echo "  git -C $APP_DIR checkout --detach $commit && bash $APP_DIR/deploy/debian/install.sh"
        echo "(Later terug naar de laatste versie: git -C $APP_DIR switch main && git -C $APP_DIR pull && bash $APP_DIR/deploy/debian/install.sh)"
    else
        systemctl start cssthema-api cssthema-worker
        echo "Teruggezet en gestart."
        if [ "$commit" != "$current" ]; then
            echo "(De back-up is van commit ${commit:0:7}; de code staat op ${current:0:7}, met hetzelfde databaseschema.)"
        fi
    fi
}

cmd=${1:-maak}
case $cmd in
    maak) shift || true; maak "$@" ;;
    lijst) lijst ;;
    terugzetten) shift; terugzetten "$@" ;;
    -h | --help | help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) maak "$cmd" ;;
esac
