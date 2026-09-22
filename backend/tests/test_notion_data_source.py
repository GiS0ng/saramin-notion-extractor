from typing import Any

from app.notion import NOTION_VERSION, iterate_data_source, query_data_source


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.status_code = 200
        self.headers: dict[str, str] = {}
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        return None


class FakeHttpClient:
    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self.payloads = iter(payloads)
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> FakeResponse:
        self.calls.append({"url": url, "headers": headers, "json": json})
        return FakeResponse(next(self.payloads))


def test_query_data_source_posts_expected_url_and_body() -> None:
    client = FakeHttpClient([{"results": [], "has_more": False, "next_cursor": None}])
    notion_filter = {"property": "지역", "rich_text": {"contains": "서울"}}

    result = query_data_source(
        "source/id",
        "secret-token",
        client,  # type: ignore[arg-type]
        filter=notion_filter,
        start_cursor="cursor-1",
        page_size=25,
    )

    assert result["results"] == []
    assert client.calls == [
        {
            "url": "https://api.notion.com/v1/data_sources/source/id/query",
            "headers": {
                "Authorization": "Bearer secret-token",
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            },
            "json": {
                "page_size": 25,
                "filter": notion_filter,
                "start_cursor": "cursor-1",
            },
        }
    ]


def test_iterate_data_source_follows_cursor_until_last_page() -> None:
    client = FakeHttpClient(
        [
            {"results": [{"id": "page-1"}], "has_more": True, "next_cursor": "next-1"},
            {
                "results": [{"id": "page-2"}, {"id": "page-3"}],
                "has_more": False,
                "next_cursor": None,
            },
        ]
    )

    pages = list(iterate_data_source("data-source", "token", client))  # type: ignore[arg-type]

    assert [page["id"] for page in pages] == ["page-1", "page-2", "page-3"]
    assert [call["json"] for call in client.calls] == [
        {"page_size": 100},
        {"page_size": 100, "start_cursor": "next-1"},
    ]
