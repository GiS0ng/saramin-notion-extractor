"""지역별 기술스택 집계.

backend/app/aggregation.py의 compute_keyword_stats()와는 전제조건이 다르다 — 그건 LLM
분석이 끝난 job만 대상으로 하고 LLM이 자유 생성한 keywords를 센다. 여기서는 스크래퍼가
이미 구조화해둔 기술스택 필드를 쓰므로 LLM 분석 여부와 무관하게 모든 job이 대상이다.
"""

from collections import defaultdict

from app.aggregation import KST
from app.region import UNKNOWN_BUCKET, normalize_region
from app.schemas import JobRecord, RegionSkillReport, RegionSkillStat

MIN_JOBS_PER_REGION = 3
TOP_N_SKILLS = 5


def compute_region_skill_stats(jobs: list[JobRecord]) -> list[RegionSkillStat]:
    """지역별로 그룹핑해 기술스택 등장 빈도(%) 상위 TOP_N_SKILLS를 뽑는다.

    표본이 MIN_JOBS_PER_REGION 미만인 지역은 제외한다 — 1건짜리 지역에서 그 공고가
    요구하는 기술이 전부 "100% 등장"으로 나오는 노이즈를 막기 위함이다. 지역을 알 수 없는
    (UNKNOWN_BUCKET) job도 집계 대상에서 제외한다 — "미상"이라는 지역별 통계는 의미가 없다.
    """
    jobs_by_region: dict[str, list[JobRecord]] = defaultdict(list)
    for job in jobs:
        region = _region_of(job)
        if region == UNKNOWN_BUCKET:
            continue
        jobs_by_region[region].append(job)

    stats: list[RegionSkillStat] = []
    for region, region_jobs in jobs_by_region.items():
        job_count = len(region_jobs)
        if job_count < MIN_JOBS_PER_REGION:
            continue

        counts: dict[str, int] = {}
        for job in region_jobs:
            for skill in set(_skills_of(job)):
                counts[skill] = counts.get(skill, 0) + 1

        region_stats = [
            RegionSkillStat(
                region=region,
                skill=skill,
                frequency_pct=round(count / job_count * 100, 1),
                job_count=job_count,
            )
            for skill, count in counts.items()
        ]
        region_stats.sort(key=lambda stat: stat.frequency_pct, reverse=True)
        stats.extend(region_stats[:TOP_N_SKILLS])

    return stats


def build_region_skill_report(jobs: list[JobRecord]) -> RegionSkillReport:
    """compute_region_skill_stats()를 감싸 backend/scripts/weekly_report.py가 바로 쓸
    period/sample_size까지 채운 RegionSkillReport를 만든다.

    aggregation.py의 compute_keyword_stats()와 마찬가지로 KST 기준 날짜 범위를 period로
    쓴다 — 지역을 알 수 없는(UNKNOWN_BUCKET) job은 집계에서도 제외했으므로 sample_size에서도 뺀다.
    """
    stats = compute_region_skill_stats(jobs)
    included = [job for job in jobs if _region_of(job) != UNKNOWN_BUCKET]
    period = ""
    if included:
        received_dates = sorted(job.received_at.astimezone(KST) for job in included)
        period = f"{received_dates[0].date().isoformat()} ~ {received_dates[-1].date().isoformat()}"
    return RegionSkillReport(period=period, stats=stats, sample_size=len(included))


def _region_of(job: JobRecord) -> str:
    return normalize_region(job.payload.model_dump().get("지역", ""))


def _skills_of(job: JobRecord) -> list[str]:
    skills = job.payload.model_dump().get("기술스택")
    return skills if isinstance(skills, list) else []
