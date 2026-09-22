# SEO/AEO/GEO 분석 백엔드 (최소 스캐폴드)

`saramin-notion-extractor` 수집기 뒤에 붙는 분석 백엔드. LLM 구조화 출력(§5.1)에 더해
`DATABASE_URL`이 설정되면 PostgreSQL 저장소를 쓴다(없으면 인메모리로 자동 폴백) — 아래
"주간 리포트" 절 참고.

## 실행

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...   # POST /jobs/{id}/analyze, /batches/analyze 호출 시 필요
export NOTION_TOKEN=ntn_...           # POST /notion/analysis-database 호출 시 필요
uvicorn app.main:app --reload --port 8000
```

## 확인

브라우저에서 `http://127.0.0.1:8000/docs` (Swagger UI)로 바로 확인 가능.

또는 curl로:

```bash
# 헬스체크
curl -s http://127.0.0.1:8000/health

# job 등록
curl -s -X POST http://127.0.0.1:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{"회사/직무(제목)": "테스트 공고", "공고링크": "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=12345"}'

# 목록 확인
curl -s http://127.0.0.1:8000/jobs

# 단건 조회 (위 응답의 id 사용)
curl -s http://127.0.0.1:8000/jobs/<id>

# LLM 구조화 출력(SEO/AEO/GEO) 분석 — ANTHROPIC_API_KEY 필요
curl -s -X POST http://127.0.0.1:8000/jobs/<id>/analyze

# 집계 배치 — 분석 완료된 job이 10건 이상 있어야 함 (미만이면 422)
curl -s -X POST http://127.0.0.1:8000/batches/analyze

# 집계 배치 목록/단건 조회
curl -s http://127.0.0.1:8000/batches
curl -s http://127.0.0.1:8000/batches/<batch_id>

# Notion 분석 DB 템플릿 생성 — 실제 Notion 워크스페이스에 DB가 생성됨 (주의: 되돌리기 어려움)
curl -s -X POST http://127.0.0.1:8000/notion/analysis-database \
  -H "Content-Type: application/json" \
  -d '{"parent_page_id": "<DB를 생성할 부모 페이지 ID>"}'
```

## 범위

- `/health`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/analyze` 제공
- `POST /jobs/{id}/analyze`: 저장된 job payload를 Claude API(`claude-opus-5`)에 한 번 호출해
  `claudeRead.md` §5.1 스키마(keywords/search_intent/seo/aeo/geo)로 구조화 출력을 받아
  저장하고 반환한다. `source_id`/`source_url`은 LLM이 생성하지 않고 서버가 채운다
  (LLM이 ID/URL을 잘못 옮겨 적을 위험을 없애기 위함).
- `POST /batches/analyze`, `GET /batches`, `GET /batches/{id}`: `claudeRead.md` §5.2 집계
  배치. 분석(`/jobs/{id}/analyze`)이 끝난 job들의 `keywords`를 모아 등장 빈도(%)를 계산하고,
  그 통계를 다시 Claude API에 한 번 더 넣어 데이터저널리즘형 콘텐츠 초안
  (`generated_content_draft`: seo_title/aeo_qna/geo_summary)까지 생성한다.
  최소 표본 크기는 **10건**(`app/aggregation.py`의 `MIN_SAMPLE_SIZE`) — 미달이면 `422`.
- `POST /notion/analysis-database`: `claudeRead.md` §5.3 컬럼 표(핵심 키워드/검색 의도/
  SEO 제목/사용자 예상 질문·답변/핵심 Entity/근거 문장·출처/AI 요약/Content Score/검수
  상태/발행 상태/AI 인용 여부/AI 검색 순위 등)를 그대로 옮긴 **빈 Notion 데이터베이스**를
  실제로 생성한다. 이 DB는 사람이 채우는 에디토리얼 워크플로우용이라 생성 시점에는 데이터를
  채워 넣지 않는다. 기존 수집기의 RAW DB(`docs/notion-setup.md`)와는 별개의 새 DB다.
  - **사전 조건**: `parent_page_id`로 넘긴 Notion 페이지에 `NOTION_TOKEN`의 내부 연결을
    미리 추가해야 한다 (`docs/notion-setup.md` §4와 동일한 절차 — 연결 추가 안 하면 404).
  - **주의**: 호출하면 실제 워크스페이스에 데이터베이스가 즉시 생성된다. 삭제는 Notion에서
    수동으로 해야 하므로, 실제 API 키로 테스트하기 전에 이 사실을 인지할 것.
- GEO 모니터링은 다음 단계 TODO
- 테스트 코드는 `codex exec`로 별도 작성 (저장소 루트 `CLAUDE.md` 참고)

## 주간 리포트 (지역별 기술스택 + GitHub 매칭 추천)

`scripts/weekly_report.py`가 단일 진입점이다: Notion RAW DB ingest → 지역별 기술스택 집계
→ GitHub 매칭 추천 → 각각의 Notion 리포트 DB에 기록. `.github/workflows/weekly-report.yml`이
매주 금요일 10:00 KST에 이걸 실행한다(`workflow_dispatch`로 수동 실행도 가능).

### 필요한 환경변수

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | Postgres 연결 문자열(`postgresql+psycopg://...`) — job 저장소 |
| `NOTION_TOKEN` | 기존 내부 연결 토큰. RAW DB와 두 리포트 DB 모두에 연결을 추가해야 함 |
| `NOTION_RAW_DATA_SOURCE_ID` | 확장 프로그램이 쓰는 RAW DB의 데이터 소스 ID(`docs/notion-setup.md` §6) |
| `NOTION_REGION_REPORT_DATA_SOURCE_ID` | `POST /notion/region-report-database`로 만든 DB의 데이터 소스 ID |
| `NOTION_GITHUB_REPORT_DATA_SOURCE_ID` | `POST /notion/github-match-database`로 만든 DB의 데이터 소스 ID |
| `GITHUB_MATCH_USERNAME` | 매칭 대상 GitHub 사용자명(단일 사용자) |
| `GITHUB_MATCH_TOKEN` | GitHub PAT(fine-grained, Public Repositories 읽기 권한만) — 없어도 동작하지만 레이트리밋이 60/hr로 줄어듦 |

로컬에서는 `backend/.env`에 위 값을 넣고 `set -a && source .env && set +a` 후 실행하면 된다
(`.env`는 `.gitignore`에 있어 커밋되지 않음). GitHub Actions에서는 저장소 시크릿으로 등록한다 —
단, 시크릿 이름은 `GITHUB_` 접두사를 쓸 수 없으므로 `GITHUB_MATCH_USERNAME`/`GITHUB_MATCH_TOKEN`은
각각 `GH_MATCH_USERNAME`/`GH_MATCH_TOKEN`이라는 이름으로 등록하고, 워크플로우가 실행 시점에
`GITHUB_MATCH_*` 이름으로 다시 매핑한다(`.github/workflows/weekly-report.yml` 참고).

### 리포트 DB 최초 생성 (한 번만)

```bash
curl -s -X POST http://127.0.0.1:8000/notion/region-report-database \
  -H "Content-Type: application/json" -d '{"parent_page_id": "<부모 페이지 ID>"}'

curl -s -X POST http://127.0.0.1:8000/notion/github-match-database \
  -H "Content-Type: application/json" -d '{"parent_page_id": "<부모 페이지 ID>"}'
```

응답의 `data_source_id`를 각각 `NOTION_REGION_REPORT_DATA_SOURCE_ID`/
`NOTION_GITHUB_REPORT_DATA_SOURCE_ID`로 저장한다. `parent_page_id`는 **일반 페이지**여야 하며
(데이터베이스 자체는 부모가 될 수 없다), `NOTION_TOKEN`의 내부 연결이 그 페이지에 미리
추가돼 있어야 한다(`docs/notion-setup.md` §4와 동일).

### 실행

```bash
cd backend && .venv/bin/python -m scripts.weekly_report            # 실제로 Notion에 기록
cd backend && .venv/bin/python -m scripts.weekly_report --dry-run  # 집계만 하고 쓰지 않음
cd backend && .venv/bin/python -m scripts.weekly_report --skip-github  # 지역별 리포트만
```
