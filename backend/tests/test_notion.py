from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.notion import ANALYSIS_DB_PROPERTIES, get_http_client


class FakeResponse:
    def __init__(self, status_code: int, payload: dict[str, Any], text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if 400 <= self.status_code:
            request = httpx.Request("POST", "https://api.notion.com/v1/databases")
            raise httpx.HTTPStatusError(
                f"Notion returned {self.status_code}",
                request=request,
                response=self,  # type: ignore[arg-type]
            )


class FakeHttpClient:
    def __init__(
        self,
        response: FakeResponse | None = None,
        error: httpx.HTTPError | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> FakeResponse:
        self.calls.append({"url": url, "headers": headers, "json": json})
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


@pytest.fixture
def make_client():
    clients: list[TestClient] = []

    def _make(fake_http_client: FakeHttpClient) -> TestClient:
        app.dependency_overrides[get_http_client] = lambda: fake_http_client
        client = TestClient(app, backend_options={"use_uvloop": True})
        clients.append(client)
        return client

    try:
        yield _make
    finally:
        for client in clients:
            client.close()
        app.dependency_overrides.pop(get_http_client, None)


def test_missing_notion_token_returns_500(monkeypatch: pytest.MonkeyPatch, make_client) -> None:
    monkeypatch.delenv("NOTION_TOKEN", raising=False)
    fake_http_client = FakeHttpClient()
    client = make_client(fake_http_client)

    response = client.post(
        "/notion/analysis-database",
        json={"parent_page_id": "parent-page-id"},
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "NOTION_TOKEN 환경변수가 설정되지 않았습니다"}
    assert fake_http_client.calls == []


def test_create_analysis_database_success(monkeypatch: pytest.MonkeyPatch, make_client) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    fake_http_client = FakeHttpClient(
        response=FakeResponse(
            200,
            {
                "id": "database-id",
                "data_sources": [{"id": "data-source-id"}],
                "url": "https://www.notion.so/database-id",
            },
        )
    )
    client = make_client(fake_http_client)

    response = client.post(
        "/notion/analysis-database",
        json={"parent_page_id": "requested-parent-page-id"},
    )

    assert response.status_code == 201
    assert response.json() == {
        "database_id": "database-id",
        "data_source_id": "data-source-id",
        "url": "https://www.notion.so/database-id",
        "properties": list(ANALYSIS_DB_PROPERTIES.keys()),
    }
    assert len(fake_http_client.calls) == 1
    call = fake_http_client.calls[0]
    assert call["url"] == "https://api.notion.com/v1/databases"
    assert call["json"]["parent"]["page_id"] == "requested-parent-page-id"
    assert call["json"]["initial_data_source"]["properties"] == ANALYSIS_DB_PROPERTIES


def test_notion_401_returns_502(monkeypatch: pytest.MonkeyPatch, make_client) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    fake_http_client = FakeHttpClient(
        response=FakeResponse(401, {"object": "error"}, text="unauthorized")
    )
    client = make_client(fake_http_client)

    response = client.post(
        "/notion/analysis-database",
        json={"parent_page_id": "parent-page-id"},
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Notion API 오류 401: unauthorized"}


def test_notion_network_error_returns_502(
    monkeypatch: pytest.MonkeyPatch, make_client
) -> None:
    monkeypatch.setenv("NOTION_TOKEN", "test-token")
    request = httpx.Request("POST", "https://api.notion.com/v1/databases")
    fake_http_client = FakeHttpClient(error=httpx.ConnectError("connection failed", request=request))
    client = make_client(fake_http_client)

    response = client.post(
        "/notion/analysis-database",
        json={"parent_page_id": "parent-page-id"},
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Notion API 호출 실패: connection failed"}
