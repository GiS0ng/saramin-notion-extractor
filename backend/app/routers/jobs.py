from fastapi import APIRouter, Depends, HTTPException

from app.repository import JobRepository, get_job_repository
from app.schemas import JobIn, JobRecord

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
