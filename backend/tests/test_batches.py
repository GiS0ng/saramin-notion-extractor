import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.batch_repository import InMemoryBatchRepository, get_batch_repository
from app.llm import get_anthropic_client
from app.main import app
from app.repository import InMemoryJobRepository, get_job_repository
from app.schemas import GeneratedContentDraft, LlmAnalysisOutput


class FakeMessages:
    def parse(self, **kwargs: Any) -> SimpleNamespace:
        output_format = kwargs["output_format"]

        if output_format is LlmAnalysisOutput:
            prompt = kwargs["messages"][0]["content"]
            payload = json.loads(prompt.split("원본 데이터:\n", maxsplit=1)[1])
            parsed_output = LlmAnalysisOutput(
                keywords=payload["test_keywords"],
                search_intent="테스트 채용공고 검색 의도",
                seo={
                    "title": "테스트 채용공고",
                    "description": "테스트용 설명",
                    "headings": ["주요 업무", "자격 요건"],
                },
                aeo={
                    "questions_and_answers": [
                        {"q": "주요 키워드는 무엇인가요?", "a": "테스트 키워드입니다."}
                    ]
                },
                geo={
                    "entities": payload["test_keywords"],
                    "claim_evidence_pairs": [],
                    "summary": "테스트 채용공고 요약",
                },
            )
        elif output_format is GeneratedContentDraft:
            parsed_output = GeneratedContentDraft(
                seo_title="채용 키워드 동향 분석",
                aeo_qna=[
                    {
                        "q": "가장 자주 등장한 키워드는 무엇인가요?",
                        "a": "집계 통계를 확인하세요.",
                    }
                ],
                geo_summary="최근 채용공고의 키워드 빈도를 집계한 결과입니다.",
            )
        else:
            raise AssertionError(f"unexpected output format: {output_format}")

        return SimpleNamespace(parsed_output=parsed_output)


class FakeAnthropicClient:
    messages = FakeMessages()


@pytest.fixture
def client() -> TestClient:
    job_repository = InMemoryJobRepository()
    batch_repository = InMemoryBatchRepository()
    app.dependency_overrides[get_job_repository] = lambda: job_repository
    app.dependency_overrides[get_batch_repository] = lambda: batch_repository
    app.dependency_overrides[get_anthropic_client] = FakeAnthropicClient
    test_client = TestClient(app, backend_options={"use_uvloop": True})

    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()


def create_and_analyze_jobs(client: TestClient, keyword_sets: list[list[str]]) -> None:
    for index, keywords in enumerate(keyword_sets):
        create_response = client.post(
            "/jobs",
            json={
                "title": f"Backend Engineer {index}",
                "company": "Example Inc.",
                "test_keywords": keywords,
            },
        )
        assert create_response.status_code == 201

        job_id = create_response.json()["id"]
        analyze_response = client.post(f"/jobs/{job_id}/analyze")
        assert analyze_response.status_code == 200


def ten_job_keyword_sets() -> list[list[str]]:
    return [
        ["Python", "Python", "FastAPI"] if index < 8 else ["Java", "Spring"]
        for index in range(10)
    ]


def create_batch(client: TestClient) -> dict[str, Any]:
    create_and_analyze_jobs(client, ten_job_keyword_sets())
    response = client.post("/batches/analyze")
    assert response.status_code == 201
    return response.json()


def test_analyze_batch_returns_422_with_only_nine_analyzed_jobs(
    client: TestClient,
) -> None:
    create_and_analyze_jobs(client, [["Python"] for _ in range(9)])

    response = client.post("/batches/analyze")

    assert response.status_code == 422
    assert "9건" in response.json()["detail"]
    assert "10건" in response.json()["detail"]


def test_analyze_batch_returns_keyword_frequency_and_draft(client: TestClient) -> None:
    body = create_batch(client)

    python_stat = next(stat for stat in body["stats"] if stat["keyword"] == "Python")
    assert python_stat["frequency_pct"] == 80.0
    assert body["sample_size"] == 10
    assert body["generated_content_draft"] == {
        "seo_title": "채용 키워드 동향 분석",
        "aeo_qna": [
            {
                "q": "가장 자주 등장한 키워드는 무엇인가요?",
                "a": "집계 통계를 확인하세요.",
            }
        ],
        "geo_summary": "최근 채용공고의 키워드 빈도를 집계한 결과입니다.",
    }


def test_get_batch_returns_the_created_batch(client: TestClient) -> None:
    created = create_batch(client)

    response = client.get(f"/batches/{created['batch_id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_missing_batch_returns_404(client: TestClient) -> None:
    response = client.get("/batches/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {"detail": "batch not found"}
