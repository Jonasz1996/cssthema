#!/bin/sh
# Schrijft de set_real_ip_from-regels voor nginx op basis van TRUSTED_PROXIES:
# komma- of spatiegescheiden IP's/CIDR's van de reverse proxy (NPM) vóór cssthema.
# Standaard alleen Docker-netwerken (172.16.0.0/12). Draait NPM op een andere machine
# of in een LXC, zet dan zijn IP erbij, bv. TRUSTED_PROXIES=172.16.0.0/12,192.168.1.10
set -eu
out=${CSSTHEMA_REAL_IP_CONF:-/etc/nginx/conf.d/00-real-ip.conf}
proxies=$(printf %s "${TRUSTED_PROXIES:-172.16.0.0/12}" | tr ',' ' ')
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
    done
} >"$out"
