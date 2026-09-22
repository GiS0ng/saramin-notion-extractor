"""공유 에러 변환 헬퍼.

anthropic SDK는 자격증명(ANTHROPIC_API_KEY 등)을 찾지 못하면 APIError가 아니라
TypeError를 던진다. jobs.py와 batches.py 둘 다 LLM을 호출하므로, 이 TypeError를
"설정 오류"로 변환하는 로직을 한 곳에 모아 두 라우터의 중복을 없앤다.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException


@contextmanager
def translate_missing_credentials() -> Iterator[None]:
    try:
        yield
    except TypeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Anthropic 인증 정보가 설정되지 않았습니다 (ANTHROPIC_API_KEY 환경변수 필요): {exc}",
        ) from exc
