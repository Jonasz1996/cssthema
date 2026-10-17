#!/bin/sh
# Schrijft de map $host -> $ct_dashboard_host voor nginx op basis van DASHBOARD_HOST: de
# hostna(a)m(en) waarop het dashboard en de api staan, komma- of spatiegescheiden, bv.
# DASHBOARD_HOST=cssthema.jbogaert.be (standaard localhost).
#
# cssthema.conf serveert de SPA, /assets/, /preview-bridge.js en /api/ alleen voor die
# hosts; elke andere Host (bv. het publieke CSS-domein, of een NPM-host zonder Authentik)
# krijgt daar een 404. Thema-CSS, /host/, scripts, lettertypes en /readyz blijven op elke
# host publiek.
set -eu
out=${CSSTHEMA_DASHBOARD_HOST_CONF:-/etc/nginx/conf.d/01-dashboard-host.conf}
hosts=$(printf %s "${DASHBOARD_HOST:-localhost}" | tr ',' ' ' | tr '[:upper:]' '[:lower:]')
entries=""
for host in $hosts; do
    case "$host" in
        # De laatste vier zijn sleutelwoorden van map.
        *[!a-z0-9.-]* | .* | *. | -* | *..* | default | hostnames | include | volatile)
            echo "41-cssthema-dashboard-host.sh: ongeldige hostnaam in DASHBOARD_HOST: $host (alleen de naam, zonder schema of poort)" >&2
            exit 1
            ;;
    esac
    case " $entries " in
        *" $host "*) ;; # dubbel: nginx weigert een map met twee keer dezelfde sleutel
        *) entries="$entries $host" ;;
    esac
done
if [ -z "$entries" ]; then
    echo "41-cssthema-dashboard-host.sh: DASHBOARD_HOST is leeg" >&2
    exit 1
fi
{
    echo "# Gegenereerd door 41-cssthema-dashboard-host.sh uit DASHBOARD_HOST."
    # shellcheck disable=SC2016 # nginx-variabelen, geen shell
    echo 'map $host $ct_dashboard_host {'
    echo "    default 0;"
    for host in $entries; do
        echo "    $host 1;"
    done
    echo "}"
} >"$out"
