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
export ANTHROPIC_API_KEY=sk-ant-...   # POST /jobs/{id}/analyze 호출 시 필요
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
```

## 범위

- `/health`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/analyze` 제공
- `POST /jobs/{id}/analyze`: 저장된 job payload를 Claude API(`claude-opus-5`)에 한 번 호출해
  `claudeRead.md` §5.1 스키마(keywords/search_intent/seo/aeo/geo)로 구조화 출력을 받아
  저장하고 반환한다. `source_id`/`source_url`은 LLM이 생성하지 않고 서버가 채운다
  (LLM이 ID/URL을 잘못 옮겨 적을 위험을 없애기 위함).
- PostgreSQL 연결, 집계 배치, Notion 분석 DB 연동, GEO 모니터링은 다음 단계 TODO
- 테스트 코드는 `codex exec`로 별도 작성 (저장소 루트 `CLAUDE.md` 참고)
