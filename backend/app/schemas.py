from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobIn(BaseModel):
    """수집기가 보낸 원본 채용공고 JSON. 전달 방식 미정이라 특정 필드를 강제하지 않는다."""

    model_config = ConfigDict(extra="allow")


class JobRecord(BaseModel):
    id: str
    received_at: datetime
    payload: JobIn
