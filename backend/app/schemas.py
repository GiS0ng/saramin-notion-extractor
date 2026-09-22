from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobIn(BaseModel):
    """수집기가 보낸 원본 채용공고 JSON. 전달 방식 미정이라 특정 필드를 강제하지 않는다."""

    model_config = ConfigDict(extra="allow")


class SeoOutput(BaseModel):
    title: str
    description: str
    headings: list[str]


class QnA(BaseModel):
    q: str
    a: str


class AeoOutput(BaseModel):
    questions_and_answers: list[QnA]


class ClaimEvidence(BaseModel):
    claim: str
    evidence: str
    source: str


class GeoOutput(BaseModel):
    entities: list[str]
    claim_evidence_pairs: list[ClaimEvidence]
    summary: str


class LlmAnalysisOutput(BaseModel):
    """LLM이 직접 생성하는 부분. source_id/source_url은 서버가 이미 알고 있으므로
    LLM에게 다시 생성시키지 않고(오탈자/환각 위험), 호출부에서 AnalysisResult에 채워 넣는다."""

    keywords: list[str]
    search_intent: str
    seo: SeoOutput
    aeo: AeoOutput
    geo: GeoOutput


class AnalysisResult(LlmAnalysisOutput):
    """claudeRead.md §5.1 개별 문서 분석 출력 스키마."""

    source_id: str
    source_url: str


class JobRecord(BaseModel):
    id: str
    received_at: datetime
    payload: JobIn
    analysis: AnalysisResult | None = None


class KeywordStat(BaseModel):
    keyword: str
    frequency_pct: float


class GeneratedContentDraft(BaseModel):
    """LLM이 집계 통계를 바탕으로 생성하는 콘텐츠 초안."""

    seo_title: str
    aeo_qna: list[QnA]
    geo_summary: str


class BatchResult(BaseModel):
    """claudeRead.md §5.2 집계 콘텐츠 출력 스키마."""

    batch_id: str
    sample_size: int
    period: str
    stats: list[KeywordStat]
    generated_content_draft: GeneratedContentDraft


class CreateAnalysisDatabaseRequest(BaseModel):
    """claudeRead.md §5.3 Notion 분석 DB를 생성할 부모 페이지."""

    parent_page_id: str


class CreateAnalysisDatabaseResponse(BaseModel):
    database_id: str
    data_source_id: str
    url: str
    properties: list[str]


class RegionSkillStat(BaseModel):
    """지역 하나 · 기술스택 하나에 대한 주간 등장 빈도(%)."""

    region: str
    skill: str
    frequency_pct: float
    job_count: int


class RegionSkillReport(BaseModel):
    period: str
    stats: list[RegionSkillStat]
    sample_size: int


class CreateRegionReportDatabaseResponse(BaseModel):
    database_id: str
    data_source_id: str
    url: str
    properties: list[str]


class GithubSkillProfile(BaseModel):
    """GitHub 공개 저장소 언어/토픽을 core.js 스킬 어휘로 정규화해 합산한 가중치."""

    username: str
    skill_weights: dict[str, int]


class RecommendedCompany(BaseModel):
    rank: int
    title: str
    url: str
    match_pct: float
    matched_skills: list[str]
    missing_skills: list[str]


class GithubMatchReport(BaseModel):
    username: str
    period: str
    recommendations: list[RecommendedCompany]


class CreateGithubMatchDatabaseResponse(BaseModel):
    database_id: str
    data_source_id: str
    url: str
    properties: list[str]
