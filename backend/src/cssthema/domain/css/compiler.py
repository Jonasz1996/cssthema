"""Compiler: palet + bron → geminificeerde CSS met header en SHA-256 (docs/02 § 3.2).

Stappen:
1. palet-tokens als `:root{--ct-<naam>:<waarde>;…}` vóór de bron, maar ná de leidende
   `@charset`-, `@import`-, `@layer`-statements en `@namespace`-regels: die moeten vóór
   alle andere regels staan, anders negeert de browser ze;
2. minify;
3. header `/*! cssthema · <slug> · v<n> · <tijd> · sha256:<12 hex> */` + newline, met de
   hash van de geminificeerde body;
4. `sha256` over het eindresultaat (UTF-8) → ETag.

Wordt alleen aangeroepen voor CSS die door de linter komt (geen `</` buiten strings en
`url()`). Elke `</` in het resultaat wordt ge-escapet als `\\3c /` (in strings en `url()`
betekent dat hetzelfde), zodat de CSS nooit uit een `<style>`-blok kan breken. Een losse
`<`, zoals in `@media (width < 600px)`, blijft staan.
"""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import tinycss2
from tinycss2.ast import AtKeywordToken, Node

from cssthema.domain.css.minify import minify
from cssthema.domain.palettes.builtin import palette_to_css_vars


@dataclass(frozen=True, slots=True)
class CompiledCss:
    css: str
    sha256: bytes
    size_bytes: int

    @property
    def sha256_hex(self) -> str:
        return self.sha256.hex()


def compile_css(
    source: str,
    *,
    slug: str,
    version_number: int,
    published_at: datetime,
    palette_tokens: Mapping[str, str] | None,
) -> CompiledCss:
    if palette_tokens:
        head, tail = split_leading_statements(source)
        parts = (head, palette_to_css_vars(palette_tokens), tail)
        source = "\n".join(part for part in parts if part)
    body = minify(source).replace("</", "\\3c /")
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
    stamp = _utc(published_at).strftime("%Y-%m-%dT%H:%MZ")
    header = f"/*! cssthema · {slug} · v{version_number} · {stamp} · sha256:{body_hash} */\n"
    css = header + body
    encoded = css.encode("utf-8")
    return CompiledCss(css=css, sha256=hashlib.sha256(encoded).digest(), size_bytes=len(encoded))


# Regels die vóór alle andere regels moeten staan (CSS Cascade 5 § 6.1, CSS Namespaces).
_LEADING_AT_RULES = frozenset({"charset", "import", "layer", "namespace"})


def split_leading_statements(source: str) -> tuple[str, str]:
    """Splitst de bron in (leidende `@charset`/`@import`/`@layer;`/`@namespace`, rest).

    Commentaar en witruimte tussen die regels horen bij het eerste deel. Een `@layer`
    met een blok is geen statement en hoort bij de rest.
    """
    nodes = tinycss2.parse_component_value_list(source, skip_comments=False)
    split = _end_of_leading_statements(nodes)
    if split == 0:
        return "", source
    head = tinycss2.serialize(nodes[:split])
    if split == len(nodes) and not head.rstrip().endswith(";"):
        # Het laatste statement eindigt op EOF zonder `;`: afsluiten, anders hoort wat
        # erachter komt bij zijn prelude.
        head += ";"
    return head, tinycss2.serialize(nodes[split:])


def _end_of_leading_statements(nodes: Sequence[Node]) -> int:
    split = 0
    index = 0
    while index < len(nodes):
        node = nodes[index]
        if node.type in ("whitespace", "comment"):
            index += 1
            continue
        if not (isinstance(node, AtKeywordToken) and node.lower_value in _LEADING_AT_RULES):
            break
        end = index + 1
        while end < len(nodes) and not (
            nodes[end].type == "literal" and getattr(nodes[end], "value", None) == ";"
        ):
            if nodes[end].type == "{} block":
                return split  # `@layer x { … }` (of iets ongeldigs): geen statement
            end += 1
        if end >= len(nodes):
            return len(nodes)  # het laatste statement eindigt op EOF zonder `;`
        index = split = end + 1
    return split


def etag_for(sha256: bytes) -> str:
    """Sterke ETag voor publieke CSS: `"sha256-<eerste 16 hex>"`."""
    return f'"sha256-{sha256.hex()[:16]}"'


def _utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)
