import os
from collections.abc import Callable

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.notion import ANALYSIS_DB_PROPERTIES, create_analysis_database, get_http_client
from app.notion_reports import REGION_SKILL_REPORT_PROPERTIES, create_region_report_database
from app.schemas import (
    CreateAnalysisDatabaseRequest,
    CreateAnalysisDatabaseResponse,
    CreateRegionReportDatabaseResponse,
)

router = APIRouter(prefix="/notion", tags=["notion"])


def _create_database(
    creator: Callable[[str, str, httpx.Client], dict],
    parent_page_id: str,
    client: httpx.Client,
) -> dict:
    """DB 생성 1회성 호출들의 공통 에러 변환. create_analysis_db/create_region_report_db가 공유한다."""
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise HTTPException(status_code=500, detail="NOTION_TOKEN 환경변수가 설정되지 않았습니다")

    try:
        result = creator(parent_page_id, token, client)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Notion API 오류 {exc.response.status_code}: {exc.response.text}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Notion API 호출 실패: {exc}") from exc

    if not (result.get("data_sources") or []):
        raise HTTPException(status_code=502, detail="Notion 응답에 data_sources가 없습니다")
    return result


@router.post(
    "/analysis-database",
    response_model=CreateAnalysisDatabaseResponse,
    status_code=201,
)
def create_analysis_db(
    payload: CreateAnalysisDatabaseRequest,
    client: httpx.Client = Depends(get_http_client),
) -> CreateAnalysisDatabaseResponse:
    result = _create_database(create_analysis_database, payload.parent_page_id, client)
    return CreateAnalysisDatabaseResponse(
        database_id=result["id"],
        data_source_id=result["data_sources"][0]["id"],
        url=result.get("url", ""),
        properties=list(ANALYSIS_DB_PROPERTIES.keys()),
    )


@router.post(
    "/region-report-database",
    response_model=CreateRegionReportDatabaseResponse,
    status_code=201,
)
def create_region_report_db(
    payload: CreateAnalysisDatabaseRequest,
    client: httpx.Client = Depends(get_http_client),
) -> CreateRegionReportDatabaseResponse:
    result = _create_database(create_region_report_database, payload.parent_page_id, client)
    return CreateRegionReportDatabaseResponse(
        database_id=result["id"],
        data_source_id=result["data_sources"][0]["id"],
        url=result.get("url", ""),
        properties=list(REGION_SKILL_REPORT_PROPERTIES.keys()),
    )
