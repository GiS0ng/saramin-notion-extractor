import anthropic
from fastapi import APIRouter, Depends, HTTPException

from app.llm import analyze_job, get_anthropic_client
from app.repository import JobRepository, get_job_repository
from app.schemas import AnalysisResult, JobIn, JobRecord

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=JobRecord, status_code=201)
def create_job(job: JobIn, repo: JobRepository = Depends(get_job_repository)) -> JobRecord:
    return repo.add(job)


@router.get("", response_model=list[JobRecord])
def list_jobs(repo: JobRepository = Depends(get_job_repository)) -> list[JobRecord]:
    return repo.list()


@router.get("/{job_id}", response_model=JobRecord)
def get_job(job_id: str, repo: JobRepository = Depends(get_job_repository)) -> JobRecord:
    record = repo.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")
    return record


@router.post("/{job_id}/analyze", response_model=JobRecord)
def analyze(
    job_id: str,
    repo: JobRepository = Depends(get_job_repository),
    client: anthropic.Anthropic = Depends(get_anthropic_client),
) -> JobRecord:
    record = repo.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="job not found")

    try:
        llm_output = analyze_job(record.payload, client)
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM 호출 실패: {exc}") from exc
    except TypeError as exc:
        # anthropic SDK는 자격증명(ANTHROPIC_API_KEY 등)을 못 찾으면 APIError가 아닌
        # TypeError를 던진다. 별도로 잡아 설정 문제라는 걸 명확히 알려준다.
        raise HTTPException(
            status_code=500,
            detail=f"Anthropic 인증 정보가 설정되지 않았습니다 (ANTHROPIC_API_KEY 환경변수 필요): {exc}",
        ) from exc

    source_url = record.payload.model_dump().get("공고링크", "")
    analysis = AnalysisResult(source_id=record.id, source_url=source_url, **llm_output.model_dump())

    updated = repo.set_analysis(job_id, analysis)
    if updated is None:
        raise HTTPException(status_code=404, detail="job not found")
    return updated
