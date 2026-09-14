# SEO/AEO/GEO 분석 백엔드 (최소 스캐폴드)

`saramin-notion-extractor` 수집기 뒤에 붙는 분석 백엔드. `claudeRead.md`
TODO 기준으로 PostgreSQL 없이 인메모리 저장소만 사용하며, LLM 구조화 출력(§5.1)까지
구현되어 있다.

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
- PostgreSQL 연결, GEO 모니터링은 다음 단계 TODO
- 테스트 코드는 `codex exec`로 별도 작성 (저장소 루트 `CLAUDE.md` 참고)
