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
# Saramin의 지역 텍스트는 "(03926) 서울 마포구 ..."처럼 우편번호를 앞에 붙여 온다 —
# 시/도 토큰을 뽑기 전에 이 접두사를 걷어내야 한다. 옛 5자리-하이픈 형식("(480-58)")도
# 아직 남아있어 숫자만이 아니라 하이픈도 함께 허용한다.
_POSTAL_CODE_PREFIX = re.compile(r"^\([\d-]{3,8}\)\s*")
# 여러 지역에서 근무 가능한 공고는 "세종특별자치시, 부산전체"처럼 쉼표로 나열되고,
# 시/도 이름 뒤에 "전체"가 공백 없이 붙기도 한다("부산전체" = 부산 전역).
_TRAILING_PUNCT = re.compile(r"[,，·]+$")
_ENTIRE_REGION_SUFFIX = re.compile(r"전체$")


def _match_sido(token: str) -> str | None:
    if token in REGION_ALIASES:
        return REGION_ALIASES[token]
    if token in SIDO_CANONICAL:
        return token
    stripped = _SIDO_SUFFIX.sub("", token)
    if stripped in REGION_ALIASES:
        return REGION_ALIASES[stripped]
    if stripped in SIDO_CANONICAL:
        return stripped
    return None


def normalize_region(raw: str) -> str:
    text = unicodedata.normalize("NFKC", str(raw or "")).strip()
    text = _POSTAL_CODE_PREFIX.sub("", text).strip()
    if not text:
        return UNKNOWN_BUCKET
    if any(keyword in text for keyword in REMOTE_KEYWORDS):
        return REMOTE_BUCKET

    token = _TRAILING_PUNCT.sub("", text.split()[0])
    match = _match_sido(token) or _match_sido(_ENTIRE_REGION_SUFFIX.sub("", token))
    return match or OTHER_BUCKET
