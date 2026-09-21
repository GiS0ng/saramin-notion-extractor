"""Notion 분석 DB 템플릿 생성.

claudeRead.md §5.3 컬럼 표를 그대로 Notion 데이터베이스 속성으로 옮긴다. 이 DB는
사람이 채우는 에디토리얼 워크플로우용(검수/발행 상태)이라 생성 시점에는 빈 템플릿만
만들고 데이터를 채워 넣지 않는다.

기존 확장(background.js)과 동일한 Notion API 버전(2026-03-11)을 쓴다. Notion API
2025-09-03 이후 데이터베이스와 데이터 소스가 분리됐으므로, 속성은 최상위 properties가
아니라 initial_data_source.properties로 보낸다.
"""

import time
from collections.abc import Iterator

import httpx

NOTION_VERSION = "2026-03-11"
NOTION_API_BASE = "https://api.notion.com/v1"
MAX_RETRIES = 3

ANALYSIS_DB_PROPERTIES: dict[str, dict] = {
    "원본 제목": {"type": "title", "title": {}},
    "원문 URL": {"type": "url", "url": {}},
    "핵심 키워드": {"type": "multi_select", "multi_select": {"options": []}},
    "검색 의도": {"type": "rich_text", "rich_text": {}},
    "SEO 제목": {"type": "rich_text", "rich_text": {}},
    "Meta Description": {"type": "rich_text", "rich_text": {}},
    "사용자 예상 질문/답변": {"type": "rich_text", "rich_text": {}},
    "핵심 Entity": {"type": "multi_select", "multi_select": {"options": []}},
    "근거 문장/출처": {"type": "rich_text", "rich_text": {}},
    "AI 요약": {"type": "rich_text", "rich_text": {}},
    "Content Score": {"type": "number", "number": {"format": "number"}},
    "검수 상태": {
        "type": "select",
        "select": {
            "options": [
                {"name": "대기", "color": "gray"},
                {"name": "검토중", "color": "yellow"},
                {"name": "승인", "color": "green"},
                {"name": "반려", "color": "red"},
            ]
        },
    },
    "발행 상태": {
        "type": "select",
        "select": {
            "options": [
                {"name": "미발행", "color": "gray"},
                {"name": "예약", "color": "blue"},
                {"name": "발행완료", "color": "green"},
            ]
        },
    },
    "AI 인용 여부": {"type": "checkbox", "checkbox": {}},
    "AI 검색 순위": {"type": "number", "number": {"format": "number"}},
}


def get_http_client() -> Iterator[httpx.Client]:
    with httpx.Client(timeout=30.0) as client:
        yield client


def _request_with_retry(client: httpx.Client, path: str, token: str, *, json_body: dict) -> dict:
    """POST {NOTION_API_BASE}{path}, backing off on 429/Retry-After.

    background.js's notionFetch() backs off the same way; create_analysis_database(),
    query_data_source() 모두 이 헬퍼를 공유해서 재시도 로직이 한 곳에만 있게 한다.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    for attempt in range(MAX_RETRIES):
        response = client.post(f"{NOTION_API_BASE}{path}", headers=headers, json=json_body)
        if response.status_code == 429 and attempt < MAX_RETRIES - 1:
            retry_after = float(response.headers.get("Retry-After", "1"))
            time.sleep(retry_after)
            continue
        response.raise_for_status()
        return response.json()
    response.raise_for_status()
    return response.json()


def create_analysis_database(parent_page_id: str, token: str, client: httpx.Client) -> dict:
    return _request_with_retry(
        client,
        "/databases",
        token,
        json_body={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": "SEO/AEO/GEO 분석 DB"}}],
            "initial_data_source": {"properties": ANALYSIS_DB_PROPERTIES},
        },
    )


def query_data_source(
    data_source_id: str,
    token: str,
    client: httpx.Client,
    *,
    filter: dict | None = None,
    start_cursor: str | None = None,
    page_size: int = 100,
) -> dict:
    body: dict = {"page_size": page_size}
    if filter is not None:
        body["filter"] = filter
    if start_cursor is not None:
        body["start_cursor"] = start_cursor
    return _request_with_retry(client, f"/data_sources/{data_source_id}/query", token, json_body=body)


def iterate_data_source(
    data_source_id: str,
    token: str,
    client: httpx.Client,
    *,
    filter: dict | None = None,
) -> Iterator[dict]:
    """data_source_id의 모든 페이지를 has_more/next_cursor를 따라가며 순회한다.

    backend/app/ingest.py가 Notion RAW DB 전체를 매주 재조회할 때 쓴다.
    """
    cursor: str | None = None
    while True:
        result = query_data_source(data_source_id, token, client, filter=filter, start_cursor=cursor)
        yield from result.get("results", [])
        if not result.get("has_more"):
            return
        cursor = result.get("next_cursor")
        if not cursor:
            return
