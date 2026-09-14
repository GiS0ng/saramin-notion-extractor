# SEO/AEO/GEO 분석 백엔드 (최소 스캐폴드)

`saramin-notion-extractor` 수집기 뒤에 붙는 분석 백엔드. 현재는 `claudeRead.md`
TODO의 첫 단계인 최소 스캐폴드로, PostgreSQL 없이 인메모리 저장소만 사용한다.

## 실행

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
```

## 범위

- `/health`, `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`만 제공
- PostgreSQL 연결, LLM 호출, Notion 연동은 다음 단계 TODO
- 테스트 코드는 `codex exec`로 별도 작성 (저장소 루트 `CLAUDE.md` 참고)
