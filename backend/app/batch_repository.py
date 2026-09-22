"""집계 배치 결과 저장소. app/repository.py의 JobRepository와 동일한 패턴(Protocol +
인메모리)을 따른다 — 나중에 PostgreSQL로 교체할 때도 같은 방식으로 바꾸면 된다."""

from typing import Protocol

from app.schemas import BatchResult


class BatchRepository(Protocol):
    def add(self, batch: BatchResult) -> BatchResult: ...
    def get(self, batch_id: str) -> BatchResult | None: ...
    def list(self) -> list[BatchResult]: ...


class InMemoryBatchRepository:
    def __init__(self) -> None:
        self._store: dict[str, BatchResult] = {}

    def add(self, batch: BatchResult) -> BatchResult:
        self._store[batch.batch_id] = batch
        return batch

    def get(self, batch_id: str) -> BatchResult | None:
        return self._store.get(batch_id)

    def list(self) -> list[BatchResult]:
        return list(self._store.values())


_repository = InMemoryBatchRepository()


def get_batch_repository() -> BatchRepository:
    return _repository
