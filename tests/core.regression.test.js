const { JSDOM } = require("jsdom");
const core = require("../core.js");

const PAGE_URL = "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=4242";
const NOW = new Date("2025-09-21T00:00:00.000Z");

function parse(html, detailText = "") {
  const dom = new JSDOM(html);
  return core.parseJobDocument(dom.window.document, PAGE_URL, detailText, [], NOW);
}

describe("마감일 회귀", () => {
  it("모집기간보다 구체적인 마감일 라벨을 우선한다", () => {
    const result = parse(`
      <section class="jview jview-4242">
        <h1>개발자</h1>
        <dl><dt>모집기간</dt><dd>상시모집</dd></dl>
        <dl><dt>마감일</dt><dd>2025.10.31</dd></dl>
      </section>
    `);

    expect(result["마감일"]).toBe("2025-10-31");
    expect(result["추출정보"]["마감일상태"]).toBe("날짜");
  });

  it("연도 없는 하이픈 날짜를 파싱한다", () => {
    const result = parse(`
      <section class="jview jview-4242">
        <h1>개발자</h1>
        <dl><dt>마감일</dt><dd>10-15</dd></dl>
      </section>
    `);

    expect(result["마감일"]).toBe("2025-10-15");
  });

  it("여러 JSON-LD 스크립트 중 식별자 없는 위젯 공고를 현재 공고로 오귀속하지 않는다", () => {
    const result = parse(`
      <section class="jview jview-4242"><h1>현재 공고</h1></section>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"WebSite","name":"사람인"}
      </script>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"JobPosting","validThrough":"2025-12-31"}
      </script>
    `);

    expect(result["마감일"]).toBe("");
    expect(result["추출정보"]["마감일출처"]).toBe("미확인");
  });

  it("dt와 dd 사이에 중간 요소가 있어도 유일한 dd 값을 찾는다", () => {
    const result = parse(`
      <section class="jview jview-4242">
        <h1>개발자</h1>
        <dl><dt>마감일</dt><span aria-hidden="true">달력</span><dd>2025.11.07</dd></dl>
      </section>
    `);

    expect(result["마감일"]).toBe("2025-11-07");
    expect(result["추출정보"]["마감일출처"]).toBe("접수정보");
  });
});

describe("기술 스택 별칭 회귀", () => {
  it("구분자 없는 ExcelVBA를 Excel로 감지한다", () => {
    expect(core.detectSkills("ExcelVBA 자동화 경험")).toContain("Excel");
  });

  it("BI 툴을 Power BI로 감지한다", () => {
    expect(core.detectSkills("BI 툴 대시보드 구축")).toContain("Power BI");
  });
});
