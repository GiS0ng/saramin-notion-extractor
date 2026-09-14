"""Notion 분석 DB 템플릿 생성.

claudeRead.md §5.3 컬럼 표를 그대로 Notion 데이터베이스 속성으로 옮긴다. 이 DB는
사람이 채우는 에디토리얼 워크플로우용(검수/발행 상태)이라 생성 시점에는 빈 템플릿만
만들고 데이터를 채워 넣지 않는다.

기존 확장(background.js)과 동일한 Notion API 버전(2026-03-11)을 쓴다. Notion API
2025-09-03 이후 데이터베이스와 데이터 소스가 분리됐으므로, 속성은 최상위 properties가
아니라 initial_data_source.properties로 보낸다.
"""

import httpx

NOTION_VERSION = "2026-03-11"
NOTION_API_BASE = "https://api.notion.com/v1"

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


def get_http_client() -> httpx.Client:
    return httpx.Client(timeout=30.0)


def create_analysis_database(parent_page_id: str, token: str, client: httpx.Client) -> dict:
    response = client.post(
        f"{NOTION_API_BASE}/databases",
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        json={
            "parent": {"type": "page_id", "page_id": parent_page_id},
            "title": [{"type": "text", "text": {"content": "SEO/AEO/GEO 분석 DB"}}],
            "initial_data_source": {"properties": ANALYSIS_DB_PROPERTIES},
        },
    )
    response.raise_for_status()
    return response.json()
