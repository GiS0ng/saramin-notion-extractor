from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.aggregation import compute_keyword_stats
from app.batch_repository import InMemoryBatchRepository, get_batch_repository
from app.llm import get_anthropic_client
from app.main import app
from app.notion import create_analysis_database, get_http_client
from app.repository import InMemoryJobRepository, get_job_repository
from app.schemas import AnalysisResult, JobIn, JobRecord


def analysis() -> AnalysisResult:
    return AnalysisResult(
        source_id="source",
        source_url="https://example.com/job",
        keywords=["Python"],
        search_intent="개발자 채용",
        seo={"title": "제목", "description": "설명", "headings": ["업무"]},
        aeo={"questions_and_answers": []},
        geo={"entities": [], "claim_evidence_pairs": [], "summary": "요약"},
    )


def analyzed_jobs(received_at: datetime) -> list[JobRecord]:
    return [
        JobRecord(
            id=str(index),
            received_at=received_at,
            payload=JobIn(title=f"공고 {index}"),
            analysis=analysis(),
        )
        for index in range(10)
    ]


def test_keyword_stats_period_uses_kst_date() -> None:
    _, period, _ = compute_keyword_stats(
        analyzed_jobs(datetime(2025, 9, 21, 18, 0, tzinfo=timezone.utc))
    )

    assert period == "2025-09-22 ~ 2025-09-22"
    assert "2025-09-21" not in period


def test_http_client_dependency_closes_client_after_generator_cleanup() -> None:
    dependency = get_http_client()
    client = next(dependency)

    assert client.is_closed is False
    dependency.close()

    assert client.is_closed is True


class FakeResponse:
    def __init__(
        self,
        status_code: int,
        payload: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"unexpected terminal status {self.status_code}")


class SequencedHttpClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls = 0

    def post(self, *args: Any, **kwargs: Any) -> FakeResponse:
        response = self.responses[self.calls]
        self.calls += 1
        return response


def test_create_analysis_database_retries_429_then_succeeds() -> None:
    expected = {"id": "database-id", "data_sources": [{"id": "source-id"}]}
    client = SequencedHttpClient(
        [FakeResponse(429, {}, {"Retry-After": "0"}), FakeResponse(200, expected)]
    )

    result = create_analysis_database("parent-id", "token", client)  # type: ignore[arg-type]

    assert result == expected
    assert client.calls == 2


class MissingCredentialsMessages:
    def parse(self, **kwargs: Any) -> None:
        raise TypeError("Could not resolve authentication method")


@pytest.fixture
def missing_credentials_client() -> TestClient:
    job_repository = InMemoryJobRepository()
    batch_repository = InMemoryBatchRepository()
    app.dependency_overrides[get_job_repository] = lambda: job_repository
    app.dependency_overrides[get_batch_repository] = lambda: batch_repository
    app.dependency_overrides[get_anthropic_client] = lambda: SimpleNamespace(
        messages=MissingCredentialsMessages()
    )
    client = TestClient(app, backend_options={"use_uvloop": True})

    try:
        yield client
    finally:
        client.close()
        app.dependency_overrides.clear()


def assert_missing_credentials(response: Any) -> None:
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "ANTHROPIC_API_KEY" in detail
    assert "Could not resolve authentication method" in detail


def test_job_analysis_translates_missing_credentials(missing_credentials_client: TestClient) -> None:
    created = missing_credentials_client.post("/jobs", json={"title": "개발자"})
    assert created.status_code == 201

    response = missing_credentials_client.post(f"/jobs/{created.json()['id']}/analyze")

    assert_missing_credentials(response)


def test_batch_analysis_translates_missing_credentials(
    missing_credentials_client: TestClient,
) -> None:
    repository = app.dependency_overrides[get_job_repository]()
    repository._store = {job.id: job for job in analyzed_jobs(datetime.now(timezone.utc))}

    response = missing_credentials_client.post("/batches/analyze")

    assert_missing_credentials(response)
