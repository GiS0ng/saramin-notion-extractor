const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const core = require("../core.js");
const workflow = require("../workflow.js");

describe("채용공고 핵심 분류", () => {
  it("OCR 텍스트에서 섹션과 기술스택을 분리한다", () => {
    const text = fs.readFileSync(path.join(__dirname, "fixtures/image-ocr.txt"), "utf8");
    expect(core.section(text, ["주요업무"], ["지원자격"])).toContain("추론 API");
    expect(core.section(text, ["지원자격"], ["우대사항"])).toContain("Hugging Face");
    expect(core.detectSkills(text)).toEqual(expect.arrayContaining([
      "Python", "Git", "Hugging Face", "Ollama", "vLLM", "RAG"
    ]));
  });

  it("동일 공고 URL을 rec_idx 기준으로 정규화한다", () => {
    expect(core.canonicalUrl("https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=123&utm=x"))
      .toBe("https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=123");
  });

  it("Notion 속성의 날짜와 긴 텍스트를 변환한다", () => {
    const result = core.notionProperties({
      "회사/직무(제목)": "회사 / 개발자",
      "공고링크": "https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=77",
      "주요업무": "가".repeat(2100),
      "기술스택": ["Python"],
      "마감일": "2026-09-18"
    });
    expect(result.link).toContain("rec_idx=77");
    expect(result.properties["주요업무"].rich_text).toHaveLength(2);
    expect(result.properties["마감일"].date.start).toBe("2026-09-18");
  });
});

describe("등록일 필터", () => {
  const now = new Date(2026, 8, 10, 12, 0, 0);

  it("설정한 최근 일수를 상대 등록일에 적용한다", () => {
    expect(core.registeredWithinDays("8일 전 등록", 10, now)).toBe(true);
    expect(core.registeredWithinDays("8일 전 등록", 7, now)).toBe(false);
  });

  it("절대 등록일의 경계일을 포함한다", () => {
    expect(core.registeredWithinDays("2026.09.03 등록", 7, now)).toBe(true);
    expect(core.registeredWithinDays("2026.09.02 등록", 7, now)).toBe(false);
  });

  it("검색 결과에서 최근 공고만 중복 없이 반환한다", () => {
    const html = fs.readFileSync(path.join(__dirname, "fixtures/search-results.html"), "utf8");
    const dom = new JSDOM(html, { url: "https://www.saramin.co.kr/zf_user/search/recruit" });
    const jobs = core.parseSearchJobs(dom.window.document, dom.window.location.href, 10, now);
    expect(jobs.map(job => job.recIdx)).toEqual(["101"]);
  });
});

describe("일괄수집 오류와 커서", () => {
  it("429와 서버 오류만 재시도하고 인증 오류는 중단한다", () => {
    expect(workflow.shouldRetry(workflow.httpError(429, "rate limit"))).toBe(true);
    expect(workflow.shouldRetry(workflow.httpError(503, "server"))).toBe(true);
    const auth = workflow.httpError(401, "unauthorized");
    expect(workflow.shouldRetry(auth)).toBe(false);
    expect(workflow.isFatal(auth)).toBe(true);
  });

  it("완료한 공고의 다음 위치를 재개 커서로 반환한다", () => {
    expect(workflow.nextCursor(3, 1, 4)).toEqual({ currentPage: 3, nextJobIndex: 2 });
    expect(workflow.nextCursor(3, 3, 4)).toEqual({ currentPage: 4, nextJobIndex: 0 });
  });
});

describe("주간 예약 계산", () => {
  const mondayNine = { weekday: 1, hour: 9, minute: 0 };

  it("같은 날 예약 전이면 오늘을 반환한다", () => {
    const result = core.nextWeeklyOccurrence(mondayNine, new Date(2026, 8, 7, 8, 30));
    expect(result).toEqual(new Date(2026, 8, 7, 9, 0));
  });

  it("같은 날 예약 후이면 다음 주를 반환한다", () => {
    const result = core.nextWeeklyOccurrence(mondayNine, new Date(2026, 8, 7, 10, 0));
    expect(result).toEqual(new Date(2026, 8, 14, 9, 0));
  });

  it("일요일에서 다음 월요일로 순환한다", () => {
    const result = core.nextWeeklyOccurrence(mondayNine, new Date(2026, 8, 6, 12, 0));
    expect(result).toEqual(new Date(2026, 8, 7, 9, 0));
  });
});
