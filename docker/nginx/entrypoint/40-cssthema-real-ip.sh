#!/bin/sh
# Schrijft de set_real_ip_from-regels voor nginx op basis van TRUSTED_PROXIES:
# komma- of spatiegescheiden IP's/CIDR's van de reverse proxy (NPM) vóór cssthema.
# Standaard alleen Docker-netwerken (172.16.0.0/12). Draait NPM op een andere machine
# of in een LXC, zet dan zijn IP erbij, bv. TRUSTED_PROXIES=172.16.0.0/12,192.168.1.10
#
# Daarnaast $ct_trusted_peer: 1 als de TCP-verbinding van zo'n proxy of van deze machine
# zelf komt. cssthema.conf laat schrijven op /api/ alleen dan toe: wie poort 80 rechtstreeks
# bereikt (het LAN, een andere container), omzeilt zo niet Authentik in NPM.
set -eu
out=${CSSTHEMA_REAL_IP_CONF:-/etc/nginx/conf.d/00-real-ip.conf}
proxies=$(printf %s "${TRUSTED_PROXIES:-172.16.0.0/12}" | tr ',' ' ')
geo=""
{
    echo "# Gegenereerd door 40-cssthema-real-ip.sh uit TRUSTED_PROXIES."
    for cidr in $proxies; do
        case "$cidr" in
            *[!0-9A-Fa-f.:/]*)
                echo "40-cssthema-real-ip.sh: ongeldige waarde in TRUSTED_PROXIES: $cidr" >&2
                exit 1
                ;;
        esac
        echo "set_real_ip_from $cidr;"
        case "$cidr" in
            127.0.0.1 | 127.0.0.1/32 | ::1 | ::1/128) ;; # staat al in de geo hieronder
            *) geo="$geo    $cidr 1;
" ;;
        esac
    done
    echo
    # $realip_remote_addr: het adres van de verbinding zelf. $remote_addr is na real_ip al
    # de client uit X-Forwarded-For, en die kan iedereen verzinnen.
    echo 'geo $realip_remote_addr $ct_trusted_peer {'
    echo "    default 0;"
    echo "    127.0.0.1 1;"
    echo "    ::1 1;"
    printf %s "$geo"
    echo "}"
} >"$out"
