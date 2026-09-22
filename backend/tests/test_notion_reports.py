from app.notion_reports import _github_match_row, _region_report_row
from app.schemas import RecommendedCompany, RegionSkillStat


def test_region_report_row_maps_all_notion_property_types() -> None:
    skills = [
        RegionSkillStat(region="서울", skill="Python", frequency_pct=75.0, job_count=4),
        RegionSkillStat(region="서울", skill="Java", frequency_pct=50.0, job_count=4),
    ]

    row = _region_report_row("서울", "2025-09-15 ~ 2025-09-21", 4, skills)

    assert row == {
        "제목": {"title": [{"type": "text", "text": {"content": "2025-09-15 ~ 2025-09-21 서울"}}]},
        "집계 시작일": {"date": {"start": "2025-09-15"}},
        "지역": {"select": {"name": "서울"}},
        "표본 공고 수": {"number": 4},
        "Top 기술": {"multi_select": [{"name": "Python"}, {"name": "Java"}]},
        "상세": {"rich_text": [{"type": "text", "text": {"content": "Python 75.0% · Java 50.0%"}}]},
    }


def test_github_match_row_maps_all_notion_property_types_and_percent_scale() -> None:
    rec = RecommendedCompany(
        rank=2,
        title="Example Backend Engineer",
        url="https://jobs.example/2",
        match_pct=75.0,
        matched_skills=["Python", "PostgreSQL"],
        missing_skills=["AWS"],
    )

    row = _github_match_row("2025-09-22", rec)

    assert row == {
        "제목": {"title": [{"type": "text", "text": {"content": "2025-09-22 #2 Example Backend Engineer"}}]},
        "집계 시작일": {"date": {"start": "2025-09-22"}},
        "순위": {"number": 2},
        "회사/직무": {"rich_text": [{"type": "text", "text": {"content": "Example Backend Engineer"}}]},
        "공고링크": {"url": "https://jobs.example/2"},
        "매치율": {"number": 0.75},
        "일치 기술": {"multi_select": [{"name": "Python"}, {"name": "PostgreSQL"}]},
        "부족 기술": {"multi_select": [{"name": "AWS"}]},
    }
