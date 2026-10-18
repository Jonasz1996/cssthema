"""Minifier op basis van tinycss2-tokens (docs/02 § 3.2, stap 4).

- Commentaar verdwijnt, behalve `/*! … */` (licenties, de cssthema-header).
- Witruimte wordt ingeklapt tot één spatie, en verdwijnt waar ze geen betekenis heeft:
  rond `{ } ; , > ~ / ! =`, na `:` en aan het begin en einde van een blok of functie.
  Rond `+` en `-` blijft ze staan: in `calc()` (ook via `var()` of een custom property)
  is ze verplicht. Vóór `:`, `*`, `[` en `(` blijft ze ook staan, want in een selector
  is die spatie een descendant-combinator (`a :hover` ≠ `a:hover`).
- Overbodige `;` in een blok (vooraan, dubbel, achteraan) verdwijnen.
- Strings en `url()` blijven letterlijk staan (ook hun escapes); tokens die door het
  weglaten van witruimte of commentaar zouden samensmelten, scheidt de serializer van
  tinycss2 met `/**/`, of we laten de spatie staan.

Idempotent: minify(minify(x)) == minify(x). Bedoeld voor CSS zonder syntaxfouten (de
linter controleert dat vóór het compileren); anders best effort.
"""

from collections.abc import Sequence

import tinycss2
from tinycss2.ast import (
    Comment,
    CurlyBracketsBlock,
    FunctionBlock,
    LiteralToken,
    Node,
    ParenthesesBlock,
    SquareBracketsBlock,
    WhitespaceToken,
)
from tinycss2.serializer import BAD_PAIRS

# Na deze tekens mag witruimte altijd weg.
_NO_SPACE_AFTER = frozenset({";", ",", ">", "~", "/", "!", ":", "="})
# Vóór deze tekens mag witruimte altijd weg (niet vóór ':' — selectors).
_NO_SPACE_BEFORE = frozenset({";", ",", ">", "~", "/", "!", "="})


def minify(css: str) -> str:
    """Geminificeerde CSS; zie de module-docstring voor de regels."""
    nodes = tinycss2.parse_component_value_list(css, skip_comments=False)
    return tinycss2.serialize(_minify_list(nodes, curly=False))


def _keep_comment(node: Node) -> bool:
    return isinstance(node, Comment) and node.value.startswith("!")


def _literal(node: Node | None) -> str | None:
    return node.value if isinstance(node, LiteralToken) else None


def _pair_type(node: Node) -> str:
    return node.value if isinstance(node, LiteralToken) else node.type


def _needs_space(previous: Node | None, following: Node | None) -> bool:
    if previous is None or following is None:
        return False
    if isinstance(previous, CurlyBracketsBlock) or isinstance(following, CurlyBracketsBlock):
        return False
    if _literal(previous) in _NO_SPACE_AFTER or _literal(following) in _NO_SPACE_BEFORE:
        # Weglaten, tenzij de twee tokens dan samensmelten (bv. `/` gevolgd door `*`).
        return (_pair_type(previous), _pair_type(following)) in BAD_PAIRS
    return True


def _minify_node(node: Node) -> Node:
    if isinstance(node, CurlyBracketsBlock):
        return CurlyBracketsBlock(
            node.source_line, node.source_column, _minify_list(node.content, curly=True)
        )
    if isinstance(node, ParenthesesBlock):
        return ParenthesesBlock(
            node.source_line, node.source_column, _minify_list(node.content, curly=False)
        )
    if isinstance(node, SquareBracketsBlock):
        return SquareBracketsBlock(
            node.source_line, node.source_column, _minify_list(node.content, curly=False)
        )
    if isinstance(node, FunctionBlock):
        return FunctionBlock(
            node.source_line,
            node.source_column,
            node.name,
            _minify_list(node.arguments, curly=False),
        )
    return node


def _minify_list(nodes: Sequence[Node], *, curly: bool) -> list[Node]:
    output: list[Node] = []
    previous: Node | None = None  # laatste betekenisvolle token in `output`
    pending_space = False
    carried: list[Node] = []  # bewaard commentaar, geplaatst vóór het volgende token

    for node in nodes:
        if isinstance(node, WhitespaceToken):
            pending_space = True
            continue
        if isinstance(node, Comment):
            if _keep_comment(node):
                carried.append(node)
            continue
        if curly and _literal(node) == ";" and (previous is None or _literal(previous) == ";"):
            # Lege declaratie: `{;…` of `;;`.
            pending_space = False
            continue
        if pending_space and _needs_space(previous, node):
            output.append(WhitespaceToken(node.source_line, node.source_column, " "))
        output.extend(carried)
        carried.clear()
        pending_space = False
        minified = _minify_node(node)
        output.append(minified)
        previous = minified

    if curly:
        # De laatste `;` in een blok is overbodig.
        for index in range(len(output) - 1, -1, -1):
            if _keep_comment(output[index]):
                continue
            if _literal(output[index]) == ";":
                del output[index]
            break
    output.extend(carried)
    return output
