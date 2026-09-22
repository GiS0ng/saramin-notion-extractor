"""주간 리포트 진입점.

GitHub Actions cron(Phase D)이 매주 금요일 이 스크립트를 실행한다:
Notion RAW DB ingest → 지역별 기술스택 집계 + GitHub 매칭 추천 → 각각의 Notion 리포트 DB에 기록.

--skip-github는 GITHUB_MATCH_* 환경변수가 아직 없거나 GitHub 매칭 리포트를 건너뛰고 싶을 때 쓴다.
--dry-run은 실제로 아무것도 쓰지 않고 집계 결과만 stdout에 출력한다 — 새 환경에서 데이터/권한이
맞게 연결됐는지 먼저 확인할 때 쓴다.

실행 예:
    cd backend && .venv/bin/python -m scripts.weekly_report --dry-run --skip-github
"""

import argparse
import os
import sys

import httpx

from app.db import get_engine, init_db
from app.github_match import build_github_match_report, fetch_github_skill_profile
from app.ingest import ingest_raw_jobs
from app.notion_reports import append_github_match_rows, append_region_report_rows
from app.region_aggregation import build_region_skill_report
from app.repository import PostgresJobRepository


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Notion에 쓰지 않고 결과만 출력")
    parser.add_argument("--skip-github", action="store_true", help="GitHub 매칭 리포트는 건너뛴다")
    return parser.parse_args(argv)


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"필수 환경변수 {name}이 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)
    return value


def run_region_report(jobs: list, client: httpx.Client, notion_token: str, dry_run: bool) -> None:
    report = build_region_skill_report(jobs)
    print(f"[지역별 리포트] 집계 기간: {report.period} (표본 {report.sample_size}건, 리포트 행 {len(report.stats)}개)")
    for stat in report.stats:
        print(f"  {stat.region:>8} · {stat.skill:<12} {stat.frequency_pct:5.1f}%  ({stat.job_count}건)")

    if dry_run:
        print("[지역별 리포트] --dry-run: Notion에 쓰지 않았습니다.")
        return
    report_data_source_id = _require_env("NOTION_REGION_REPORT_DATA_SOURCE_ID")
    created = append_region_report_rows(
        report.stats, report.period, report_data_source_id, notion_token, client
    )
    print(f"[지역별 리포트] Notion에 {len(created)}개 지역 행을 기록했습니다.")


def run_github_match_report(jobs: list, client: httpx.Client, notion_token: str, dry_run: bool) -> None:
    username = _require_env("GITHUB_MATCH_USERNAME")
    github_token = _require_env("GITHUB_MATCH_TOKEN")

    profile = fetch_github_skill_profile(username, github_token, client)
    print(f"[GitHub 매칭] {username}의 보유 기술: {sorted(profile.skill_weights)}")

    report = build_github_match_report(username, jobs, profile)
    print(f"[GitHub 매칭] 집계일: {report.period} (추천 {len(report.recommendations)}건)")
    for rec in report.recommendations:
        print(f"  {rec.rank}. {rec.title[:50]} | {rec.match_pct}% | 일치: {rec.matched_skills}")

    if dry_run:
        print("[GitHub 매칭] --dry-run: Notion에 쓰지 않았습니다.")
        return
    report_data_source_id = _require_env("NOTION_GITHUB_REPORT_DATA_SOURCE_ID")
    created = append_github_match_rows(
        report.recommendations, report.period, report_data_source_id, notion_token, client
    )
    print(f"[GitHub 매칭] Notion에 {len(created)}개 추천 행을 기록했습니다.")


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    notion_token = _require_env("NOTION_TOKEN")
    raw_data_source_id = _require_env("NOTION_RAW_DATA_SOURCE_ID")

    engine = get_engine(short_lived=True)
    init_db(engine)
    repo = PostgresJobRepository(engine)

    with httpx.Client(timeout=30.0) as client:
        summary = ingest_raw_jobs(notion_token, raw_data_source_id, client, repo)
        print(f"ingest: 조회 {summary.fetched}건, upsert {summary.upserted}건")

        jobs = repo.list()
        run_region_report(jobs, client, notion_token, args.dry_run)
        if args.skip_github:
            print("[GitHub 매칭] --skip-github: 건너뛰었습니다.")
        else:
            run_github_match_report(jobs, client, notion_token, args.dry_run)

    engine.dispose()


if __name__ == "__main__":
    main()
