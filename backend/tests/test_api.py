from datetime import datetime
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

from app.llm import get_anthropic_client
from app.main import app
from app.repository import InMemoryJobRepository, get_job_repository


LLM_OUTPUT = {
    "keywords": ["Python", "FastAPI", "Backend"],
    "search_intent": "Python 백엔드 개발자 채용 정보를 찾는다.",
    "seo": {
        "title": "Example Inc. Backend Engineer 채용",
        "description": "Python과 FastAPI를 사용하는 백엔드 개발자 채용 공고입니다.",
        "headings": ["주요 업무", "자격 요건"],
    },
    "aeo": {
        "questions_and_answers": [
            {"q": "주요 기술 스택은 무엇인가요?", "a": "Python과 FastAPI입니다."}
        ]
    },
    "geo": {
        "entities": ["Example Inc.", "Python", "FastAPI"],
        "claim_evidence_pairs": [
            {
                "claim": "FastAPI 경험이 필요합니다.",
                "evidence": "FastAPI",
                "source": "skills",
            }
        ],
        "summary": "Example Inc.의 Python 백엔드 개발자 채용 공고입니다.",
    },
}


class FakeMessages:
    def parse(self, **kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(parsed_output=kwargs["output_format"](**LLM_OUTPUT))


class FakeAnthropicClient:
    messages = FakeMessages()


@pytest.fixture
def client() -> TestClient:
    repository = InMemoryJobRepository()
    app.dependency_overrides[get_job_repository] = lambda: repository
    app.dependency_overrides[get_anthropic_client] = FakeAnthropicClient
    test_client = TestClient(app, backend_options={"use_uvloop": True})

    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()


def create_job(client: TestClient) -> dict:
    payload = {
        "title": "Backend Engineer",
        "company": "Example Inc.",
        "skills": ["Python", "FastAPI"],
    }
    response = client.post("/jobs", json=payload)

    assert response.status_code == 201
    body = response.json()
    assert body["id"]
    assert datetime.fromisoformat(body["received_at"])
    assert body["payload"] == payload
    return body


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_job(client: TestClient) -> None:
    create_job(client)


def test_list_jobs_includes_created_job(client: TestClient) -> None:
    created = create_job(client)

    response = client.get("/jobs")

    assert response.status_code == 200
    assert created in response.json()


def test_get_job(client: TestClient) -> None:
    created = create_job(client)

    response = client.get(f"/jobs/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_job_returns_404(client: TestClient) -> None:
    response = client.get("/jobs/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "job not found"}


def test_analyze_job_returns_and_stores_analysis(client: TestClient) -> None:
    source_url = "https://example.com/jobs/backend-engineer"
    create_response = client.post(
        "/jobs",
        json={
            "title": "Backend Engineer",
            "company": "Example Inc.",
            "skills": ["Python", "FastAPI"],
            "공고링크": source_url,
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()

    response = client.post(f"/jobs/{created['id']}/analyze")

    assert response.status_code == 200
    body = response.json()
    assert body["analysis"] == {
        "source_id": created["id"],
        "source_url": source_url,
        **LLM_OUTPUT,
    }
    assert client.get(f"/jobs/{created['id']}").json()["analysis"] == body["analysis"]


def test_analyze_missing_job_returns_404(client: TestClient) -> None:
    response = client.post("/jobs/does-not-exist/analyze")

    assert response.status_code == 404
    assert response.json() == {"detail": "job not found"}


def test_analyze_job_returns_502_when_anthropic_fails(client: TestClient) -> None:
    class FailingMessages:
        def parse(self, **kwargs: Any) -> None:
            raise anthropic.APIError(
                "upstream unavailable",
                httpx2.Request("POST", "https://api.anthropic.com/v1/messages"),
                body=None,
            )

    failing_client = SimpleNamespace(messages=FailingMessages())
    app.dependency_overrides[get_anthropic_client] = lambda: failing_client
    created = create_job(client)

    response = client.post(f"/jobs/{created['id']}/analyze")

    assert response.status_code == 502
    assert response.json() == {"detail": "LLM 호출 실패: upstream unavailable"}
