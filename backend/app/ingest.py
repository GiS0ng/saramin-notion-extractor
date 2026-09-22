"""Notion RAW DB → 백엔드 ingestion.

확장 프로그램은 백엔드를 거치지 않고 core.js의 notionProperties()가 만든 속성 그대로
Notion RAW DB에 직접 쓴다. 이 모듈은 그 속성 모양을 거꾸로 읽어 PostgresJobRepository에
채워 넣는다 — 이 매핑을 두 쪽이 공유하는 스키마가 없으므로, core.js의 notionProperties()가
바뀌면 이 파일의 필드 매핑도 반드시 같이 바꿔야 한다.
"""

from dataclasses import dataclass

import httpx

from app.notion import iterate_data_source
from app.repository import PostgresJobRepository
from app.schemas import JobIn


def _rich_text(prop: dict | None) -> str:
    if not prop:
        return ""
    return "".join(chunk.get("plain_text", "") for chunk in prop.get("rich_text", []))


def _title(prop: dict | None) -> str:
    if not prop:
        return ""
    return "".join(chunk.get("plain_text", "") for chunk in prop.get("title", []))


def _multi_select(prop: dict | None) -> list[str]:
    if not prop:
        return []
    return [option.get("name", "") for option in prop.get("multi_select", []) if option.get("name")]


def _url(prop: dict | None) -> str:
    return (prop or {}).get("url") or ""


def _date(prop: dict | None) -> str:
    date = (prop or {}).get("date") or {}
    return date.get("start") or ""


def notion_page_to_job_dict(page: dict) -> dict:
    """core.js의 notionProperties()가 만든 속성 모양을 역매핑한다."""
    properties = page.get("properties", {})
    return {
        "회사/직무(제목)": _title(properties.get("회사/직무(제목)")),
        "공고링크": _url(properties.get("공고링크")),
        "주요업무": _rich_text(properties.get("주요업무")),
        "지원자격": _rich_text(properties.get("지원자격")),
        "우대사항": _rich_text(properties.get("우대사항")),
        "기술스택": _multi_select(properties.get("기술스택")),
        "자격/어학": _rich_text(properties.get("자격/어학")),
        "근무조건/복지": _rich_text(properties.get("근무조건/복지")),
        "지역": _rich_text(properties.get("지역")),
        "마감일": _date(properties.get("마감일")),
    }


@dataclass
class IngestSummary:
    fetched: int
    upserted: int


def ingest_raw_jobs(
    token: str,
    data_source_id: str,
    http_client: httpx.Client,
    repo: PostgresJobRepository,
) -> IngestSummary:
    """Notion RAW DB 전체를 페이지네이션으로 순회하며 공고링크 기준 upsert한다.

    공고링크가 없는 페이지(작성 중이거나 손상된 행)는 건너뛴다 — upsert의 dedup 키가
    공고링크이기 때문에 빈 값으로는 안전하게 식별할 수 없다. RAW DB 건수만큼 매번 새
    DB 커넥션을 여는 대신, 모은 뒤 한 번에 bulk_upsert_by_source_url()로 넘긴다 —
    Neon처럼 단발성 프로세스가 매번 새 TLS 핸드셰이크를 거쳐야 하는 관리형 Postgres에서
    건별 upsert는 RAW DB 규모(수백 건)에서 눈에 띄게 느리다.
    """
    fetched = 0
    entries: list[tuple[JobIn, str, str]] = []
    for page in iterate_data_source(data_source_id, token, http_client):
        fetched += 1
        job_dict = notion_page_to_job_dict(page)
        source_url = job_dict.get("공고링크")
        if not source_url:
            continue
        entries.append((JobIn(**job_dict), source_url, page.get("id", "")))

    if entries:
        repo.bulk_upsert_by_source_url(entries)
    return IngestSummary(fetched=fetched, upserted=len(entries))
