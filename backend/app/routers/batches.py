from uuid import uuid4

import anthropic
from fastapi import APIRouter, Depends, HTTPException

from app.aggregation import InsufficientSampleError, compute_keyword_stats
from app.batch_repository import BatchRepository, get_batch_repository
from app.llm import generate_batch_draft, get_anthropic_client
from app.repository import JobRepository, get_job_repository
from app.schemas import BatchResult

router = APIRouter(prefix="/batches", tags=["batches"])


@router.post("/analyze", response_model=BatchResult, status_code=201)
def analyze_batch(
    job_repo: JobRepository = Depends(get_job_repository),
    batch_repo: BatchRepository = Depends(get_batch_repository),
    client: anthropic.Anthropic = Depends(get_anthropic_client),
) -> BatchResult:
    try:
        stats, period, sample_size = compute_keyword_stats(job_repo.list())
    except InsufficientSampleError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        draft = generate_batch_draft(stats, sample_size, period, client)
    except anthropic.APIError as exc:
        raise HTTPException(status_code=502, detail=f"LLM 호출 실패: {exc}") from exc
    except TypeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Anthropic 인증 정보가 설정되지 않았습니다 (ANTHROPIC_API_KEY 환경변수 필요): {exc}",
        ) from exc

    batch = BatchResult(
        batch_id=str(uuid4()),
        sample_size=sample_size,
        period=period,
        stats=stats,
        generated_content_draft=draft,
    )
    return batch_repo.add(batch)


@router.get("", response_model=list[BatchResult])
def list_batches(batch_repo: BatchRepository = Depends(get_batch_repository)) -> list[BatchResult]:
    return batch_repo.list()


@router.get("/{batch_id}", response_model=BatchResult)
def get_batch(
    batch_id: str, batch_repo: BatchRepository = Depends(get_batch_repository)
) -> BatchResult:
    record = batch_repo.get(batch_id)
    if record is None:
        raise HTTPException(status_code=404, detail="batch not found")
    return record
