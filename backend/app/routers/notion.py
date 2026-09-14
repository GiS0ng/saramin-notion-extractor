import os

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.notion import ANALYSIS_DB_PROPERTIES, create_analysis_database, get_http_client
from app.schemas import CreateAnalysisDatabaseRequest, CreateAnalysisDatabaseResponse

router = APIRouter(prefix="/notion", tags=["notion"])


@router.post(
    "/analysis-database",
    response_model=CreateAnalysisDatabaseResponse,
    status_code=201,
)
def create_analysis_db(
    payload: CreateAnalysisDatabaseRequest,
    client: httpx.Client = Depends(get_http_client),
) -> CreateAnalysisDatabaseResponse:
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="NOTION_TOKEN 환경변수가 설정되지 않았습니다")

    try:
        result = create_analysis_database(payload.parent_page_id, token, client)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Notion API 오류 {exc.response.status_code}: {exc.response.text}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Notion API 호출 실패: {exc}") from exc

    data_sources = result.get("data_sources") or []
    if not data_sources:
        raise HTTPException(status_code=502, detail="Notion 응답에 data_sources가 없습니다")

    return CreateAnalysisDatabaseResponse(
        database_id=result["id"],
        data_source_id=data_sources[0]["id"],
        url=result.get("url", ""),
        properties=list(ANALYSIS_DB_PROPERTIES.keys()),
    )
