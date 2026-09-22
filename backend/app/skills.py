"""GitHub 언어/토픽 → core.js 스킬 이름 정규화.

core.js의 SKILL_CATALOG/SKILL_ALIASES가 스킬 어휘의 단일 출처다. 여기서는 그걸 손으로
다시 옮기지 않고, scripts/export-skill-catalog.mjs가 내보낸 shared/skill-catalog.json을
읽어 쓴다 — core.js가 바뀌면 그 스크립트를 다시 돌려야 하고, .github/workflows/ci.yml이
안 돌렸으면 CI에서 잡아낸다.
"""

import json
from functools import lru_cache
from pathlib import Path

_CATALOG_PATH = Path(__file__).resolve().parents[2] / "shared" / "skill-catalog.json"


@lru_cache(maxsize=1)
def _alias_lookup() -> dict[str, str]:
    catalog = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    lookup: dict[str, str] = {}
    for skill in catalog["SKILL_CATALOG"]:
        lookup[skill.lower()] = skill
        for alias in catalog["SKILL_ALIASES"].get(skill, []):
            lookup[alias.lower()] = skill
    return lookup


def normalize_skill_name(raw: str) -> str | None:
    """GitHub의 language/topic 문자열 하나를 SKILL_CATALOG의 정식 이름으로 정규화한다.

    core.js의 detectSkills()는 자유 텍스트 안에서 부분 문자열을 정규식으로 찾지만, GitHub의
    language/topic 값은 이미 토큰 하나로 떨어져 있으므로 정확/별칭 일치만 보면 된다.
    """
    if not raw:
        return None
    return _alias_lookup().get(str(raw).strip().lower())
