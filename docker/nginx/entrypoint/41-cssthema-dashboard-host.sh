#!/bin/sh
# Schrijft de map $host -> $ct_dashboard_host voor nginx op basis van DASHBOARD_HOST: de
# hostna(a)m(en) waarop het dashboard en de api staan, komma- of spatiegescheiden, bv.
# DASHBOARD_HOST=cssthema.jbogaert.be (standaard localhost).
#
# Daarnaast staat het dashboard altijd op elk IPv4-adres (http://<ip-van-deze-machine>/): wie
# het op het LAN opent, hoeft niets in te stellen, ook niet na een nieuw IP. NPM stuurt altijd
# een naam als Host, dus via NPM blijft het dashboard dicht. Uitzondering: is de host van
# PUBLIC_BASE_URL een IP, dan krijgt dat IP het dashboard niet (de /alg-thema/-variant zou het
# anders via elke app doorgeven).
#
# cssthema.conf serveert de SPA, /assets/, /preview-bridge.js en /api/ alleen voor die
# hosts; elke andere Host (bv. het publieke CSS-domein, of een NPM-host zonder Authentik)
# krijgt daar een 404. Thema-CSS, /host/, scripts, lettertypes en /readyz blijven op elke
# host publiek.
set -eu
out=${CSSTHEMA_DASHBOARD_HOST_CONF:-/etc/nginx/conf.d/01-dashboard-host.conf}
hosts=$(printf %s "${DASHBOARD_HOST:-localhost}" | tr ',' ' ' | tr '[:upper:]' '[:lower:]')

# Zoals HOSTNAME_RE in de backend (die weigert de api anders te starten): labels van a-z, 0-9
# en '-', niet met '-' aan het begin of einde, hoogstens 63 tekens, samen hoogstens 253.
geldige_hostnaam() {
    [ ${#1} -le 253 ] || return 1
    case "$1" in
        # De laatste vier zijn sleutelwoorden van map.
        *[!a-z0-9.-]* | .* | *. | *..* | default | hostnames | include | volatile) return 1 ;;
    esac
    rest=$1
    while [ -n "$rest" ]; do
        label=${rest%%.*}
        case "$label" in -* | *-) return 1 ;; esac
        [ ${#label} -le 63 ] || return 1
        case "$rest" in *.*) rest=${rest#*.} ;; *) rest="" ;; esac
    done
}

entries=""
set -f # een `*` in DASHBOARD_HOST is geen bestandspatroon
for host in $hosts; do
    if ! geldige_hostnaam "$host"; then
        echo "41-cssthema-dashboard-host.sh: ongeldige hostnaam in DASHBOARD_HOST: $host (alleen de naam, zonder schema of poort)" >&2
        exit 1
    fi
    case " $entries " in
        *" $host "*) ;; # dubbel: nginx weigert een map met twee keer dezelfde sleutel
        *) entries="$entries $host" ;;
    esac
done
if [ -z "$entries" ]; then
    echo "41-cssthema-dashboard-host.sh: DASHBOARD_HOST is leeg" >&2
    exit 1
fi
# Host van PUBLIC_BASE_URL, als die een IPv4-adres is.
publiek=${PUBLIC_BASE_URL:-}
publiek=${publiek#*://}
publiek=${publiek%%/*}
publiek=$(printf %s "${publiek%:*}" | tr '[:upper:]' '[:lower:]')
case "$publiek" in
    *[!0-9.]* | "") publiek="" ;;
esac
case " $entries " in
    *" $publiek "*) publiek="" ;; # staat expliciet in DASHBOARD_HOST: dat gaat voor
esac
{
    echo "# Gegenereerd door 41-cssthema-dashboard-host.sh uit DASHBOARD_HOST."
    # shellcheck disable=SC2016 # nginx-variabelen, geen shell
    echo 'map $host $ct_dashboard_host {'
    echo "    default 0;"
    for host in $entries; do
        echo "    $host 1;"
    done
    # Exacte namen gaan in een nginx-map voor op een regex.
    [ -z "$publiek" ] || echo "    $publiek 0;"
    echo '    "~^[0-9]{1,3}(\.[0-9]{1,3}){3}$" 1;'
    echo "}"
} >"$out"
