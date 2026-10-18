from cssthema.domain.css.diff import unified_diff


def test_unified_diff_counts_changed_lines() -> None:
    a = "a{color:red}\nb{color:blue}\nc{}\n"
    b = "a{color:red}\nb{color:green}\nc{}\nd{}\n"
    result = unified_diff(a, b, from_label="v1", to_label="draft")
    assert result.unified.startswith("--- v1\n+++ draft\n")
    assert "-b{color:blue}" in result.unified
    assert "+b{color:green}" in result.unified
    assert (result.added, result.removed) == (2, 1)


def test_identical_texts_give_an_empty_diff() -> None:
    result = unified_diff("a{}", "a{}", from_label="v1", to_label="v2")
    assert (result.unified, result.added, result.removed) == ("", 0, 0)


def test_lines_starting_with_dashes_are_counted_once() -> None:
    result = unified_diff("--x: 1;\n", "--x: 2;\n", from_label="v1", to_label="v2")
    assert (result.added, result.removed) == (1, 1)
