"""집계 배치 로직.

claudeRead.md §4.2: 개별 문서 분석과 집계 분석은 서로 다른 배치 주기/저장소를 가진다.
개별 분석(app/llm.py의 analyze_job)이 이미 끝난 job들만 집계 대상으로 삼는다.
"""

from datetime import timedelta, timezone

from app.schemas import JobRecord, KeywordStat

MIN_SAMPLE_SIZE = 10
TOP_N_KEYWORDS = 10
KST = timezone(timedelta(hours=9))


class InsufficientSampleError(Exception):
    """claudeRead.md §7: 집계 배치의 '충분한 표본 크기' 기준에 미달했을 때."""

    def __init__(self, sample_size: int, minimum: int) -> None:
        self.sample_size = sample_size
        self.minimum = minimum
        super().__init__(f"표본이 부족합니다 (분석 완료된 job {sample_size}건, 최소 {minimum}건 필요)")


def compute_keyword_stats(jobs: list[JobRecord]) -> tuple[list[KeywordStat], str, int]:
    """분석이 끝난 job들의 keywords를 모아 등장 빈도(%)를 계산한다.

    빈도는 "키워드가 등장한 job 수 / 전체 분석 완료 job 수"로 계산한다(한 job 안에서
    같은 키워드가 여러 번 나와도 1건으로 센다) — "N건 중 몇 %의 공고에 이 키워드가
    등장했는가"를 보여주기 위함.
    """
    analyzed = [job for job in jobs if job.analysis is not None]
    sample_size = len(analyzed)
    if sample_size < MIN_SAMPLE_SIZE:
        raise InsufficientSampleError(sample_size, MIN_SAMPLE_SIZE)

    counts: dict[str, int] = {}
    for job in analyzed:
        assert job.analysis is not None
        for keyword in set(job.analysis.keywords):
            counts[keyword] = counts.get(keyword, 0) + 1

    stats = [
        KeywordStat(keyword=keyword, frequency_pct=round(count / sample_size * 100, 1))
        for keyword, count in counts.items()
    ]
    stats.sort(key=lambda s: s.frequency_pct, reverse=True)
    stats = stats[:TOP_N_KEYWORDS]

    # received_at은 UTC로 저장되지만(app/repository.py), 나머지 제품(core.js, README)은
    # 한국시간 기준 날짜를 쓴다 — 00:00~09:00 KST에 들어온 job이 하루 어긋나지 않도록
    # 여기서도 KST로 환산한 날짜를 집계 기간에 쓴다.
    received_dates = sorted(job.received_at.astimezone(KST) for job in analyzed)
    period = f"{received_dates[0].date().isoformat()} ~ {received_dates[-1].date().isoformat()}"

    return stats, period, sample_size
