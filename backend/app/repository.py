"""Job 저장소 계층.

DATABASE_URL 환경변수가 있으면 PostgresJobRepository를, 없으면 인메모리 저장소를 쓴다
(get_job_repository() 참고) — 라우터 코드는 어느 쪽이 쓰이는지 알 필요가 없다.
"""

import json
import os
from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db import get_engine, init_db
from app.region import normalize_region
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


def _row_to_record(row) -> JobRecord:
    analysis = AnalysisResult(**row["analysis"]) if row["analysis"] else None
    return JobRecord(
        id=str(row["id"]),
        received_at=row["received_at"],
        payload=JobIn(**row["raw_payload"]),
        analysis=analysis,
    )


class PostgresJobRepository:
    """JobRepository 프로토콜 구현체.

    raw_payload/analysis는 JSONB로 그대로 보존하고, region_normalized/skills/deadline은
    조회·집계 쿼리(§ backend/app/region_aggregation.py)를 위해 별도 컬럼으로도 저장한다.
    """

    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def _row_params(self, record_id: str, payload: JobIn, source_url: str,
                     notion_page_id: str | None, received_at: datetime, updated_at: datetime) -> dict:
        data = payload.model_dump(mode="json")
        region_raw = data.get("지역") or ""
        return {
            "id": record_id,
            "source_url": source_url,
            "notion_page_id": notion_page_id,
            "title": data.get("회사/직무(제목)", ""),
            "region_raw": region_raw,
            "region_normalized": normalize_region(region_raw),
            "skills": data.get("기술스택") or [],
            "deadline": data.get("마감일") or None,
            "raw_payload": json.dumps(data, ensure_ascii=False),
            "received_at": received_at,
            "updated_at": updated_at,
        }

    def add(self, payload: JobIn) -> JobRecord:
        record_id = str(uuid4())
        now = datetime.now(timezone.utc)
        data = payload.model_dump(mode="json")
        # 스크래퍼가 아닌 임의 클라이언트가 보낸 payload는 공고링크가 없을 수 있다 —
        # source_url UNIQUE 제약을 만족시킬 합성 식별자로 대체한다.
        source_url = data.get("공고링크") or f"urn:job:{record_id}"
        params = self._row_params(record_id, payload, source_url, None, now, now)
        with self._engine.begin() as conn:
            row = conn.execute(
                text("""
                    INSERT INTO jobs (id, source_url, notion_page_id, title, region_raw,
                                       region_normalized, skills, deadline, raw_payload,
                                       received_at, updated_at)
                    VALUES (:id, :source_url, :notion_page_id, :title, :region_raw,
                            :region_normalized, :skills, :deadline, :raw_payload,
                            :received_at, :updated_at)
                    RETURNING *
                """),
                params,
            ).mappings().first()
        return _row_to_record(row)

    def get(self, job_id: str) -> JobRecord | None:
        with self._engine.connect() as conn:
            row = conn.execute(text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id}).mappings().first()
        return _row_to_record(row) if row else None

    def list(self) -> list[JobRecord]:
        with self._engine.connect() as conn:
            rows = conn.execute(text("SELECT * FROM jobs ORDER BY received_at")).mappings().all()
        return [_row_to_record(row) for row in rows]

    def set_analysis(self, job_id: str, analysis: AnalysisResult) -> JobRecord | None:
        with self._engine.begin() as conn:
            row = conn.execute(
                text("""
                    UPDATE jobs SET analysis = :analysis, updated_at = :updated_at
                    WHERE id = :id
                    RETURNING *
                """),
                {
                    "analysis": json.dumps(analysis.model_dump(mode="json"), ensure_ascii=False),
                    "updated_at": datetime.now(timezone.utc),
                    "id": job_id,
                },
            ).mappings().first()
        return _row_to_record(row) if row else None

    _UPSERT_SQL = text("""
        INSERT INTO jobs (id, source_url, notion_page_id, title, region_raw,
                           region_normalized, skills, deadline, raw_payload,
                           received_at, updated_at)
        VALUES (:id, :source_url, :notion_page_id, :title, :region_raw,
                :region_normalized, :skills, :deadline, :raw_payload,
                :received_at, :updated_at)
        ON CONFLICT (source_url) DO UPDATE SET
            notion_page_id = EXCLUDED.notion_page_id,
            title = EXCLUDED.title,
            region_raw = EXCLUDED.region_raw,
            region_normalized = EXCLUDED.region_normalized,
            skills = EXCLUDED.skills,
            deadline = EXCLUDED.deadline,
            raw_payload = EXCLUDED.raw_payload,
            updated_at = EXCLUDED.updated_at
        RETURNING *
    """)

    def upsert_by_source_url(self, payload: JobIn, source_url: str, notion_page_id: str) -> JobRecord:
        """공고링크 기준 upsert. 기존 행이 있으면 id/received_at은 그대로 두고 나머지만 갱신한다.

        여러 건을 한 번에 넣을 때는 이 메서드 대신 bulk_upsert_by_source_url()을 써라 — 이
        메서드는 호출마다 새 커넥션을 열어서, ingest.py처럼 수백 건을 순회하며 부르면
        (특히 NullPool을 쓰는 단발성 스크립트에서) 매번 Neon까지 새 TLS 핸드셰이크가 걸려 느리다.
        """
        with self._engine.begin() as conn:
            return self._upsert(conn, payload, source_url, notion_page_id)

    def bulk_upsert_by_source_url(
        self, entries: list[tuple[JobIn, str, str]]
    ) -> list[JobRecord]:
        """ingest.py 전용: 커넥션 하나로 여러 건을 한 트랜잭션에 upsert한다."""
        with self._engine.begin() as conn:
            return [self._upsert(conn, payload, source_url, notion_page_id)
                    for payload, source_url, notion_page_id in entries]

    def _upsert(self, conn, payload: JobIn, source_url: str, notion_page_id: str) -> JobRecord:
        record_id = str(uuid4())
        now = datetime.now(timezone.utc)
        params = self._row_params(record_id, payload, source_url, notion_page_id, now, now)
        row = conn.execute(self._UPSERT_SQL, params).mappings().first()
        return _row_to_record(row)


_in_memory_repository = InMemoryJobRepository()
_postgres_engine: Engine | None = None


def get_job_repository() -> JobRepository:
    global _postgres_engine
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return _in_memory_repository
    if _postgres_engine is None:
        _postgres_engine = get_engine()
        init_db(_postgres_engine)
    return PostgresJobRepository(_postgres_engine)
