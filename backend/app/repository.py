"""Job 저장소 계층.

지금은 PostgreSQL을 붙이지 않고 인메모리로 저장한다. 이후 PostgreSQL로
교체할 때는 JobRepository 프로토콜을 구현하는 새 클래스
(예: PostgresJobRepository)를 추가하고 get_job_repository()가 그걸
반환하도록 바꾸면 된다 — 라우터 코드는 건드릴 필요 없다.
"""

from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from app.schemas import AnalysisResult, JobIn, JobRecord


class JobRepository(Protocol):
    def add(self, payload: JobIn) -> JobRecord: ...
    def get(self, job_id: str) -> JobRecord | None: ...
    def list(self) -> list[JobRecord]: ...
    def set_analysis(self, job_id: str, analysis: AnalysisResult) -> JobRecord | None: ...


class InMemoryJobRepository:
    def __init__(self) -> None:
        self._store: dict[str, JobRecord] = {}

    def add(self, payload: JobIn) -> JobRecord:
        record = JobRecord(
            id=str(uuid4()),
            received_at=datetime.now(timezone.utc),
            payload=payload,
        )
        self._store[record.id] = record
        return record

    def get(self, job_id: str) -> JobRecord | None:
        return self._store.get(job_id)

    def list(self) -> list[JobRecord]:
        return list(self._store.values())

    def set_analysis(self, job_id: str, analysis: AnalysisResult) -> JobRecord | None:
        record = self._store.get(job_id)
        if record is None:
            return None
        updated = record.model_copy(update={"analysis": analysis})
        self._store[job_id] = updated
        return updated


_repository = InMemoryJobRepository()


def get_job_repository() -> JobRepository:
    return _repository
