"""주간 리포트용 Notion DB.

기존 SEO/AEO/GEO 분석 DB(backend/app/notion.py의 ANALYSIS_DB_PROPERTIES)에 컬럼을 얹지
않고 리포트 전용 DB를 따로 둔다 — 지역별 리포트는 "지역 × 기술" 행이고 GitHub 매칭
리포트는 "순위 × 추천 회사" 행이라 두 리포트의 속성 모양이 근본적으로 달라서, 하나의
DB에 섞으면 행마다 안 쓰는 컬럼이 잔뜩 비게 된다.

create_analysis_database()와 동일한 패턴(429 재시도는 app.notion.request_with_retry
재사용)을 따른다.
"""

from app.notion import request_with_retry
from app.schemas import RecommendedCompany, RegionSkillStat

REGION_SKILL_REPORT_PROPERTIES: dict[str, dict] = {
    "제목": {"type": "title", "title": {}},
    "집계 시작일": {"type": "date", "date": {}},
    "지역": {
        "type": "select",
        "select": {
            "options": [
                {"name": name}
                for name in [
                    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
                    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
                    "원격/전국무관", "기타",
                ]
            ]
        },
    },
    "표본 공고 수": {"type": "number", "number": {"format": "number"}},
    "Top 기술": {"type": "multi_select", "multi_select": {"options": []}},
    "상세": {"type": "rich_text", "rich_text": {}},
}


def create_region_report_database(parent_page_id: str, token: str, client) -> dict:
    return request_with_retry(
        client,
        "/databases",
        token,
        json_body={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": "지역별 기술스택 주간 리포트"}}],
            "initial_data_source": {"properties": REGION_SKILL_REPORT_PROPERTIES},
        },
    )


def _region_report_row(region: str, period: str, job_count: int, skills: list[RegionSkillStat]) -> dict:
    detail = " · ".join(f"{s.skill} {s.frequency_pct}%" for s in skills)
    return {
        "제목": {"title": [{"type": "text", "text": {"content": f"{period} {region}"}}]},
        "집계 시작일": {"date": {"start": period.split(" ~ ")[0]}},
        "지역": {"select": {"name": region}},
        "표본 공고 수": {"number": job_count},
        "Top 기술": {"multi_select": [{"name": s.skill} for s in skills]},
        "상세": {"rich_text": [{"type": "text", "text": {"content": detail}}]},
    }


def append_region_report_rows(
    stats: list[RegionSkillStat],
    period: str,
    data_source_id: str,
    token: str,
    client,
) -> list[dict]:
    """지역별로 한 행씩 Notion 리포트 DB에 추가한다. 반환값은 각 POST /pages 응답."""
    by_region: dict[str, list[RegionSkillStat]] = {}
    job_counts: dict[str, int] = {}
    for stat in stats:
        by_region.setdefault(stat.region, []).append(stat)
        job_counts[stat.region] = stat.job_count

    created = []
    for region, region_stats in by_region.items():
        properties = _region_report_row(region, period, job_counts[region], region_stats)
        response = request_with_retry(
            client,
            "/pages",
            token,
            json_body={
                "parent": {"type": "data_source_id", "data_source_id": data_source_id},
                "properties": properties,
            },
        )
        created.append(response)
    return created


GITHUB_MATCH_REPORT_PROPERTIES: dict[str, dict] = {
    "제목": {"type": "title", "title": {}},
    "집계 시작일": {"type": "date", "date": {}},
    "순위": {"type": "number", "number": {"format": "number"}},
    "회사/직무": {"type": "rich_text", "rich_text": {}},
    "공고링크": {"type": "url", "url": {}},
    "매치율": {"type": "number", "number": {"format": "percent"}},
    "일치 기술": {"type": "multi_select", "multi_select": {"options": []}},
    "부족 기술": {"type": "multi_select", "multi_select": {"options": []}},
}


def create_github_match_database(parent_page_id: str, token: str, client) -> dict:
    return request_with_retry(
        client,
        "/databases",
        token,
        json_body={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": "GitHub 매칭 추천 주간 리포트"}}],
            "initial_data_source": {"properties": GITHUB_MATCH_REPORT_PROPERTIES},
        },
    )


def _github_match_row(period: str, rec: RecommendedCompany) -> dict:
    # Notion의 percent number 포맷은 0.0~1.0 스케일이다(50% = 0.5) — match_pct는 0~100
    # 스케일로 계산돼 있으므로(RecommendedCompany.match_pct) 100으로 나눠서 맞춘다.
    return {
        "제목": {"title": [{"type": "text", "text": {"content": f"{period} #{rec.rank} {rec.title}"[:2000]}}]},
        "집계 시작일": {"date": {"start": period}},
        "순위": {"number": rec.rank},
        "회사/직무": {"rich_text": [{"type": "text", "text": {"content": rec.title[:2000]}}]},
        "공고링크": {"url": rec.url or None},
        "매치율": {"number": rec.match_pct / 100},
        "일치 기술": {"multi_select": [{"name": s} for s in rec.matched_skills]},
        "부족 기술": {"multi_select": [{"name": s} for s in rec.missing_skills]},
    }


def append_github_match_rows(
    recommendations: list[RecommendedCompany],
    period: str,
    data_source_id: str,
    token: str,
    client,
) -> list[dict]:
    """추천 순위 하나당 한 행씩 Notion 리포트 DB에 추가한다."""
    created = []
    for rec in recommendations:
        response = request_with_retry(
            client,
            "/pages",
            token,
            json_body={
                "parent": {"type": "data_source_id", "data_source_id": data_source_id},
                "properties": _github_match_row(period, rec),
            },
        )
        created.append(response)
    return created
