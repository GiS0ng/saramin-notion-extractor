import pytest

from app.region import normalize_region


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("서울 강남구", "서울"),
        ("서울특별시", "서울"),
        ("경기도", "경기"),
        ("경기", "경기"),
        ("재택근무 가능", "원격/전국무관"),
        ("전국", "원격/전국무관"),
        ("", "미상"),
        (None, "미상"),
        ("화성외국", "기타"),
        ("충청북도 청주시", "충북"),
    ],
)
def test_normalize_region(raw: str | None, expected: str) -> None:
    assert normalize_region(raw) == expected
