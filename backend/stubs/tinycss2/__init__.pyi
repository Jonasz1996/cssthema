# Minimale type-stubs voor tinycss2; zie ast.pyi.

from collections.abc import Iterable

from tinycss2.ast import Node

__version__: str

def parse_component_value_list(css: str, skip_comments: bool = False) -> list[Node]: ...
def parse_stylesheet(
    input: str | Iterable[Node], skip_comments: bool = False, skip_whitespace: bool = False
) -> list[Node]: ...
def parse_blocks_contents(
    input: str | Iterable[Node], skip_comments: bool = False, skip_whitespace: bool = False
) -> list[Node]: ...
def parse_rule_list(
    input: str | Iterable[Node], skip_comments: bool = False, skip_whitespace: bool = False
) -> list[Node]: ...
def parse_declaration_list(
    input: str | Iterable[Node], skip_comments: bool = False, skip_whitespace: bool = False
) -> list[Node]: ...
def serialize(nodes: Iterable[Node]) -> str: ...
