"""LLM 구조화 출력 호출.

claudeRead.md §4.1 원칙에 따라 LLM 호출은 이 백엔드에서만 일어난다(Chrome 확장에는 절대 넣지 않음).
claudeRead.md §5.1 스키마를 한 번의 호출로 동시에 채운다(SEO/AEO/GEO를 3번 나눠 부르지 않음).
"""

import json

import anthropic

from app.schemas import GeneratedContentDraft, JobIn, KeywordStat, LlmAnalysisOutput

_MODEL = "claude-opus-5"

_ANALYSIS_PROMPT_TEMPLATE = """\
다음은 채용공고 원본 데이터(JSON)다. 이 데이터를 분석해서 SEO/AEO/GEO 콘텐츠 제작에 쓸 구조화된 태그를 생성하라.

- keywords: 이 공고에서 핵심이 되는 키워드 목록
- search_intent: 구직자가 이 공고를 찾을 때의 검색 의도 요약 (한 문장)
- seo.title / seo.description: 이 공고를 소재로 한 콘텐츠의 SEO 제목과 메타 설명
- seo.headings: 제안하는 H2/H3 제목 구조
- aeo.questions_and_answers: 구직자가 이 공고에 대해 가질 법한 예상 질문과 간결한 답변 목록
- geo.entities: 핵심 개체명(회사명, 기술스택, 직무명 등)
- geo.claim_evidence_pairs: 원문에서 뽑아낸 주장(claim)과 그 근거 문장(evidence), 출처(source, 이 경우 원본 필드명)
- geo.summary: AI 검색(ChatGPT/Perplexity 등)이 인용하기 쉬운 형태의 간결한 요약문

원본 데이터:
{payload_json}
"""

_BATCH_DRAFT_PROMPT_TEMPLATE = """\
다음은 최근 채용공고 {sample_size}건(집계 기간: {period})을 분석해서 뽑은 키워드 등장 빈도 통계다.
빈도(%)는 "이 키워드가 등장한 공고 수 / 전체 분석 공고 수"이다.

{stats_text}

이 통계를 소재로 한 데이터저널리즘형 콘텐츠 초안을 작성하라:
- seo_title: 이 통계를 소재로 한 콘텐츠의 SEO 제목
- aeo_qna: 이 통계에 대해 구직자/채용담당자가 가질 법한 예상 질문과 답변 목록
- geo_summary: AI 검색(ChatGPT/Perplexity 등)이 인용하기 쉬운 형태의 간결한 요약문 (구체적인 숫자를 포함)
"""


def get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()


def analyze_job(payload: JobIn, client: anthropic.Anthropic) -> LlmAnalysisOutput:
    payload_json = json.dumps(payload.model_dump(), ensure_ascii=False, indent=2)
    prompt = _ANALYSIS_PROMPT_TEMPLATE.format(payload_json=payload_json)

    response = client.messages.parse(
        model=_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
        output_format=LlmAnalysisOutput,
    )
    return response.parsed_output


def generate_batch_draft(
    stats: list[KeywordStat],
    sample_size: int,
    period: str,
    client: anthropic.Anthropic,
) -> GeneratedContentDraft:
    stats_text = "\n".join(f"- {s.keyword}: {s.frequency_pct}%" for s in stats)
    prompt = _BATCH_DRAFT_PROMPT_TEMPLATE.format(
        sample_size=sample_size, period=period, stats_text=stats_text
    )

    response = client.messages.parse(
        model=_MODEL,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
        output_format=GeneratedContentDraft,
    )
    return response.parsed_output
