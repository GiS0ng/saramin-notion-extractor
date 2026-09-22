"""PostgreSQL 연결 계층.

backend/app/repository.py의 문서화된 계획대로, 인메모리 JobRepository를 대체하는
PostgreSQL 구현체가 쓰는 엔진/스키마를 여기서 만든다.

풀링 방식 주의: backend/scripts/weekly_report.py는 GitHub Actions에서 매번 새로 뜨는
단발성 프로세스다. 관리형 Postgres(Neon/Supabase 등)의 pgbouncer 엔드포인트를 쓸 경우
클라이언트 쪽에서 다시 풀링하면 안 되므로 get_engine(short_lived=True)로 NullPool을 쓴다.
나중에 상시 구동되는 서버(uvicorn)에서 재사용하게 되면 반대로 기본 QueuePool이 맞다.
"""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

_CREATE_JOBS_TABLE = """
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    source_url TEXT UNIQUE NOT NULL,
    notion_page_id TEXT UNIQUE,
    title TEXT,
    region_raw TEXT,
    region_normalized TEXT,
    skills TEXT[] NOT NULL DEFAULT '{}',
    deadline DATE,
    raw_payload JSONB NOT NULL,
    analysis JSONB,
    received_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
)
"""


def get_engine(*, short_lived: bool = False) -> Engine:
    database_url = os.environ["DATABASE_URL"]
    kwargs: dict = {"pool_pre_ping": True}
    if short_lived:
        kwargs["poolclass"] = NullPool
    return create_engine(database_url, **kwargs)


def init_db(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(text(_CREATE_JOBS_TABLE))
