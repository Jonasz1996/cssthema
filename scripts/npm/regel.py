"""Zet de cssthema-regel in de Advanced-config van je proxy hosts in Nginx Proxy Manager.

Per proxy host haalt het de oude thema-regels op server-niveau weg (`sub_filter` met links naar
je CSS-domein, cssthema, /alg-thema/ of $host, `sub_filter_once`,
`proxy_set_header Accept-Encoding ""`, een oude `location ^~ /alg-thema/` en een eerder blok
`# cssthema` ... `# /cssthema`) en zet het er de ene regel voor alle hosts voor in de plaats.
Apps met een `location ^~ /alg-thema/` of met links naar /alg-thema/ (CSP) krijgen de variant
via het eigen domein, standaard alleen CSS. De rest van de Advanced-config blijft staan.

Gebruik (zie README.md):
    python regel.py --npm http://IP-VAN-NPM:81 --basis https://css.jbogaert.be \\
        --dashboard cssthema.jbogaert.be --uitsluiten authentik.jbogaert.be  # proefrun
    python regel.py ... --host proxmox100.jbogaert.be --toepassen          # één host
    python regel.py ... --toepassen                                        # alle hosts
    python regel.py --npm http://IP-VAN-NPM:81 --terugzetten npm-advanced-backup-....json

Nodig: Python 3.9+, verder niets.
"""

from __future__ import annotations

import argparse
import contextlib
import difflib
import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

MARKER_BEGIN = "# cssthema"
MARKER_EINDE = "# /cssthema"
EIGEN_PREFIX = "/alg-thema"

# Zelfde tekst als in cssthema (backend/src/cssthema/domain/hosts.py): Accept-Encoding leeg,
# alleen voor HTML-navigaties. `proxy_set_header` op server-niveau erft de `location /` van
# NPM niet; `more_set_input_headers` (headers-more, zit in OpenResty) wel.
_ACCEPT_ENCODING = (
    "set $ct_ae $http_accept_encoding;\n"
    'if ($http_accept ~* "text/html") { set $ct_ae ""; }\n'
    'more_set_input_headers "Accept-Encoding: $ct_ae";\n'
)


def regel_blok(basis: str, *, eigen_domein: bool = False, met_script: bool = False) -> str:
    """Het blok voor Advanced, letterlijk zoals cssthema het toont (snippet() en
    snippet_own_domain() in de backend). De hoofdregel heeft altijd het script; via het eigen
    domein alleen met `met_script`, zodat een wachtwoordkluis nooit cssthema-JavaScript krijgt.
    """
    basis = basis.rstrip("/")
    if not eigen_domein:
        return (
            f"{MARKER_BEGIN}: zelfde regel in elke proxy host\n"
            f"sub_filter '</head>' '{_tags(basis, script=True)}';\n"
            "sub_filter_once on;\n"
            f"{_ACCEPT_ENCODING}"
            f"{MARKER_EINDE}\n"
        )
    label = "CSS en script" if met_script else "alleen CSS"
    return (
        f"{MARKER_BEGIN}: zelfde regel in elke proxy host (eigen domein, {label})\n"
        f"sub_filter '</head>' '{_tags(EIGEN_PREFIX, script=met_script)}';\n"
        "sub_filter_once on;\n"
        f"{_ACCEPT_ENCODING}"
        f"location ^~ {EIGEN_PREFIX}/ {{\n"
        "    limit_except GET HEAD { deny all; }\n"
        '    proxy_set_header Cookie "";\n'
        '    proxy_set_header Authorization "";\n'
        "    proxy_connect_timeout 2s;\n"
        "    proxy_read_timeout 5s;\n"
        "    proxy_ssl_server_name on;\n"
        f"    proxy_pass {basis}/;\n"
        "}\n"
        f"{MARKER_EINDE}\n"
    )


def _tags(base: str, *, script: bool) -> str:
    tags = f'<link rel="stylesheet" href="{base}/host/$host.css">'
    if script:
        tags += f'<script src="{base}/host/$host.js" defer></script>'
    return tags + "</head>"


# ---------------------------------------------------------------------------------------
# De Advanced-config lezen (zoals nginx ze in stukken knipt)
# ---------------------------------------------------------------------------------------


class ConfigError(ValueError):
    """De Advanced-config is niet te lezen: haakjes of aanhalingstekens kloppen niet."""


@dataclass
class Stelling:
    """Eén directive (`naam args;`) of blok (`naam args { ... }`) en waar het in de tekst staat."""

    naam: str
    args: list[str]
    begin: int
    einde: int
    kinderen: list[Stelling] | None = None  # None: geen blok

    def alles(self) -> list[Stelling]:
        """Zichzelf en alles wat erin staat, hoe diep ook."""
        uit = [self]
        for k in self.kinderen or []:
            uit.extend(k.alles())
        return uit


@dataclass
class Commentaar:
    begin: int
    einde: int
    tekst: str
    diepte: int


def ontleden(tekst: str) -> tuple[list[Stelling], list[Commentaar]]:
    """Knipt de config in directives en blokken met hun plaats, met de regels van nginx:
    `#` begint commentaar aan het begin van een woord, een woord stopt bij spatie, `;` of `{`
    (niet in `${`), en binnen aanhalingstekens telt niets daarvan.
    """
    wortel: list[Stelling] = []
    open_: list[Stelling] = []
    commentaar: list[Commentaar] = []
    woorden: list[str] = []
    begin = -1
    i, n = 0, len(tekst)
    while i < n:
        c = tekst[i]
        if c.isspace():
            i += 1
        elif c == "#":  # hier staat altijd het begin van een woord
            j = tekst.find("\n", i)
            j = n if j < 0 else j
            commentaar.append(Commentaar(i, j, tekst[i:j].rstrip("\r"), len(open_)))
            i = j
        elif c in ";{":
            if not woorden:
                raise ConfigError(f"'{c}' zonder directive ervoor")
            st = Stelling(woorden[0], woorden[1:], begin, i + 1, [] if c == "{" else None)
            (open_[-1].kinderen if open_ else wortel).append(st)  # type: ignore[union-attr]
            if c == "{":
                open_.append(st)
            woorden, begin = [], -1
            i += 1
        elif c == "}":
            if woorden or not open_:
                raise ConfigError("'}' zonder open blok")
            open_.pop().einde = i + 1
            i += 1
        else:
            if begin < 0:
                begin = i
            if c in "\"'":
                j = i + 1
                while j < n and tekst[j] != c:
                    j += 2 if tekst[j] == "\\" else 1
                if j >= n:
                    raise ConfigError("aanhalingsteken niet gesloten")
                woorden.append(tekst[i + 1 : j])
                i = j + 1
            else:
                j = i
                while j < n:
                    d = tekst[j]
                    if d == "\\":
                        j += 2
                        continue
                    if d.isspace() or d == ";" or (d == "{" and tekst[j - 1] != "$"):
                        break
                    j += 1
                woorden.append(tekst[i:j])
                i = j
    if woorden or open_:
        raise ConfigError("onvolledige directive of blok zonder '}'")
    return wortel, commentaar


# ---------------------------------------------------------------------------------------
# De nieuwe Advanced-config van één host
# ---------------------------------------------------------------------------------------

# Ook `href=\"...\"` binnen aanhalingstekens: nginx haalt die backslash er zelf uit.
_URL_RE = re.compile(r"""(?:href|src)\s*=\s*\\?["']([^"'\s>\\]+)\\?["']""", re.IGNORECASE)
_EIGEN_PAD_RE = re.compile(r"^/(?:alg-thema|__cssthema)(?:/|$)")


@dataclass
class Resultaat:
    """`nieuw` is None als de host met de hand moet (zie `reden`)."""

    nieuw: str | None
    reden: str = ""
    eigen_domein: bool = False
    met_script: bool = False
    had_script: bool = False  # oude links via het eigen domein laadden ook een script


def _host_en_pad(url: str) -> tuple[str, str]:
    """`hhttps://a.be:81/x.css` → ('a.be:81', '/x.css'); `css.x.be/a.css` telt als host + pad."""
    deel = urlsplit(url if "://" in url or url.startswith("/") else "//" + url)
    return deel.netloc.rsplit("@", 1)[-1].lower(), deel.path


def is_oude_link(url: str, oude_hosts: set[str]) -> bool:
    """Een link uit een oude thema-regel: naar het CSS-domein, cssthema, /alg-thema/ of $host."""
    if "$host" in url or "cssthema" in url.lower():
        return True
    netloc, pad = _host_en_pad(url)
    if netloc and (netloc in oude_hosts or netloc.split(":", 1)[0] in oude_hosts):
        return True
    return bool(_EIGEN_PAD_RE.match(pad))


def _via_eigen_domein(url: str, oude_hosts: set[str]) -> bool:
    """Een link naar /alg-thema/ (of /__cssthema/) op het domein van de app zelf."""
    netloc, pad = _host_en_pad(url)
    return bool(_EIGEN_PAD_RE.match(pad)) and netloc.split(":", 1)[0] not in oude_hosts


def _is_marker_begin(tekst: str) -> bool:
    t = tekst.strip()
    return t == MARKER_BEGIN or t.startswith((MARKER_BEGIN + ":", MARKER_BEGIN + " "))


def _is_eigen_location(st: Stelling) -> bool:
    if st.naam != "location" or st.kinderen is None or not st.args:
        return False
    return bool(_EIGEN_PAD_RE.match(st.args[-1]))


def _urls(st: Stelling) -> list[str]:
    return _URL_RE.findall(" ".join(st.args))


def oude_links(oud: str, oude_hosts: set[str]) -> list[str]:
    """Alle oude thema-links in `sub_filter`-regels, hoe diep ook (voor --hosts-conf)."""
    try:
        stellingen, _ = ontleden(oud)
    except ConfigError:
        return []
    links: list[str] = []
    for st in (s for top in stellingen for s in top.alles()):
        if st.naam == "sub_filter":
            links += [u for u in _urls(st) if "$" not in u and is_oude_link(u, oude_hosts)]
    return list(dict.fromkeys(links))


def nieuwe_config(
    oud: str, basis: str, oude_hosts: set[str], *, met_script: bool = False
) -> Resultaat:
    """Haalt de oude thema-regels op server-niveau weg en zet het blok ervoor in de plaats.

    Al de rest (andere directives, locations, Authentik, commentaar) blijft letterlijk staan.
    Een host met een eigen `sub_filter` die niet van cssthema is, of met `sub_filter` binnen een
    eigen `location /`, krijgt `nieuw=None`: daar kan het script niet veilig kiezen.
    """
    r = _nieuwe_config(oud, basis, oude_hosts, met_script=met_script)
    # Vangnet voor ongewone opmaak: een tweede keer verandert er niets meer, anders staat het
    # blok niet waar het hoort (bv. binnen een location).
    if (
        r.nieuw is not None
        and r.nieuw != oud
        and _nieuwe_config(r.nieuw, basis, oude_hosts, met_script=met_script).nieuw != r.nieuw
    ):
        return Resultaat(
            None, "handmatig nakijken: ongewone opmaak (blok niet zeker op server-niveau)"
        )
    return r


def _nieuwe_config(oud: str, basis: str, oude_hosts: set[str], *, met_script: bool) -> Resultaat:
    try:
        stellingen, commentaar = ontleden(oud)
    except ConfigError as e:
        return Resultaat(None, f"handmatig nakijken: Advanced niet te lezen ({e})")

    eigen = False
    script_behouden = False
    had_script = False

    # Een eerder blok `# cssthema` ... `# /cssthema` gaat er helemaal uit.
    blokken: list[tuple[int, int]] = []
    begins = [c for c in commentaar if c.diepte == 0 and _is_marker_begin(c.tekst)]
    eindes = [c for c in commentaar if c.diepte == 0 and c.tekst.strip() == MARKER_EINDE]
    if len(begins) != len(eindes):
        return Resultaat(None, f"handmatig nakijken: '{MARKER_BEGIN}' zonder '{MARKER_EINDE}'")
    for i, begin in enumerate(begins):
        eind = eindes[i]
        if eind.begin < begin.begin or (blokken and begin.begin < blokken[-1][1]):
            return Resultaat(None, f"handmatig nakijken: '{MARKER_BEGIN}' zonder '{MARKER_EINDE}'")
        blokken.append((begin.begin, eind.einde))
        tekst = oud[begin.begin : eind.einde]
        if "eigen domein" in begin.tekst or re.search(r"location\s+\S*\s*/alg-thema", tekst):
            eigen = True
            script_behouden = script_behouden or "<script" in tekst

    weg = list(blokken)
    for st in stellingen:
        if any(b <= st.begin < e for b, e in blokken):
            continue
        if st.kinderen is not None:
            if _is_eigen_location(st):
                weg.append((st.begin, st.einde))
                eigen = True
                continue
            if st.naam == "if" and _is_ct_ae_if(st):
                weg.append((st.begin, st.einde))
                continue
            binnen = [s for s in st.alles()[1:] if s.naam.startswith("sub_filter")]
            if st.naam == "location" and st.args == ["/"] and binnen:
                authentik = any(s.naam == "auth_request" for s in st.alles())
                waar = "location / met Authentik" if authentik else "een eigen location /"
                return Resultaat(None, f"handmatig nakijken: sub_filter binnen {waar}")
            if any(is_oude_link(u, oude_hosts) for s in binnen for u in _urls(s)):
                waar = " ".join([st.naam, *st.args])
                return Resultaat(None, f"handmatig nakijken: thema-links binnen '{waar}'")
            continue
        if st.naam == "sub_filter":
            urls = _urls(st)
            eigen_links = [u for u in urls if is_oude_link(u, oude_hosts)]
            andere = [u for u in urls if u not in eigen_links]
            if not eigen_links or andere:
                return Resultaat(None, "handmatig nakijken: " + _andere_sub_filter(andere))
            weg.append((st.begin, st.einde))
            if any(_via_eigen_domein(u, oude_hosts) for u in eigen_links):
                eigen = True
                had_script = had_script or any(u.endswith(".js") for u in eigen_links)
        elif st.naam == "sub_filter_once" or _is_accept_encoding(st):
            weg.append((st.begin, st.einde))

    met = eigen and (met_script or script_behouden)
    blok = regel_blok(basis, eigen_domein=eigen, met_script=met)
    if "\r\n" in oud:
        blok = blok.replace("\n", "\r\n")
    nieuw = _vervangen(oud, weg, commentaar, blok)
    return Resultaat(nieuw, eigen_domein=eigen, met_script=met, had_script=had_script and not met)


def _andere_sub_filter(andere: list[str]) -> str:
    if not andere:
        return "eigen sub_filter zonder thema-links"
    hosts = sorted({_host_en_pad(u)[0] or u[:40] for u in andere})
    return "sub_filter met andere links (" + ", ".join(hosts)[:120] + ")"


def _is_accept_encoding(st: Stelling) -> bool:
    """De oude en nieuwe manieren om Accept-Encoding leeg te maken (alleen op server-niveau)."""
    args = [a.lower() for a in st.args]
    if st.naam == "proxy_set_header":
        return len(args) == 2 and args[0] == "accept-encoding" and args[1] == ""
    if st.naam == "more_set_input_headers":
        return any(a.startswith("accept-encoding:") for a in args)
    if st.naam == "more_clear_input_headers":
        return args == ["accept-encoding"]
    return st.naam == "set" and args[:1] == ["$ct_ae"]


def _is_ct_ae_if(st: Stelling) -> bool:
    kinderen = st.kinderen or []
    return bool(kinderen) and all(k.naam == "set" and k.args[:1] == ["$ct_ae"] for k in kinderen)


def _vervangen(
    oud: str, weg: list[tuple[int, int]], commentaar: list[Commentaar], blok: str
) -> str:
    """Haalt de stukken `weg` weg en zet `blok` waar de eerste stond (anders achteraan).

    Een regel die daardoor leeg wordt (op commentaar na) verdwijnt helemaal. Wat op die regel
    vóór het eerste stuk staat (bv. de `}` van een location), blijft vóór het blok.
    """
    nl = "\r\n" if "\r\n" in oud else "\n"
    if not weg:
        return blok if not oud.strip() else oud.rstrip() + nl * 2 + blok
    gemarkeerd = bytearray(len(oud))
    for b, e in weg:
        while e < len(oud) and oud[e] in " \t":  # de spaties erna horen erbij
            e += 1
        gemarkeerd[b:e] = b"\x01" * (e - b)
    is_commentaar = bytearray(len(oud))
    for c in commentaar:
        is_commentaar[c.begin : c.einde] = b"\x01" * (c.einde - c.begin)
    uit: list[str] = []
    ingevoegd = False
    pos = 0
    for regel in oud.splitlines(keepends=True):
        bereik = range(pos, pos + len(regel))
        pos += len(regel)
        if not any(gemarkeerd[k] for k in bereik):
            uit.append(regel)
            continue
        if not ingevoegd:
            eerste = next(k for k in bereik if gemarkeerd[k])
            if oud[bereik.start : eerste].strip():
                uit.append(oud[bereik.start : eerste].rstrip() + nl)
                bereik = range(eerste, bereik.stop)
            uit.append(blok)
            ingevoegd = True
        rest = "".join(oud[k] for k in bereik if not gemarkeerd[k] and not is_commentaar[k])
        if rest.strip():
            behouden = "".join(oud[k] for k in bereik if not gemarkeerd[k])
            uit.append(re.sub(r"[ \t]+(?=\r?\n?$)", "", behouden))
    return "".join(uit)


# ---------------------------------------------------------------------------------------
# NPM-api (zelfde login als scripts/capture/vastleggen.py, dat zonder Playwright niet start)
# ---------------------------------------------------------------------------------------


def _http_json(
    url: str, data: dict[str, Any] | None = None, token: str | None = None, method: str = ""
) -> Any:
    headers = {"Accept": "application/json"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method or None)  # noqa: S310
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode())


def npm_login(base: str, gebruiker: str | None) -> str:
    """Logt in bij NPM en geeft het token; vraagt de code alleen als NPM 2FA vraagt."""
    gebruiker = gebruiker or os.environ.get("NPM_GEBRUIKER") or input("NPM e-mailadres: ").strip()
    wachtwoord = os.environ.get("NPM_WACHTWOORD") or getpass.getpass(
        "NPM wachtwoord (wordt niet bewaard): "
    )
    try:
        tok = _http_json(f"{base}/api/tokens", {"identity": gebruiker, "secret": wachtwoord})
    except urllib.error.HTTPError as e:
        sys.exit(f"Inloggen bij NPM mislukt ({e.code}). Klopt het adres ({base}) en je wachtwoord?")
    except (urllib.error.URLError, OSError) as e:
        sys.exit(
            f"NPM niet bereikbaar op {base}: {e}. "
            "Gebruik het adres van de NPM-beheerpagina, bv. http://192.168.1.10:81"
        )
    if isinstance(tok, dict) and tok.get("requires_2fa"):
        tok = npm_2fa(base, tok.get("challenge_token", ""))
    token = tok.get("token") if isinstance(tok, dict) else None
    if not token:
        sys.exit("NPM gaf geen token terug.")
    return str(token)


def npm_2fa(base: str, challenge: str) -> Any:
    """Tweestapsverificatie van NPM: de code uit je authenticator-app (of een herstelcode)."""
    for poging in range(3):
        code = (os.environ.get("NPM_CODE") if poging == 0 else None) or input(
            "NPM-code uit je authenticator-app: "
        )
        code = code.strip().replace(" ", "")
        try:
            return _http_json(
                f"{base}/api/tokens/2fa", {"challenge_token": challenge, "code": code}
            )
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403) and poging < 2:
                print("Die code klopt niet (of is verlopen). Probeer de volgende.")
                continue
            sys.exit(f"Tweestapsverificatie bij NPM mislukt ({e.code}).")
    sys.exit("Tweestapsverificatie bij NPM mislukt.")


class Npm:
    def __init__(self, base: str, token: str) -> None:
        self.base = base.rstrip("/")
        self.token = token

    def hosts(self) -> list[dict[str, Any]]:
        return list(_http_json(f"{self.base}/api/nginx/proxy-hosts", token=self.token))

    def host(self, host_id: int) -> dict[str, Any]:
        return dict(_http_json(f"{self.base}/api/nginx/proxy-hosts/{host_id}", token=self.token))

    def advanced_zetten(self, host_id: int, advanced: str) -> None:
        _http_json(
            f"{self.base}/api/nginx/proxy-hosts/{host_id}",
            {"advanced_config": advanced},
            token=self.token,
            method="PUT",
        )


def _npm_fout(e: Exception) -> str:
    if isinstance(e, urllib.error.HTTPError):
        try:
            bericht = json.loads(e.read().decode()).get("error", {}).get("message", "")
        except (ValueError, AttributeError, OSError):
            bericht = ""
        return f"HTTP {e.code} {bericht}".strip()
    return str(e)


# ---------------------------------------------------------------------------------------
# Plan, uitvoeren en terugzetten
# ---------------------------------------------------------------------------------------


@dataclass
class Plan:
    id: int
    namen: list[str]
    status: str  # "gewijzigd", "al goed" of "overgeslagen"
    reden: str = ""
    oud: str = ""
    nieuw: str = ""
    links: list[str] = field(default_factory=list)

    @property
    def naam(self) -> str:
        return self.namen[0] + (f" (+{len(self.namen) - 1})" if len(self.namen) > 1 else "")


def lijst(tekst: str | None) -> list[str]:
    """`a.be, b.be c.be` → ['a.be', 'b.be', 'c.be'] (komma's of spaties, zoals DASHBOARD_HOST)."""
    return [d.strip().lower() for d in re.split(r"[\s,;]+", tekst or "") if d.strip()]


def plan_maken(hosts: list[dict[str, Any]], args: argparse.Namespace) -> list[Plan]:
    css_host = (urlsplit(args.basis).hostname or "").lower()
    dashboard = set(lijst(args.dashboard))
    uitsluiten = lijst(args.uitsluiten)
    oude_hosts = {css_host, *dashboard, *lijst(args.oud_domein)} - {""}
    alleen = args.host.strip().lower() if args.host else ""
    plannen = []
    for h in hosts:
        namen = [str(d).lower() for d in h.get("domain_names") or []] or [f"id {h.get('id')}"]
        if alleen and alleen not in namen:
            continue
        oud = h.get("advanced_config") or ""
        p = Plan(int(h["id"]), namen, "overgeslagen", oud=oud)
        if css_host in namen:
            p.reden = "nooit: domein van --basis"
        elif dashboard & set(namen):
            p.reden = "nooit: dashboard (--dashboard)"
        elif any(u in n for u in uitsluiten for n in namen):
            p.reden = "uitgesloten (--uitsluiten)"
        else:
            p.links = oude_links(oud, oude_hosts)
            if not h.get("enabled", True):
                p.reden = "uitgeschakeld in NPM"
            elif (h.get("meta") or {}).get("nginx_online") is False:
                p.reden = "offline in NPM: eerst die fout oplossen"
            else:
                r = nieuwe_config(oud, args.basis, oude_hosts, met_script=args.met_script)
                if r.nieuw is None:
                    p.reden = r.reden
                elif r.nieuw == oud:
                    p.status = "al goed"
                else:
                    p.status, p.nieuw = "gewijzigd", r.nieuw
                    p.reden = _variant(r)
        plannen.append(p)
    plannen.sort(key=lambda p: p.namen[0])
    return plannen


def _variant(r: Resultaat) -> str:
    if not r.eigen_domein:
        return "hoofdregel"
    if r.met_script:
        return "eigen domein, CSS en script"
    return "eigen domein, alleen CSS" + (
        " (had ook een script: zie --met-script)" if r.had_script else ""
    )


def diff(oud: str, nieuw: str) -> str:
    """Alleen de gewijzigde regels, met één regel context: Advanced kan geheimen bevatten."""
    return "".join(
        difflib.unified_diff(
            oud.splitlines(keepends=True) if oud else [],
            nieuw.splitlines(keepends=True),
            "huidig",
            "nieuw",
            n=1,
        )
    ).replace("\r", "")


def plan_tonen(plannen: list[Plan]) -> None:
    for p in plannen:
        if p.status == "gewijzigd":
            print(f"\n=== {p.naam} (id {p.id}): {p.reden}")
            tekst = diff(p.oud, p.nieuw)
            print(tekst if tekst.endswith("\n") else tekst + "\n", end="")
    gewijzigd = [p for p in plannen if p.status == "gewijzigd"]
    al_goed = [p for p in plannen if p.status == "al goed"]
    over = [p for p in plannen if p.status == "overgeslagen"]
    eigen = sum(1 for p in gewijzigd if p.reden.startswith("eigen domein"))
    print("\nSamenvatting")
    print(
        f"  gewijzigd:    {len(gewijzigd)}"
        + (f" (waarvan {eigen} via eigen domein)" if eigen else "")
    )
    print(f"  al goed:      {len(al_goed)}")
    print(f"  overgeslagen: {len(over)}")
    breedte = max((len(p.naam) for p in over), default=0)
    for p in over:
        print(f"    {p.naam:<{breedte}}  {p.reden}")


def hosts_conf_schrijven(pad: Path, plannen: list[Plan]) -> int:
    """De oude links per host, als `# host` + `sub_filter`, voor Hosts > Importeren in cssthema."""
    regels = [
        f"# Oude thema-links uit NPM ({datetime.now():%Y-%m-%d %H:%M}), voor Hosts > Importeren\n"
    ]
    aantal = 0
    for p in plannen:
        namen = [n for n in p.namen if "*" not in n and not n.startswith("id ")]
        if not p.links or not namen:
            continue
        tags = "".join(
            f'<script src="{u}" defer></script>'
            if u.endswith(".js")
            else f'<link rel="stylesheet" href="{u}">'
            for u in p.links
        )
        regels.append(f"\n# {' '.join(namen)}\nsub_filter '</head>' '{tags}</head>';\n")
        aantal += 1
    pad.write_text("".join(regels), encoding="utf-8")
    return aantal


def backup_schrijven(pad: Path, npm: str, plannen: list[Plan]) -> None:
    """Advanced-config van elke host die verandert; mode 0600, want ze kan geheimen bevatten."""
    data = {
        "npm": npm,
        "gemaakt": datetime.now().isoformat(timespec="seconds"),
        "hosts": [{"id": p.id, "domain_names": p.namen, "advanced_config": p.oud} for p in plannen],
    }
    fd = os.open(pad, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


_NGINX_FOUT_RE = re.compile(r"\[(?:emerg|alert|crit|error)\]")


def zetten_en_controleren(npm: Npm, host_id: int, advanced: str) -> str:
    """Zet Advanced en kijkt of NPM de host online houdt; geeft "" of de fout van nginx."""
    npm.advanced_zetten(host_id, advanced)
    meta = npm.host(host_id).get("meta") or {}
    if meta.get("nginx_online") is True:
        return ""
    regels = [r.strip() for r in str(meta.get("nginx_err") or "").splitlines() if r.strip()]
    if not regels:
        return "NPM meldt nginx niet online"
    # De regel met [emerg] zegt wat er mis is; de laatste alleen dat de test mislukte.
    return next((r for r in regels if _NGINX_FOUT_RE.search(r)), regels[-1])[:300]


def toepassen(npm: Npm, plannen: list[Plan], backup: Path) -> int:
    gewijzigd = [p for p in plannen if p.status == "gewijzigd"]
    if not gewijzigd:
        print("\nNiets te veranderen.")
        return 0
    backup_schrijven(backup, npm.base, gewijzigd)
    print(f"\nBack-up van {len(gewijzigd)} hosts: {backup} (bewaar dit bestand; deel het niet)")
    for p in gewijzigd:
        print(f"  {p.naam} ...", end=" ", flush=True)
        try:
            fout = zetten_en_controleren(npm, p.id, p.nieuw)
        except (urllib.error.URLError, OSError, ValueError) as e:
            fout = _npm_fout(e)
        if not fout:
            print("ok")
            continue
        print(f"FOUT: {fout}")
        try:
            terug = zetten_en_controleren(npm, p.id, p.oud)
        except (urllib.error.URLError, OSError, ValueError) as e:
            terug = _npm_fout(e)
        if terug:
            print(f"  Terugzetten lukte niet ({terug}). Probeer: --terugzetten {backup}")
        else:
            print("  Oude Advanced-config teruggezet; de host is weer online.")
        print("Gestopt: de volgende hosts zijn niet aangeraakt. Los dit op of sluit de host uit.")
        return 1
    print(f"Klaar: {len(gewijzigd)} hosts gewijzigd. Terugzetten: --terugzetten {backup}")
    return 0


def terugzetten(npm: Npm, pad: Path, alleen: str) -> int:
    try:
        data = json.loads(pad.read_text(encoding="utf-8"))
        items = [
            (int(h["id"]), [str(d).lower() for d in h["domain_names"]], str(h["advanced_config"]))
            for h in data["hosts"]
        ]
    except (OSError, ValueError, KeyError, TypeError) as e:
        sys.exit(f"{pad} is geen back-up van regel.py ({e.__class__.__name__}).")
    if alleen:
        items = [i for i in items if alleen in i[1]]
        if not items:
            sys.exit(f"Geen host {alleen} in {pad}.")
    fouten = 0
    for host_id, namen, advanced in items:
        print(f"  {namen[0]} (id {host_id}) ...", end=" ", flush=True)
        try:
            huidig = npm.host(host_id)
            if [str(d).lower() for d in huidig.get("domain_names") or []] != namen:
                print("overgeslagen: die id hoort nu bij een andere host")
                fouten += 1
                continue
            if (huidig.get("advanced_config") or "") == advanced:
                print("al goed")
                continue
            fout = zetten_en_controleren(npm, host_id, advanced)
        except (urllib.error.URLError, OSError, ValueError) as e:
            fout = _npm_fout(e)
        print(f"FOUT: {fout}" if fout else "teruggezet")
        fouten += bool(fout)
    return 1 if fouten else 0


def main() -> None:
    p = argparse.ArgumentParser(
        description="Zet de cssthema-regel in de Advanced-config van je proxy hosts in NPM.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Voorbeeld (proefrun, verandert niets):\n"
            "  python regel.py --npm http://192.168.1.10:81 --basis https://css.jbogaert.be \\\n"
            "      --dashboard cssthema.jbogaert.be --uitsluiten authentik.jbogaert.be"
        ),
    )
    p.add_argument(
        "--npm", required=True, help="adres van de NPM-beheerpagina, bv. http://192.168.1.10:81"
    )
    p.add_argument("--npm-gebruiker", help="e-mailadres voor NPM (anders gevraagd)")
    p.add_argument("--basis", help="PUBLIC_BASE_URL van cssthema, bv. https://css.jbogaert.be")
    p.add_argument("--dashboard", help="DASHBOARD_HOST van cssthema, bv. cssthema.jbogaert.be")
    p.add_argument(
        "--uitsluiten", help="hosts waarvan de naam dit bevat niet aanraken (komma-gescheiden)"
    )
    p.add_argument("--oud-domein", help="extra domeinen waarvan links als oude thema-links tellen")
    p.add_argument(
        "--met-script", action="store_true", help="ook het script via het eigen domein (CSP-apps)"
    )
    p.add_argument("--host", help="alleen deze host (een van zijn domeinnamen)")
    p.add_argument(
        "--hosts-conf", type=Path, help="schrijf de oude links per host naar dit bestand"
    )
    p.add_argument("--toepassen", action="store_true", help="echt veranderen (anders alleen tonen)")
    p.add_argument(
        "--backup", type=Path, help="pad van de back-up (standaard npm-advanced-backup-<tijd>.json)"
    )
    p.add_argument(
        "--terugzetten",
        type=Path,
        metavar="BACKUP",
        help="zet de Advanced-config uit een back-up terug",
    )
    args = p.parse_args()
    for stroom in (sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError):
            stroom.reconfigure(errors="replace")  # type: ignore[union-attr]
    base = args.npm.rstrip("/")
    if not args.terugzetten:
        if not args.basis or not re.fullmatch(
            r"https?://[A-Za-z0-9.:\[\]-]+(/[A-Za-z0-9._~/-]*)?", args.basis
        ):
            p.error("geef --basis met de PUBLIC_BASE_URL van cssthema, bv. https://css.jbogaert.be")
        if not lijst(args.dashboard):
            p.error("geef --dashboard met de DASHBOARD_HOST van cssthema, bv. cssthema.jbogaert.be")
        args.basis = args.basis.rstrip("/")
        if args.backup and args.backup.exists():
            p.error(f"{args.backup} bestaat al")
    npm = Npm(base, npm_login(base, args.npm_gebruiker))
    if args.terugzetten:
        sys.exit(terugzetten(npm, args.terugzetten, (args.host or "").strip().lower()))
    try:
        hosts = npm.hosts()
    except (urllib.error.URLError, OSError, ValueError) as e:
        sys.exit(f"Proxy hosts ophalen mislukt: {_npm_fout(e)}")
    plannen = plan_maken(hosts, args)
    if args.host and not plannen:
        sys.exit(f"Geen proxy host met domeinnaam {args.host}.")
    print(f"NPM {base}: {len(hosts)} proxy hosts, {len(plannen)} bekeken")
    if args.met_script:
        print("Let op: --met-script geeft ook apps via het eigen domein cssthema-JavaScript.")
    if args.hosts_conf:
        aantal = hosts_conf_schrijven(args.hosts_conf, plannen)
        print(
            f"Oude links van {aantal} hosts in {args.hosts_conf} (Hosts > Importeren in cssthema)"
        )
    plan_tonen(plannen)
    if not args.toepassen:
        print("\nProefrun: er is niets veranderd. Met --toepassen voer je dit uit.")
        return
    backup = args.backup or Path(f"npm-advanced-backup-{datetime.now():%Y%m%d-%H%M%S}.json")
    sys.exit(toepassen(npm, plannen, backup))


if __name__ == "__main__":
    main()
