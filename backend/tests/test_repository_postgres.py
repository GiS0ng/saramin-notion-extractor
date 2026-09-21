import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest

import app.repository as repository_module
from app.db import get_engine, init_db
from app.repository import InMemoryJobRepository, PostgresJobRepository, get_job_repository
from app.schemas import AnalysisResult, JobIn


def test_get_job_repository_without_database_url_returns_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert isinstance(get_job_repository(), InMemoryJobRepository)


def test_get_job_repository_with_database_url_initializes_postgres_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dummy_engine = object()
    initialized: list[object] = []
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused/test")
    monkeypatch.setattr(repository_module, "_postgres_engine", None)
    monkeypatch.setattr(repository_module, "get_engine", lambda: dummy_engine)
    monkeypatch.setattr(repository_module, "init_db", initialized.append)

    first = get_job_repository()
    second = get_job_repository()

    assert isinstance(first, PostgresJobRepository)
    assert isinstance(second, PostgresJobRepository)
    assert first._engine is dummy_engine
    assert second._engine is dummy_engine
    assert initialized == [dummy_engine]


def test_postgres_row_params_maps_payload_without_connecting() -> None:
    repo = PostgresJobRepository(engine=None)  # type: ignore[arg-type]
    received_at = datetime(2026, 9, 20, tzinfo=timezone.utc)
    updated_at = datetime(2026, 9, 21, tzinfo=timezone.utc)
    payload = JobIn(
        **{
            "회사/직무(제목)": "플랫폼 개발자",
            "공고링크": "https://jobs.example/1",
            "지역": "충청북도 청주시",
            "기술스택": ["Python", "PostgreSQL"],
            "마감일": "",
        }
    )

    params = repo._row_params("record-1", payload, "https://jobs.example/1", "notion-1", received_at, updated_at)

    assert params == {
        "id": "record-1",
        "source_url": "https://jobs.example/1",
        "notion_page_id": "notion-1",
        "title": "플랫폼 개발자",
        "region_raw": "충청북도 청주시",
        "region_normalized": "충북",
        "skills": ["Python", "PostgreSQL"],
        "deadline": None,
        "raw_payload": json.dumps(payload.model_dump(mode="json"), ensure_ascii=False),
        "received_at": received_at,
        "updated_at": updated_at,
    }


@pytest.mark.skipif("TEST_DATABASE_URL" not in os.environ, reason="TEST_DATABASE_URL이 없어 PostgreSQL 통합 테스트 생략")
def test_postgres_repository_crud_and_upsert(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    engine = get_engine(short_lived=True)
    init_db(engine)
    repo = PostgresJobRepository(engine)
    unique = uuid4().hex
    source_url = f"https://jobs.example/integration-{unique}"
    created_ids: list[str] = []

    try:
        added = repo.add(JobIn(**{"회사/직무(제목)": "직접 추가", "지역": "서울"}))
        created_ids.append(added.id)
        assert repo.get(added.id) is not None

        upserted = repo.upsert_by_source_url(
            JobIn(**{"회사/직무(제목)": "최초", "공고링크": source_url, "지역": "경기도"}),
            source_url,
            f"notion-{unique}",
        )
        created_ids.append(upserted.id)
        updated = repo.upsert_by_source_url(
            JobIn(**{"회사/직무(제목)": "갱신", "공고링크": source_url, "지역": "서울특별시"}),
            source_url,
            f"notion-{unique}",
        )
        assert updated.id == upserted.id
        assert updated.payload.model_dump()["회사/직무(제목)"] == "갱신"

        analysis = AnalysisResult(
            source_id=added.id,
            source_url="https://source.example/job",
            keywords=["Python"],
            search_intent="채용",
            seo={"title": "제목", "description": "설명", "headings": ["업무"]},
            aeo={"questions_and_answers": [{"q": "무엇?", "a": "개발"}]},
            geo={"entities": ["Python"], "claim_evidence_pairs": [], "summary": "요약"},
        )
        analyzed = repo.set_analysis(added.id, analysis)
        assert analyzed is not None
        assert analyzed.analysis == analysis
        assert {added.id, upserted.id}.issubset({record.id for record in repo.list()})
    finally:
        if created_ids:
            from sqlalchemy import text

            with engine.begin() as connection:
                for record_id in created_ids:
                    connection.execute(
                        text("DELETE FROM jobs WHERE id = CAST(:id AS UUID)"),
                        {"id": record_id},
                    )
        engine.dispose()
