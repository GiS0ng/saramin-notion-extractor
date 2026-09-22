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


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("(480-58) 부산광역시 해운대구", "부산"),
        ("(57975) 전남광주 순천시 장선배기길 34", "기타"),
    ],
)
def test_normalize_region_raw_database_regressions(raw: str, expected: str) -> None:
    assert normalize_region(raw) == expected
