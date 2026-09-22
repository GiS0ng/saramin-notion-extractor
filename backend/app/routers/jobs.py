import anthropic
from fastapi import APIRouter, Depends, HTTPException

from app.errors import translate_missing_credentials
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
        with translate_missing_credentials():
            llm_output = analyze_job(record.payload, client)
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM 호출 실패: {exc}") from exc

    source_url = record.payload.model_dump().get("공고링크", "")
    analysis = AnalysisResult(source_id=record.id, source_url=source_url, **llm_output.model_dump())

    updated = repo.set_analysis(job_id, analysis)
    if updated is None:
        raise HTTPException(status_code=404, detail="job not found")
    return updated
