"""CSS-linter met security-regels (docs/02 § 3.2, F-ED-03, F-ED-05).

Fouten (`severity="error"`) blokkeren publiceren:

- `parse-error`: syntaxfouten (niet-gesloten blok, string, commentaar of `url(`, losse
  sluithaakjes, ongeldige declaraties en regels);
- `external-import`: `@import` van een host buiten de allowlist;
- `external-url`: `url()`, `image-set()`, … naar een host buiten de allowlist. Toegestaan
  zijn `data:`, relatieve paden, `#fragment` en hosts uit de allowlist. Strings die via
  substitutie (`var()`, `env()`, `if()`, custom properties, `@property`, `@function`) in
  `image-set()` of `src()` kunnen belanden, moeten ook relatief of toegestaan zijn;
- `script-vector`: `expression(`, `behavior`, `-moz-binding`, `javascript:`/`vbscript:`;
- `html-in-css`: de reeks `</` buiten strings, `url()` en commentaar (geen geldige CSS en
  een poging om uit een `<style>`-blok te breken). Binnen strings en `url()` mag `<` wel,
  bv. voor inline SVG's; de compiler escapet `</` daar als `\\3c /`. Een losse `<`, zoals
  in `@media (width < 600px)`, is toegestaan;
- `too-large`: groter dan de limiet (dan wordt verder niets gecontroleerd).

Waarschuwingen: `unknown-property`, `empty-rule`, `duplicate-selector`, `misplaced-import`
(een `@import` na andere regels of in een blok: de browser negeert die).

Regels en kolommen zijn 1-based, zoals in Monaco. Puur: geen I/O.
"""

import bisect
import re
from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

import tinycss2
from tinycss2.ast import (
    AtKeywordToken,
    AtRule,
    Declaration,
    FunctionBlock,
    IdentToken,
    Node,
    ParseError,
    QualifiedRule,
    StringToken,
    URLToken,
)

from cssthema.domain.css.known_properties import is_known_property

Severity = Literal["error", "warning"]

# Bovengrens per regel en in totaal, zodat een plak van 500 KB vol `<` geen
# honderdduizenden meldingen oplevert.
MAX_ISSUES_PER_RULE = 100
MAX_ISSUES_TOTAL = 500

_SCRIPT_PROPERTIES = frozenset({"behavior", "-ms-behavior", "-moz-binding"})
_URL_FUNCTIONS = frozenset({"url", "src"})
# Functies waarin een string-argument als URL geladen wordt.
_IMAGE_FUNCTIONS = frozenset(
    {"image-set", "-webkit-image-set", "image", "cross-fade", "-webkit-cross-fade"}
)
# Functies waarvan de argumenten (fallbacks) via substitutie ergens anders belanden,
# bv. `image-set(var(--x, "https://…") 1x)`. Ook `--naam(…)` (custom functions).
_SUBSTITUTION_FUNCTIONS = frozenset({"var", "env", "if", "attr", "inherit"})
# At-rules waarvan het blok waarden levert voor substitutie (`initial-value`, `result`).
_SUBSTITUTION_AT_RULES = frozenset({"property", "function", "mixin"})
# Schema's die in een substitutie-context als URL tellen. Andere ("Tip: lees dit") laden
# niets en zijn gewone tekst.
_SUBSTITUTED_URL_SCHEMES = frozenset(
    {"http", "https", "ftp", "ftps", "ws", "wss", "file", "blob", "filesystem"}
    | {"javascript", "vbscript"}
)
# At-rules waarvan de prelude URL's bevat die niet geladen worden.
_NON_FETCHING_PRELUDES = frozenset({"namespace", "document", "-moz-document"})
_GROUPING_AT_RULES = frozenset(
    {
        "media",
        "supports",
        "container",
        "layer",
        "scope",
        "starting-style",
        "document",
        "-moz-document",
    }
)
_KEYFRAMES_AT_RULES = frozenset({"keyframes", "-webkit-keyframes", "-moz-keyframes"})
_SCHEME_RE = re.compile(r"^([a-z][a-z0-9+.\-]*):")
_STRIPPED_FROM_URLS = re.compile(r"[\t\n\r]")
_C0_AND_SPACE = "".join(chr(code) for code in range(0x21))
_SCRIPT_URL_RE = re.compile(r"[\s\x00-\x1f]*(?:java|vb)[\t\n\r]*script[\t\n\r]*:", re.IGNORECASE)
_SELECTOR_WS = re.compile(r"\s+")
_SELECTOR_COMBINATOR = re.compile(r"\s*([>+~,])\s*")
_CLOSERS = {"{": "}", "(": ")", "[": "]"}
_OPENERS = {closer: opener for opener, closer in _CLOSERS.items()}


@dataclass(frozen=True, slots=True)
class LintIssue:
    line: int
    column: int
    rule: str
    severity: Severity
    message: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class LintResult:
    errors: tuple[LintIssue, ...]
    warnings: tuple[LintIssue, ...]
    size_bytes: int

    @property
    def ok(self) -> bool:
        return not self.errors


def preprocess(css: str) -> str:
    """Dezelfde voorbewerking als tinycss2, zodat posities overeenkomen."""
    return css.replace("\0", "�").replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")


def lint(css: str, *, allowed_hosts: Collection[str], max_bytes: int) -> LintResult:
    """Controleert CSS; lege CSS is in orde."""
    size_bytes = len(css.encode("utf-8"))
    collector = _Collector()
    if size_bytes > max_bytes:
        collector.error(
            1,
            1,
            "too-large",
            f"De CSS is {_kb(size_bytes)} groot; de limiet is {_kb(max_bytes)}.",
        )
        return collector.result(size_bytes)

    source = preprocess(css)
    if source.strip():
        hosts = frozenset(host.lower().rstrip(".") for host in allowed_hosts)
        lines = _LineIndex(source)
        _scan_source(source, lines, collector)
        tokens = tinycss2.parse_component_value_list(source)
        _TokenChecker(hosts, collector).walk(tokens)
        _RuleChecker(collector).check_block(
            tinycss2.parse_stylesheet(tokens, skip_comments=True, skip_whitespace=True),
            kind="stylesheet",
            top_level=True,
        )
    return collector.result(size_bytes)


def classify_url(raw: str, allowed_hosts: Collection[str]) -> tuple[str, str] | None:
    """`None` als de URL mag, anders `(regel, melding)`.

    Volgt de URL-parser van browsers op de punten die ertoe doen: tabs en regeleinden
    tellen niet mee, `\\` is een `/`, en na `http:`/`https:` of aan het begin van een
    relatieve URL leiden één of meer slashes naar een (externe) host.
    """
    value = _normalize_url(raw)
    lower = value.lower()
    if not lower or lower.startswith("#"):
        return None
    match = _SCHEME_RE.match(lower)
    if match:
        scheme = match.group(1)
        if scheme == "data":
            return None
        if scheme in ("javascript", "vbscript"):
            return "script-vector", f"Een {scheme}:-URL is niet toegestaan."
        if scheme not in ("http", "https"):
            return "external-url", f"Het URL-schema '{scheme}:' is niet toegestaan."
        authority = value[len(scheme) + 1 :].lstrip("/")
    elif lower.startswith("//"):
        authority = value.lstrip("/")
    else:
        return None  # relatief pad: dezelfde host als de CSS zelf

    host = _hostname(authority)
    if host is not None and host in allowed_hosts:
        return None
    shown = host or "een onbekende host"
    return "external-url", f"Een URL naar {shown} is niet toegestaan (niet in de allowlist)."


def _normalize_url(raw: str) -> str:
    """Zoals de URL-parser: tabs/regeleinden weg, C0 en spaties aan de randen weg, `\\` → `/`."""
    return _STRIPPED_FROM_URLS.sub("", raw).strip(_C0_AND_SPACE).replace("\\", "/")


def _looks_like_absolute_url(raw: str) -> bool:
    """Zou deze string, als URL gebruikt, een andere host of een script-schema raken?"""
    lower = _normalize_url(raw).lower()
    if lower.startswith("//"):
        return True
    match = _SCHEME_RE.match(lower)
    return match is not None and match.group(1) in _SUBSTITUTED_URL_SCHEMES


def _hostname(authority: str) -> str | None:
    try:
        host = urlsplit("https://" + authority).hostname
    except ValueError:
        return None
    return host.rstrip(".") if host else None


def _kb(size: int) -> str:
    return f"{size / 1024:.0f} KB" if size >= 1024 else f"{size} bytes"


class _Collector:
    """Verzamelt meldingen: ontdubbeld per positie en regel, met bovengrenzen."""

    def __init__(self) -> None:
        self._issues: dict[tuple[int, int, str], LintIssue] = {}
        self._per_rule: dict[str, int] = {}
        # Posities waar al een syntaxfout gemeld is (ook door een andere bron).
        self._parse_error_positions: set[tuple[int, int]] = set()

    def error(self, line: int, column: int, rule: str, message: str) -> None:
        self._add(LintIssue(line, column, rule, "error", message))

    def warning(self, line: int, column: int, rule: str, message: str) -> None:
        self._add(LintIssue(line, column, rule, "warning", message))

    def parse_error(self, line: int, column: int, message: str) -> None:
        if (line, column) in self._parse_error_positions:
            return
        self._parse_error_positions.add((line, column))
        self.error(line, column, "parse-error", message)

    def _add(self, issue: LintIssue) -> None:
        key = (issue.line, issue.column, issue.rule)
        if key in self._issues or len(self._issues) >= MAX_ISSUES_TOTAL:
            return
        count = self._per_rule.get(issue.rule, 0)
        if count >= MAX_ISSUES_PER_RULE:
            return
        self._per_rule[issue.rule] = count + 1
        self._issues[key] = issue

    def result(self, size_bytes: int) -> LintResult:
        issues = sorted(self._issues.values(), key=lambda i: (i.line, i.column, i.rule))
        return LintResult(
            errors=tuple(i for i in issues if i.severity == "error"),
            warnings=tuple(i for i in issues if i.severity == "warning"),
            size_bytes=size_bytes,
        )


class _LineIndex:
    """Zet een tekenpositie om naar (regel, kolom), beide 1-based."""

    def __init__(self, source: str) -> None:
        self._newlines = [i for i, char in enumerate(source) if char == "\n"]

    def position(self, offset: int) -> tuple[int, int]:
        index = bisect.bisect_left(self._newlines, offset)
        line_start = self._newlines[index - 1] + 1 if index else 0
        return index + 1, offset - line_start + 1


def _is_name_char(char: str) -> bool:
    return char.isalnum() or char in "-_" or ord(char) >= 0x80


def _scan_source(source: str, lines: _LineIndex, collector: _Collector) -> None:
    """Structuur (blokken, strings, commentaar, `url(`) en `</` buiten strings en `url(`."""

    def report(offset: int, message: str) -> None:
        collector.parse_error(*lines.position(offset), message)

    def html(offset: int, message: str) -> None:
        collector.error(*lines.position(offset), "html-in-css", message)

    length = len(source)
    stack: list[tuple[str, int]] = []
    index = 0
    while index < length:
        char = source[index]
        if char == "/" and source.startswith("*", index + 1):
            end = source.find("*/", index + 2)
            if end == -1:
                report(index, "Commentaar wordt niet afgesloten met */.")
                return _report_unclosed(stack, report)
            index = end + 2
            continue
        if char in "\"'":
            index = _scan_string(source, index, report)
            continue
        if char == "\\":
            index += 2
            continue
        if char == "<" and source.startswith("/", index + 1):
            html(index, "De reeks '</' is niet toegestaan buiten strings en url().")
            index += 2
            continue
        if (
            char in "uU"
            and source[index : index + 4].lower() == "url("
            and (index == 0 or not _is_name_char(source[index - 1]))
        ):
            content = index + 4
            while content < length and source[content] in " \t\n":
                content += 1
            if content < length and source[content] not in "\"'":
                end = content
                while end < length and source[end] != ")":
                    if source[end] == "\\":
                        end += 2
                        continue
                    end += 1
                if end >= length:
                    report(index, "url( wordt niet afgesloten met ).")
                    return _report_unclosed(stack, report)
                if _SCRIPT_URL_RE.match(source, content, end):
                    # Ook als de url ongeldig is (bv. haakjes erin), want een browser
                    # leest misschien meer dan de parser.
                    collector.error(
                        *lines.position(index),
                        "script-vector",
                        "Een javascript:- of vbscript:-URL is niet toegestaan.",
                    )
                index = end + 1
                continue
            stack.append(("(", index + 3))
            index += 4
            continue
        if char in _CLOSERS:
            stack.append((char, index))
        elif char in _OPENERS:
            opener = _OPENERS[char]
            if stack and stack[-1][0] == opener:
                stack.pop()
            elif any(open_char == opener for open_char, _ in stack):
                while stack[-1][0] != opener:
                    open_char, offset = stack.pop()
                    report(
                        offset, f"'{open_char}' wordt niet gesloten met '{_CLOSERS[open_char]}'."
                    )
                stack.pop()
            else:
                report(index, f"Onverwachte '{char}' zonder bijbehorende '{opener}'.")
        index += 1
    _report_unclosed(stack, report)


def _scan_string(
    source: str,
    start: int,
    report: Callable[[int, str], None],
) -> int:
    """Slaat een string over en geeft de positie erna terug."""
    quote = source[start]
    index = start + 1
    while index < len(source):
        char = source[index]
        if char == "\\":
            index += 2
            continue
        if char == quote:
            return index + 1
        if char == "\n":
            report(start, "String wordt niet afgesloten voor het einde van de regel.")
            return index + 1
        index += 1
    report(start, "String wordt niet afgesloten.")
    return len(source)


def _report_unclosed(stack: list[tuple[str, int]], report: Callable[[int, str], None]) -> None:
    for open_char, offset in stack:
        report(offset, f"'{open_char}' wordt niet gesloten met '{_CLOSERS[open_char]}'.")


_SCANNED_TOKEN_ERRORS = frozenset({")", "]", "}", "bad-string", "eof-in-string", "eof-in-url"})
_TOKEN_ERROR_MESSAGES = {
    "bad-url": "Ongeldige url(): zet de URL tussen aanhalingstekens.",
    "bad-string": "String wordt niet afgesloten voor het einde van de regel.",
    "eof-in-string": "String wordt niet afgesloten.",
    "eof-in-url": "url( wordt niet afgesloten met ).",
}


def _parse_error_message(error: ParseError) -> str:
    if error.kind in _TOKEN_ERROR_MESSAGES:
        return _TOKEN_ERROR_MESSAGES[error.kind]
    if error.kind in _OPENERS:
        return f"Onverwachte '{error.kind}' zonder bijbehorende '{_OPENERS[error.kind]}'."
    message = error.message
    if "before {} block" in message:
        return (
            "Ongeldige regel: een selector zonder blok { … }, of een declaratie zonder "
            "dubbele punt."
        )
    if "declaration name" in message:
        return "Ongeldige declaratie: verwacht 'property: waarde'."
    return f"Ongeldige CSS ({message})."


def _significant(nodes: Sequence[Node], start: int) -> int | None:
    """Index van het eerste token vanaf `start` dat geen witruimte of commentaar is."""
    for index in range(start, len(nodes)):
        if nodes[index].type not in ("whitespace", "comment"):
            return index
    return None


def _is_literal(node: Node | None, value: str) -> bool:
    return node is not None and node.type == "literal" and getattr(node, "value", None) == value


class _TokenChecker:
    """Security-regels op de volledige tokenstroom, los van de regelstructuur.

    Zo wordt een URL ook gevonden als hij in een constructie staat die de parser als
    ongeldig beschouwt maar een browser misschien toch leest.
    """

    def __init__(self, allowed_hosts: frozenset[str], collector: _Collector) -> None:
        self.allowed_hosts = allowed_hosts
        self.collector = collector

    def walk(self, nodes: Sequence[Node], *, substituted: bool = False) -> None:
        """Loopt de tokens af.

        `substituted`: deze tokens kunnen via substitutie (custom property, fallback van
        `var()`, `@property`, …) in een URL-context belanden, op elk nestniveau. Strings
        worden dan gecontroleerd als ze op een absolute URL lijken.
        """
        index = 0
        custom_property_end = -1
        while index < len(nodes):
            node = nodes[index]
            inside = substituted or index < custom_property_end
            if isinstance(node, ParseError):
                # Haakjes, strings en `url(` controleert _scan_source al (met betere
                # meldingen); van de tokenizer nemen we alleen ongeldige url's over.
                if node.kind not in _SCANNED_TOKEN_ERRORS:
                    self.collector.parse_error(
                        node.source_line, node.source_column, _parse_error_message(node)
                    )
            elif isinstance(node, AtKeywordToken):
                index = self._at_keyword(nodes, index, substituted=inside)
                continue
            elif isinstance(node, IdentToken):
                after = _significant(nodes, index + 1)
                if after is not None and _is_literal(nodes[after], ":"):
                    if node.lower_value in _SCRIPT_PROPERTIES:
                        self._error(node, "script-vector", f"'{node.value}' is niet toegestaan.")
                    if node.value.startswith("--"):
                        custom_property_end = self._end_of_declaration(nodes, after)
            elif isinstance(node, StringToken) and inside:
                # Een string in een custom property kan via image-set(var(--x)) als
                # URL geladen worden; alleen absolute URL's zijn hier verdacht.
                self._check_url(node, node.value, only_absolute=True)
            elif isinstance(node, URLToken):
                self._check_url(node, node.value)
            elif isinstance(node, FunctionBlock):
                self._function(node, substituted=inside)
            else:
                content = getattr(node, "content", None)
                if isinstance(content, list):
                    self.walk(content, substituted=inside)
            index += 1

    def _at_keyword(self, nodes: Sequence[Node], index: int, *, substituted: bool) -> int:
        keyword = nodes[index]
        assert isinstance(keyword, AtKeywordToken)
        name = keyword.lower_value
        if name in _SUBSTITUTION_AT_RULES:
            # `@property --x { initial-value: "…" }` en `@function --f() { result: "…" }`
            # leveren waarden voor var(--x) / --f(): het hele blok telt als substitutie.
            end = index + 1
            while end < len(nodes) and not _is_literal(nodes[end], ";"):
                node = nodes[end]
                if node.type == "{} block":
                    self.walk(nodes[index + 1 : end], substituted=substituted)
                    self.walk(getattr(node, "content", None) or [], substituted=True)
                    return end + 1
                end += 1
            return index + 1
        if name == "import":
            target = _significant(nodes, index + 1)
            if target is not None:
                url = self._url_of(nodes[target])
                if url is not None:
                    problem = classify_url(url, self.allowed_hosts)
                    if problem is not None:
                        rule, message = problem
                        if rule == "external-url":
                            rule, message = "external-import", "@import: " + message
                        self._error(nodes[target], rule, message)
                    return target + 1
        elif name in _NON_FETCHING_PRELUDES:
            # De prelude van @namespace/@document bevat URL's die niet geladen worden;
            # het blok van @document wordt wel gecontroleerd.
            end = index + 1
            while end < len(nodes) and not _is_literal(nodes[end], ";"):
                if nodes[end].type == "{} block":
                    break
                end += 1
            return end
        return index + 1

    def _function(self, node: FunctionBlock, *, substituted: bool) -> None:
        name = node.lower_name
        if name == "expression":
            self._error(node, "script-vector", "expression() is niet toegestaan.")
        elif name in _URL_FUNCTIONS:
            first = _significant(node.arguments, 0)
            if first is not None and isinstance(node.arguments[first], StringToken):
                string = node.arguments[first]
                assert isinstance(string, StringToken)
                self._check_url(string, string.value)
        elif name in _IMAGE_FUNCTIONS:
            for argument in node.arguments:
                if isinstance(argument, StringToken):
                    self._check_url(argument, argument.value)
        if name in _SUBSTITUTION_FUNCTIONS or name.startswith("--"):
            substituted = True
        self.walk(node.arguments, substituted=substituted)

    @staticmethod
    def _url_of(node: Node) -> str | None:
        if isinstance(node, URLToken | StringToken):
            return node.value
        if isinstance(node, FunctionBlock) and node.lower_name in _URL_FUNCTIONS:
            first = _significant(node.arguments, 0)
            if first is not None:
                argument = node.arguments[first]
                if isinstance(argument, StringToken):
                    return argument.value
        return None

    @staticmethod
    def _end_of_declaration(nodes: Sequence[Node], start: int) -> int:
        for index in range(start, len(nodes)):
            if _is_literal(nodes[index], ";"):
                return index
        return len(nodes)

    def _check_url(self, node: Node, url: str, *, only_absolute: bool = False) -> None:
        if only_absolute and not _looks_like_absolute_url(url):
            return
        problem = classify_url(url, self.allowed_hosts)
        if problem is not None:
            self._error(node, *problem)

    def _error(self, node: Node, rule: str, message: str) -> None:
        self.collector.error(node.source_line, node.source_column, rule, message)


class _RuleChecker:
    """Structuurregels: syntaxfouten, onbekende properties, lege en dubbele regels."""

    def __init__(self, collector: _Collector) -> None:
        self.collector = collector

    def check_block(self, nodes: Iterable[Node], *, kind: str, top_level: bool = False) -> None:
        seen_selectors: dict[str, int] = {}
        # Telt een @import hier niet (meer)? Alleen bovenaan het stylesheet, vóór andere regels.
        imports_closed = not top_level
        for node in nodes:
            if isinstance(node, AtRule) and node.lower_at_keyword == "import":
                if imports_closed:
                    self.collector.warning(
                        node.source_line,
                        node.source_column,
                        "misplaced-import",
                        "Deze @import wordt genegeerd: @import moet bovenaan staan, "
                        "vóór alle andere regels (behalve @charset en @layer a, b;).",
                    )
                continue
            if isinstance(node, AtRule | QualifiedRule) and not _may_precede_import(node):
                imports_closed = True
            if isinstance(node, ParseError):
                self.collector.parse_error(
                    node.source_line, node.source_column, _parse_error_message(node)
                )
            elif isinstance(node, Declaration):
                if not is_known_property(node.name):
                    self.collector.warning(
                        node.source_line,
                        node.source_column,
                        "unknown-property",
                        f"Onbekende property '{node.name}'.",
                    )
            elif isinstance(node, QualifiedRule):
                if kind != "keyframes":
                    self._check_duplicate(node, seen_selectors)
                self._check_contents(
                    node, node.content, kind="keyframe" if kind == "keyframes" else "style"
                )
            elif isinstance(node, AtRule) and node.content is not None:
                name = node.lower_at_keyword
                if name in _GROUPING_AT_RULES:
                    self._check_contents(node, node.content, kind=kind)
                elif name in _KEYFRAMES_AT_RULES:
                    self._check_contents(node, node.content, kind="keyframes")
                else:
                    self._check_contents(node, node.content, kind="descriptors")

    def _check_contents(self, owner: Node, content: list[Node], *, kind: str) -> None:
        children = tinycss2.parse_blocks_contents(content, skip_comments=True, skip_whitespace=True)
        if not children:
            label = f"@{owner.lower_at_keyword}" if isinstance(owner, AtRule) else "Deze regel"
            self.collector.warning(
                owner.source_line, owner.source_column, "empty-rule", f"{label} is leeg."
            )
            return
        self.check_block(children, kind=kind)

    def _check_duplicate(self, rule: QualifiedRule, seen: dict[str, int]) -> None:
        selector = normalize_selector(rule.prelude)
        if not selector:
            return
        first_line = seen.get(selector)
        if first_line is None:
            seen[selector] = rule.source_line
            return
        self.collector.warning(
            rule.source_line,
            rule.source_column,
            "duplicate-selector",
            f"Selector '{selector}' staat al op regel {first_line}; voeg de regels samen.",
        )


def _may_precede_import(node: AtRule | QualifiedRule) -> bool:
    """Regels die vóór een @import mogen staan: @charset en @layer-statements."""
    if not isinstance(node, AtRule):
        return False
    name = node.lower_at_keyword
    return name == "charset" or (name == "layer" and node.content is None)


def normalize_selector(prelude: Iterable[Node]) -> str:
    """Selectortekst met genormaliseerde witruimte, om dubbele selectors te vinden."""
    parts = [
        " " if node.type == "whitespace" else node.serialize()
        for node in prelude
        if node.type != "comment"
    ]
    text = _SELECTOR_WS.sub(" ", "".join(parts)).strip()
    return _SELECTOR_COMBINATOR.sub(r"\1", text)


def issues_to_dicts(issues: Iterable[LintIssue]) -> list[dict[str, Any]]:
    """Voor opslag in JSONB (`theme_versions.lint_warnings`) en Problem Details."""
    return [issue.to_dict() for issue in issues]
