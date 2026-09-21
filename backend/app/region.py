"""지역 정규화.

claudeRead.md에는 지오코딩 수준의 지역 정규화가 계획돼 있지 않다. 여기서는 시/도 단위
버킷으로만 묶는다 — core.js가 Saramin 페이지에서 그대로 긁어온 자유 텍스트(예: "서울 강남구",
"경기", "서울특별시")를 주간 집계가 가능한 수준으로만 다듬는다.
"""

import re
import unicodedata

SIDO_CANONICAL = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]

REGION_ALIASES = {
    "서울특별시": "서울",
    "부산광역시": "부산",
    "대구광역시": "대구",
    "인천광역시": "인천",
    "광주광역시": "광주",
    "대전광역시": "대전",
    "울산광역시": "울산",
    "세종특별자치시": "세종",
    "경기도": "경기",
    "강원도": "강원",
    "강원특별자치도": "강원",
    "충청북도": "충북",
    "충청남도": "충남",
    "전라북도": "전북",
    "전북특별자치도": "전북",
    "전라남도": "전남",
    "경상북도": "경북",
    "경상남도": "경남",
    "제주도": "제주",
    "제주특별자치도": "제주",
}

REMOTE_KEYWORDS = ("재택", "원격", "무관", "전국")

UNKNOWN_BUCKET = "미상"
REMOTE_BUCKET = "원격/전국무관"
OTHER_BUCKET = "기타"

_SIDO_SUFFIX = re.compile(r"(특별자치시|특별자치도|광역시|특별시|자치도|도)$")


def normalize_region(raw: str) -> str:
    text = unicodedata.normalize("NFKC", str(raw or "")).strip()
    if not text:
        return UNKNOWN_BUCKET
    if any(keyword in text for keyword in REMOTE_KEYWORDS):
        return REMOTE_BUCKET

    token = text.split()[0]
    if token in REGION_ALIASES:
        return REGION_ALIASES[token]
    if token in SIDO_CANONICAL:
        return token

    stripped = _SIDO_SUFFIX.sub("", token)
    if stripped in REGION_ALIASES:
        return REGION_ALIASES[stripped]
    if stripped in SIDO_CANONICAL:
        return stripped

    return OTHER_BUCKET
