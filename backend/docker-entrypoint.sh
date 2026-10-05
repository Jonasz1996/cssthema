#!/bin/sh
# Voert migraties uit (onder advisory lock, zie migrations/env.py) en start daarna het commando.
set -eu
if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
    echo "cssthema: database migreren..."
    alembic upgrade head
fi
exec "$@"
