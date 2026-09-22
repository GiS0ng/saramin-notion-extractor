from datetime import datetime, timezone

from app.region_aggregation import build_region_skill_report, compute_region_skill_stats
from app.schemas import JobIn, JobRecord


def job(
    job_id: str,
    region: str,
    skills: list[str],
    received_at: datetime | None = None,
) -> JobRecord:
    return JobRecord(
        id=job_id,
        received_at=received_at or datetime(2025, 9, 20, tzinfo=timezone.utc),
        payload=JobIn(**{"지역": region, "기술스택": skills}),
    )


def test_regions_with_fewer_than_three_jobs_are_excluded() -> None:
    jobs = [
        job("seoul-1", "서울", ["Python"]),
        job("seoul-2", "서울", ["Python"]),
        job("seoul-3", "서울", ["Python"]),
        job("busan-1", "부산", ["Java"]),
        job("busan-2", "부산", ["Java"]),
    ]

    stats = compute_region_skill_stats(jobs)

    assert {stat.region for stat in stats} == {"서울"}


def test_duplicate_skills_within_one_job_count_once() -> None:
    jobs = [
        job("1", "서울", ["Python", "Python"]),
        job("2", "서울", ["Python"]),
        job("3", "서울", ["Java"]),
    ]

    stats = {stat.skill: stat for stat in compute_region_skill_stats(jobs)}

    assert stats["Python"].frequency_pct == 66.7
    assert stats["Java"].frequency_pct == 33.3
    assert all(stat.job_count == 3 for stat in stats.values())


def test_only_top_five_skills_are_returned() -> None:
    skills = ["Python", "Java", "Go", "Rust", "C++", "C#"]
    jobs = [
        job("1", "서울", skills),
        job("2", "서울", skills[:5]),
        job("3", "서울", skills[:4]),
    ]

    stats = compute_region_skill_stats(jobs)

    assert len(stats) == 5
    assert {stat.skill for stat in stats} == set(skills[:5])
    assert "C#" not in {stat.skill for stat in stats}


def test_unknown_region_is_excluded_from_stats_and_sample_size() -> None:
    jobs = [
        job("1", "서울", ["Python"]),
        job("2", "서울", ["Python"]),
        job("3", "서울", ["Python"]),
        job("unknown", "", ["Java"]),
    ]

    report = build_region_skill_report(jobs)

    assert report.sample_size == 3
    assert {stat.region for stat in report.stats} == {"서울"}


def test_report_period_uses_kst_dates() -> None:
    received_at = datetime(2025, 9, 21, 18, 0, tzinfo=timezone.utc)
    jobs = [job(str(index), "서울", ["Python"], received_at) for index in range(3)]

    report = build_region_skill_report(jobs)

    assert report.period == "2025-09-22 ~ 2025-09-22"
    assert "2025-09-21" not in report.period
