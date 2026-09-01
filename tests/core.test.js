const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const core = require("../core.js");
const workflow = require("../workflow.js");

describe("채용공고 핵심 분류", () => {
  it("일반 상세 fixture를 구조화한다", () => {
    const html = fs.readFileSync(path.join(__dirname, "fixtures/text-job.html"), "utf8");
    const dom = new JSDOM(html);
    const detail = dom.window.document.querySelector(".jv_detail").textContent;
    const data = core.parseJobDocument(
      dom.window.document,
      "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=100",
      detail,
      [],
      new Date("2026-09-02T00:00:00.000Z")
    );
    expect(data["회사/직무(제목)"]).toBe("테스트회사 / AI 개발자");
    expect(data["기술스택"]).toEqual(expect.arrayContaining(["Python", "Git", "Docker"]));
    expect(data["공고링크"]).toContain("rec_idx=100");
  });

  it("이어보기 fixture에서 현재 rec_idx 섹션만 고른다", () => {
    const html = fs.readFileSync(path.join(__dirname, "fixtures/relay-job.html"), "utf8");
    const dom = new JSDOM(html);
    const root = core.selectJobRoot(
      dom.window.document,
      "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=200"
    );
    const data = core.parseJobDocument(
      dom.window.document,
      "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=200",
      root.querySelector(".jv_detail").textContent
    );
    expect(data["회사/직무(제목)"]).toBe("이어보기회사 / MES 개발자");
    expect(data["회사/직무(제목)"]).not.toContain("테스트회사");
  });

  it("OCR 텍스트에서 섹션과 기술스택을 분리한다", () => {
    const text = fs.readFileSync(path.join(__dirname, "fixtures/image-ocr.txt"), "utf8");
    expect(core.section(text, ["주요업무"], ["지원자격"])).toContain("추론 API");
    expect(core.section(text, ["지원자격"], ["우대사항"])).toContain("Hugging Face");
    expect(core.detectSkills(text)).toEqual(expect.arrayContaining([
      "Python", "Git", "Hugging Face", "Ollama", "vLLM", "RAG"
    ]));
  });

  it("이미지 OCR 결과를 기존 공고 구조에 병합한다", () => {
    const text = fs.readFileSync(path.join(__dirname, "fixtures/image-ocr.txt"), "utf8");
    const result = core.mergeOcrFields({
      "지원자격": "경력무관",
      "기술스택": [],
      "자격/어학": "",
      "근무조건/복지": "",
      "추출정보": {},
      "_needsOcr": true
    }, text, new Date("2026-09-02T00:00:00.000Z"));
    expect(result["주요업무"]).toContain("RAG 서비스");
    expect(result["기술스택"]).toEqual(expect.arrayContaining(["Python", "Hugging Face", "Ollama", "vLLM", "RAG"]));
    expect(result._needsOcr).toBe(false);
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

  it("중복 공고와 전체 공고 제한을 흐름 전에 판정한다", () => {
    const processed = new Set(["100"]);
    expect(workflow.jobDecision("100", processed, 1, 10)).toBe("duplicate");
    expect(workflow.jobDecision("200", processed, 10, 10)).toBe("limit");
    expect(workflow.jobDecision("200", processed, 1, 10)).toBe("process");
  });

  it("전용 취소 오류를 일반 실패와 구분한다", () => {
    const error = new workflow.CancellationError();
    expect(error.cancelled).toBe(true);
    expect(workflow.shouldRetry(error)).toBe(false);
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

  it("설정 범위를 보정하고 비활성 상태를 유지한다", () => {
    expect(core.normalizeScheduleConfig({ scheduleEnabled: false, weekday: 9, hour: -1, minute: 80 }))
      .toEqual({ scheduleEnabled: false, weekday: 7, hour: 0, minute: 59 });
  });

  it("이번 주 예약 시각을 현지 시간으로 계산한다", () => {
    const result = core.currentWeeklyAnchor(mondayNine, new Date(2026, 8, 10, 12, 0));
    expect(result).toEqual(new Date(2026, 8, 7, 9, 0));
  });
});
