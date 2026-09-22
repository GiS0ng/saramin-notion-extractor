from datetime import datetime, timezone
from typing import Any

from app.github_match import (
    GITHUB_API_BASE,
    build_github_match_report,
    fetch_github_skill_profile,
    rank_jobs_for_profile,
)
from app.schemas import GithubSkillProfile, JobIn, JobRecord


class FakeResponse:
    def __init__(self, payload: Any) -> None:
        self.payload = payload

    def json(self) -> Any:
        return self.payload

    def raise_for_status(self) -> None:
        return None


class FakeHttpClient:
    def __init__(self, responses: dict[tuple[str, int | None], Any]) -> None:
        self.responses = responses
        self.calls: list[dict[str, Any]] = []

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str],
        params: dict[str, Any] | None = None,
    ) -> FakeResponse:
        self.calls.append({"url": url, "headers": headers, "params": params})
        page = params.get("page") if params else None
        return FakeResponse(self.responses[(url, page)])


def make_job(
    job_id: str,
    title: str,
    skills: list[str],
    deadline: str | None,
) -> JobRecord:
    payload: dict[str, Any] = {
        "회사/직무(제목)": title,
        "공고링크": f"https://jobs.example/{job_id}",
        "기술스택": skills,
    }
    if deadline is not None:
        payload["마감일"] = deadline
    return JobRecord(
        id=job_id,
        received_at=datetime(2025, 9, 20, tzinfo=timezone.utc),
        payload=JobIn(**payload),
    )


def test_fetch_github_skill_profile_paginates_and_combines_languages_and_topics() -> None:
    repos_url = f"{GITHUB_API_BASE}/users/octocat/repos"
    first_page = [
        {"name": "main", "fork": False, "topics": ["PowerBI", "unknown-topic"]},
        {"name": "forked", "fork": True, "topics": ["python"]},
        *[
            {"name": f"fork-{index}", "fork": True, "topics": []}
            for index in range(98)
        ],
    ]
    second_page = [{"name": "secondary", "fork": False, "topics": ["python"]}]
    client = FakeHttpClient(
        {
            (repos_url, 1): first_page,
            (repos_url, 2): second_page,
            (f"{GITHUB_API_BASE}/repos/octocat/main/languages", None): {
                "Python": 120,
                "CMake": 20,
            },
            (f"{GITHUB_API_BASE}/repos/octocat/secondary/languages", None): {
                "Python": 30,
                "Java": 50,
            },
        }
    )

    profile = fetch_github_skill_profile("octocat", "secret", client)  # type: ignore[arg-type]

    assert profile.username == "octocat"
    assert profile.skill_weights == {"Python": 151, "Power BI": 1, "Java": 50}
    assert [call["params"]["page"] for call in client.calls if call["params"]] == [1, 2]
    assert not any("/forked/languages" in call["url"] for call in client.calls)
    assert all(call["headers"]["Authorization"] == "Bearer secret" for call in client.calls)


def test_rank_jobs_filters_deadlines_calculates_match_and_applies_top_n() -> None:
    profile = GithubSkillProfile(username="octocat", skill_weights={"Python": 100, "Java": 50})
    jobs = [
        make_job("full", "Full match", ["Python", "Java"], "2025-09-22"),
        make_job("half-two", "Half with two matches", ["Python", "Java", "Go", "Rust"], None),
        make_job("half-one", "Half with one match", ["Python", "Go"], "not-a-date"),
        make_job("future", "Future partial", ["Java", "Go", "Rust"], "2025-09-23"),
        make_job("past", "Closed", ["Python"], "2025-09-21"),
        make_job("empty", "No skills", [], "2025-09-23"),
    ]

    ranked = rank_jobs_for_profile(
        jobs,
        profile,
        now=datetime(2025, 9, 22, 3, 0, tzinfo=timezone.utc),
        top_n=3,
    )

    assert [(rec.rank, rec.title, rec.match_pct) for rec in ranked] == [
        (1, "Full match", 100.0),
        (2, "Half with two matches", 50.0),
        (3, "Half with one match", 50.0),
    ]
    assert ranked[1].matched_skills == ["Java", "Python"]
    assert ranked[1].missing_skills == ["Go", "Rust"]
    assert {rec.title for rec in ranked}.isdisjoint({"Closed", "No skills", "Future partial"})


def test_build_github_match_report_period_uses_now_in_kst() -> None:
    profile = GithubSkillProfile(username="octocat", skill_weights={})

    report = build_github_match_report(
        "octocat",
        [],
        profile,
        now=datetime(2025, 9, 21, 18, 0, tzinfo=timezone.utc),
    )

    assert report.username == "octocat"
    assert report.period == "2025-09-22"
    assert report.recommendations == []
