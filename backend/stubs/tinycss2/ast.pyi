# Minimale type-stubs voor tinycss2 (het pakket levert geen typehints mee). Alleen wat
# cssthema gebruikt; zie https://doc.courtbouillon.org/tinycss2/stable/api_reference.html

from collections.abc import Callable

class Node:
    type: str
    source_line: int
    source_column: int
    def __init__(self, source_line: int, source_column: int) -> None: ...
    def serialize(self) -> str: ...
    def _serialize_to(self, write: Callable[[str], object]) -> None: ...

class ParseError(Node):
    kind: str
    message: str
    def __init__(self, line: int, column: int, kind: str, message: str) -> None: ...

class Comment(Node):
    value: str
    def __init__(self, line: int, column: int, value: str) -> None: ...

class WhitespaceToken(Node):
    value: str
    def __init__(self, line: int, column: int, value: str) -> None: ...

class LiteralToken(Node):
    value: str
    def __init__(self, line: int, column: int, value: str) -> None: ...

class IdentToken(Node):
    value: str
    lower_value: str
    def __init__(self, line: int, column: int, value: str) -> None: ...

class AtKeywordToken(Node):
    value: str
    lower_value: str
    def __init__(self, line: int, column: int, value: str) -> None: ...

class HashToken(Node):
    value: str
    is_identifier: bool
    def __init__(self, line: int, column: int, value: str, is_identifier: bool) -> None: ...

class StringToken(Node):
    value: str
    representation: str
    def __init__(self, line: int, column: int, value: str, representation: str) -> None: ...

class URLToken(Node):
    value: str
    representation: str
    def __init__(self, line: int, column: int, value: str, representation: str) -> None: ...

class UnicodeRangeToken(Node):
    start: int
    end: int

class NumberToken(Node):
    value: float
    int_value: int | None
    is_integer: bool
    representation: str

class PercentageToken(Node):
    value: float
    int_value: int | None
    is_integer: bool
    representation: str

class DimensionToken(Node):
    value: float
    int_value: int | None
    is_integer: bool
    representation: str
    unit: str
    lower_unit: str

class ParenthesesBlock(Node):
    content: list[Node]
    def __init__(self, line: int, column: int, content: list[Node]) -> None: ...

class SquareBracketsBlock(Node):
    content: list[Node]
    def __init__(self, line: int, column: int, content: list[Node]) -> None: ...

class CurlyBracketsBlock(Node):
    content: list[Node]
    def __init__(self, line: int, column: int, content: list[Node]) -> None: ...

class FunctionBlock(Node):
    name: str
    lower_name: str
    arguments: list[Node]
    def __init__(self, line: int, column: int, name: str, arguments: list[Node]) -> None: ...

class Declaration(Node):
    name: str
    lower_name: str
    value: list[Node]
    important: bool

class QualifiedRule(Node):
    prelude: list[Node]
    content: list[Node]

class AtRule(Node):
    at_keyword: str
    lower_at_keyword: str
    prelude: list[Node]
    content: list[Node] | None
