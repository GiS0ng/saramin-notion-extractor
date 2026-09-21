from typing import Any

from app.ingest import ingest_raw_jobs, notion_page_to_job_dict


def _text_property(kind: str, *chunks: str) -> dict[str, Any]:
    return {kind: [{"plain_text": chunk} for chunk in chunks]}


def _page(page_id: str, source_url: str | None) -> dict[str, Any]:
    return {
        "id": page_id,
        "properties": {
            "회사/직무(제목)": _text_property("title", "백엔드 ", "개발자"),
            "공고링크": {"url": source_url},
            "주요업무": _text_property("rich_text", "API ", "개발"),
            "지원자격": _text_property("rich_text", "Python"),
            "우대사항": _text_property("rich_text", "PostgreSQL"),
            "기술스택": {"multi_select": [{"name": "Python"}, {"name": "FastAPI"}]},
            "자격/어학": _text_property("rich_text", "무관"),
            "근무조건/복지": _text_property("rich_text", "재택 가능"),
            "지역": _text_property("rich_text", "서울 ", "강남구"),
            "마감일": {"date": {"start": "2026-10-31", "end": None}},
        },
    }


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

    def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> FakeResponse:
        return FakeResponse(next(self.payloads))


class RecordingRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, str, str]] = []

    def upsert_by_source_url(self, payload: Any, source_url: str, notion_page_id: str) -> None:
        self.calls.append((payload, source_url, notion_page_id))


def test_notion_page_to_job_dict_maps_all_supported_property_types() -> None:
    result = notion_page_to_job_dict(_page("page-1", "https://jobs.example/1"))

    assert result == {
        "회사/직무(제목)": "백엔드 개발자",
        "공고링크": "https://jobs.example/1",
        "주요업무": "API 개발",
        "지원자격": "Python",
        "우대사항": "PostgreSQL",
        "기술스택": ["Python", "FastAPI"],
        "자격/어학": "무관",
        "근무조건/복지": "재택 가능",
        "지역": "서울 강남구",
        "마감일": "2026-10-31",
    }


def test_ingest_raw_jobs_upserts_across_pages_and_skips_missing_urls() -> None:
    client = FakeHttpClient(
        [
            {
                "results": [_page("page-1", "https://jobs.example/1"), _page("page-2", "")],
                "has_more": True,
                "next_cursor": "cursor-2",
            },
            {
                "results": [_page("page-3", None), _page("page-4", "https://jobs.example/4")],
                "has_more": False,
                "next_cursor": None,
            },
        ]
    )
    repo = RecordingRepository()

    summary = ingest_raw_jobs("token", "source", client, repo)  # type: ignore[arg-type]

    assert summary.fetched == 4
    assert summary.upserted == 2
    assert [(url, page_id) for _, url, page_id in repo.calls] == [
        ("https://jobs.example/1", "page-1"),
        ("https://jobs.example/4", "page-4"),
    ]
    assert repo.calls[0][0].model_dump()["회사/직무(제목)"] == "백엔드 개발자"
