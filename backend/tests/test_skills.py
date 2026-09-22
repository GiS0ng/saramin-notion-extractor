import pytest

from app.skills import normalize_skill_name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Python", "Python"),
        ("C++", "C++"),
        ("PowerBI", "Power BI"),
        ("BI 툴", "Power BI"),
        ("python", "Python"),
        ("machine-learning", None),
        ("CMake", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_skill_name(raw: str | None, expected: str | None) -> None:
    assert normalize_skill_name(raw) == expected
