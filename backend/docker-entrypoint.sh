#!/bin/sh
# Voert migraties uit (onder advisory lock, zie migrations/env.py) en start daarna het commando.
# RUN_MIGRATIONS_ON_START wordt alleen hier gelezen: true/1/yes/on (hoofdletters mogen).
set -eu
run_migrations=$(printf %s "${RUN_MIGRATIONS_ON_START:-true}" | tr '[:upper:]' '[:lower:]')
case "$run_migrations" in
    true | 1 | yes | on)
        echo "cssthema: database migreren..."
        alembic upgrade head
        ;;
    *)
        echo "cssthema: migraties overgeslagen (RUN_MIGRATIONS_ON_START=${RUN_MIGRATIONS_ON_START})"
        ;;
esac
exec "$@"
