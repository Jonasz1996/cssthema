#!/usr/bin/env bash
# cssthema-account: lokale accounts van het dashboard beheren (AUTH_MODE=lokaal).
# deploy/debian/install.sh installeert dit als /usr/local/sbin/cssthema-account.
#
#   cssthema-account nieuw <e-mail> [--rol admin|editor|viewer]  account met tijdelijk wachtwoord
#   cssthema-account reset <e-mail>        tijdelijk wachtwoord, MFA gewist, alle sessies af
#   cssthema-account lijst                 alle accounts
#   cssthema-account uitschakelen <e-mail> / inschakelen <e-mail>
set -euo pipefail

ENV_FILE=/etc/cssthema/cssthema.env
VENV=@VENV@

[ "$(id -u)" -eq 0 ] || { echo "cssthema-account: draai dit als root" >&2; exit 1; }
[ -r "$ENV_FILE" ] || { echo "cssthema-account: $ENV_FILE niet gevonden" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
exec "$VENV/bin/cssthema-account" "$@"
