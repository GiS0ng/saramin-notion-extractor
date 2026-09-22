"""GitHub 프로필 기반 채용공고 매칭.

저장소 소유자 본인(단일 사용자) 한 명의 GitHub 공개 저장소 언어/토픽을 core.js 스킬
어휘로 정규화해서, 채용공고의 기술스택과 얼마나 겹치는지로 추천 순위를 매긴다.
"""

from datetime import date, datetime, timezone

import httpx

from app.aggregation import KST
from app.schemas import GithubMatchReport, GithubSkillProfile, JobRecord, RecommendedCompany
from app.skills import normalize_skill_name

GITHUB_API_BASE = "https://api.github.com"
TOP_N_RECOMMENDATIONS = 20


def _headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _list_owned_repos(username: str, token: str, http_client: httpx.Client) -> list[dict]:
    """소유한(fork 아닌) 저장소를 페이지네이션으로 모두 모은다."""
    repos: list[dict] = []
    page = 1
    while True:
        response = http_client.get(
            f"{GITHUB_API_BASE}/users/{username}/repos",
            headers=_headers(token),
            params={"type": "owner", "per_page": 100, "page": page},
        )
        response.raise_for_status()
        batch = response.json()
        repos.extend(repo for repo in batch if not repo.get("fork"))
        if len(batch) < 100:
            return repos
        page += 1


def _repo_languages(username: str, repo_name: str, token: str, http_client: httpx.Client) -> dict[str, int]:
    response = http_client.get(
        f"{GITHUB_API_BASE}/repos/{username}/{repo_name}/languages", headers=_headers(token)
    )
    response.raise_for_status()
    return response.json()


def fetch_github_skill_profile(username: str, token: str, http_client: httpx.Client) -> GithubSkillProfile:
    """공개 저장소의 바이트 가중 언어 통계 + topics를 core.js 스킬 어휘로 정규화해 합산한다.

    language 하나만 보는 것보다, 저장소별 바이트 가중 언어 분포(GitHub의 languages API)를
    쓰면 "이 저장소는 사실 Python이 대부분이고 CMake는 빌드 스크립트일 뿐" 같은 걸 반영할
    수 있다. topics는 저장소 개수만큼(1)만 가중해 언어 바이트 수와 스케일이 다르지만,
    어차피 순위 매기기(rank_jobs_for_profile)는 "보유 여부"만 보므로 무관하다.
    """
    weights: dict[str, int] = {}
    for repo in _list_owned_repos(username, token, http_client):
        languages = _repo_languages(username, repo["name"], token, http_client)
        for language, byte_count in languages.items():
            skill = normalize_skill_name(language)
            if skill:
                weights[skill] = weights.get(skill, 0) + byte_count
        for topic in repo.get("topics") or []:
            skill = normalize_skill_name(topic)
            if skill:
                weights[skill] = weights.get(skill, 0) + 1
    return GithubSkillProfile(username=username, skill_weights=weights)


def _is_currently_open(payload: dict, today: date) -> bool:
    """마감일이 없거나(상시모집 등) 파싱 불가능한 공고는 지원 가능한 것으로 간주한다.

    확정된 과거 날짜만 명확히 마감된 것으로 보고 제외한다 — "확인필요"/빈 값을 제외하면
    상시모집 공고가 추천에서 전부 빠지게 된다.
    """
    deadline_str = payload.get("마감일") or ""
    if not deadline_str:
        return True
    try:
        deadline = date.fromisoformat(deadline_str)
    except ValueError:
        return True
    return deadline >= today


def rank_jobs_for_profile(
    jobs: list[JobRecord],
    profile: GithubSkillProfile,
    *,
    now: datetime | None = None,
    top_n: int = TOP_N_RECOMMENDATIONS,
) -> list[RecommendedCompany]:
    today = (now or datetime.now(timezone.utc)).astimezone(KST).date()
    profile_skills = set(profile.skill_weights)

    candidates: list[RecommendedCompany] = []
    for job in jobs:
        payload = job.payload.model_dump()
        if not _is_currently_open(payload, today):
            continue
        job_skills = set(payload.get("기술스택") or [])
        if not job_skills:
            continue
        matched = sorted(job_skills & profile_skills)
        missing = sorted(job_skills - profile_skills)
        candidates.append(
            RecommendedCompany(
                rank=0,
                title=payload.get("회사/직무(제목)", ""),
                url=payload.get("공고링크", ""),
                match_pct=round(len(matched) / len(job_skills) * 100, 1),
                matched_skills=matched,
                missing_skills=missing,
            )
        )

    candidates.sort(key=lambda rec: (-rec.match_pct, -len(rec.matched_skills)))
    top = candidates[:top_n]
    for index, rec in enumerate(top, start=1):
        rec.rank = index
    return top


def build_github_match_report(
    username: str,
    jobs: list[JobRecord],
    profile: GithubSkillProfile,
    *,
    now: datetime | None = None,
    top_n: int = TOP_N_RECOMMENDATIONS,
) -> GithubMatchReport:
    now = now or datetime.now(timezone.utc)
    period = now.astimezone(KST).date().isoformat()
    recommendations = rank_jobs_for_profile(jobs, profile, now=now, top_n=top_n)
    return GithubMatchReport(username=username, period=period, recommendations=recommendations)
