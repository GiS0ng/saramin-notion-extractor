(function initializeSaraminCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SaraminCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SKILL_CATALOG = [
    "Python", "SQL", "Excel", "Java", "C", "Linux", "Docker", "Git",
    "Power BI", "MES", "ERP", "PLC", "Hugging Face", "Ollama", "vLLM", "RAG",
    "JavaScript", "TypeScript", "C++", "C#", "Go", "Rust", "Kotlin", "Swift", "Dart", "PHP", "Ruby", "Scala", "R", "MATLAB",
    "HTML", "CSS", "Sass", "React", "Next.js", "Vue.js", "Nuxt.js", "Angular", "Svelte", "jQuery", "Redux", "Zustand", "Tailwind CSS", "Bootstrap", "Vite", "Webpack",
    "Node.js", "Express", "NestJS", "Spring", "Spring Boot", "Spring Security", "JPA", "Hibernate", "MyBatis", "Django", "Flask", "FastAPI", "Laravel", ".NET", "ASP.NET", "Ruby on Rails",
    "React Native", "Flutter", "Android", "iOS", "Unity", "Unreal Engine",
    "MySQL", "PostgreSQL", "MariaDB", "Oracle", "SQL Server", "SQLite", "MongoDB", "Redis", "DynamoDB", "Elasticsearch", "OpenSearch", "Cassandra", "Neo4j",
    "AWS", "Azure", "GCP", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions", "GitLab CI", "Argo CD", "Helm", "Nginx", "Apache", "Tomcat", "Ubuntu", "Bash", "PowerShell",
    "Kafka", "RabbitMQ", "GraphQL", "REST API", "gRPC", "WebSocket", "OAuth", "JWT",
    "NumPy", "pandas", "SciPy", "scikit-learn", "PyTorch", "TensorFlow", "Keras", "OpenCV", "Transformers", "LangChain", "LlamaIndex", "MLflow", "Kubeflow", "ONNX", "TensorRT", "CUDA",
    "Spark", "Hadoop", "Airflow", "Flink", "dbt", "Snowflake", "BigQuery", "Redshift", "Databricks", "Tableau", "Looker", "Superset",
    "Prometheus", "Grafana", "Datadog", "Sentry", "Jest", "Vitest", "pytest", "JUnit", "Cypress", "Playwright", "Selenium", "Postman",
    "Figma", "Jira", "Confluence", "SAP", "AutoCAD", "SolidWorks", "LabVIEW", "ROS", "Raspberry Pi", "Arduino"
  ];

  // Canonical names keep Notion options consistent across English/Korean spellings.
  const SKILL_ALIASES = {
    Python: ["파이썬"], Java: ["자바"], JavaScript: ["JS", "자바스크립트"], TypeScript: ["TS", "타입스크립트"],
    Excel: ["엑셀", "스프레드시트", "스프레드 시트"], "Power BI": ["PowerBI"],
    "C++": ["CPP", "씨플러스플러스"], "C#": ["CSharp", "C Sharp"], C: ["C언어", "C 언어"],
    Go: ["Golang"], R: ["R언어", "R 언어"], Kotlin: ["코틀린"], Swift: ["스위프트"],
    React: ["React.js", "ReactJS", "리액트"], "Next.js": ["NextJS", "Next JS"],
    "Vue.js": ["Vue", "VueJS", "Vue JS", "뷰.js"], "Nuxt.js": ["Nuxt", "NuxtJS"],
    "Node.js": ["NodeJS", "Node JS", "노드.js"], NestJS: ["Nest.js", "Nest JS"],
    "Tailwind CSS": ["Tailwind", "TailwindCSS"], Spring: ["스프링"], "Spring Boot": ["SpringBoot", "스프링 부트", "스프링부트"],
    JPA: ["Spring Data JPA"], ".NET": ["dotnet", "닷넷"], "ASP.NET": ["ASP NET"],
    "Ruby on Rails": ["Rails"], "React Native": ["ReactNative", "리액트 네이티브"], Flutter: ["플러터"],
    "Unreal Engine": ["Unreal", "언리얼"], PostgreSQL: ["Postgres"], "SQL Server": ["MSSQL", "MS SQL"],
    AWS: ["Amazon Web Services", "아마존 웹 서비스"], Azure: ["Microsoft Azure", "애저"],
    GCP: ["Google Cloud", "Google Cloud Platform"], Kubernetes: ["K8s", "쿠버네티스"],
    Docker: ["도커"], Linux: ["리눅스"], "GitHub Actions": ["GithubActions"], "GitLab CI": ["GitLab CI/CD"],
    "Argo CD": ["ArgoCD"], "REST API": ["RESTful", "RESTful API"], "scikit-learn": ["sklearn", "scikit learn"],
    PyTorch: ["파이토치"], TensorFlow: ["텐서플로", "텐서플로우"], "Hugging Face": ["HuggingFace", "허깅 페이스", "허깅페이스"],
    RAG: ["검색 증강", "검색증강"], "Raspberry Pi": ["라즈베리파이"], PLC: ["피엘씨"]
  };

  const skillPatterns = SKILL_CATALOG.map(skill => {
    const names = [skill, ...(SKILL_ALIASES[skill] || [])];
    const alternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*"));
    // Do not confuse Java with JavaScript, SQL with MySQL, or C with C++ / C#.
    const flags = ["C", "R", "Go"].includes(skill) ? "" : "i";
    return [skill, new RegExp(`(^|[^A-Za-z0-9_+#])(?:${alternatives.join("|")})(?![A-Za-z0-9_+#])`, flags)];
  });

  function clean(value = "") {
    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function oneLine(value = "") {
    return clean(value).replace(/\s*\n\s*/g, " ");
  }

  function section(text, startWords, endWords) {
    const source = String(text || "");
    const starts = startWords
      .map(word => ({ word, index: source.indexOf(word) }))
      .filter(item => item.index >= 0)
      .sort((left, right) => left.index - right.index);
    if (!starts.length) return "";
    const start = starts[0].index + starts[0].word.length;
    const ends = endWords
      .map(word => source.indexOf(word, start))
      .filter(index => index >= 0);
    const end = ends.length ? Math.min(...ends) : source.length;
    return clean(source.slice(start, end)
      .replace(/^[\]\[(){}\s:：📌📝🏠🎁🚀🛎️]+/, "")
      .replace(/[📋🏠🎁🚀🛎️\s]+$/, ""));
  }

  function detectSkills(text) {
    const source = String(text || "").normalize("NFKC");
    return skillPatterns.filter(([, pattern]) => pattern.test(source)).map(([skill]) => skill);
  }

  function canonicalUrl(value) {
    const raw = String(value || "").trim();
    const markdown = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/);
    const candidate = markdown ? markdown[1] : raw;
    try {
      const url = new URL(candidate);
      const recIdx = url.searchParams.get("rec_idx");
      return recIdx
        ? `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${recIdx}`
        : candidate;
    } catch (_) {
      return candidate;
    }
  }

  function richText(value) {
    const text = String(value || "");
    const chunks = [];
    for (let index = 0; index < text.length && chunks.length < 100; index += 2000) {
      chunks.push({ type: "text", text: { content: text.slice(index, index + 2000) } });
    }
    return { rich_text: chunks };
  }

  function notionProperties(data) {
    const title = String(data["회사/직무(제목)"] || "제목 없는 채용공고").slice(0, 2000);
    const link = canonicalUrl(data["공고링크"]);
    const deadlineValue = String(data["마감일"] || "").slice(0, 10);
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineValue) && validDate(...deadlineValue.split("-").map(Number)) ? deadlineValue : null;
    return {
      link,
      properties: {
        "회사/직무(제목)": { title: [{ type: "text", text: { content: title } }] },
        "공고링크": { url: link || null },
        "주요업무": richText(data["주요업무"]),
        "지원자격": richText(data["지원자격"]),
        "우대사항": richText(data["우대사항"]),
        "기술스택": {
          multi_select: Array.isArray(data["기술스택"])
            ? data["기술스택"].filter(Boolean).map(name => ({ name: String(name).slice(0, 100) }))
            : []
        },
        "자격/어학": richText(data["자격/어학"]),
        "근무조건/복지": richText(data["근무조건/복지"]),
        "지역": richText(data["지역"]),
        "마감일": { date: deadline ? { start: deadline } : null }
      }
    };
  }

  function registeredWithinDays(rowText, recentDays, now = new Date()) {
    const text = oneLine(rowText);
    const relative = text.match(/(\d+)일\s*전\s*등록/);
    if (relative) return Number(relative[1]) <= Number(recentDays);
    if (/오늘\s*등록|방금\s*등록/.test(text)) return true;
    const absolute = text.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*등록/);
    if (!absolute) return true;
    const registeredAt = new Date(
      Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]), 0, 0, 0, 0
    );
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - Number(recentDays));
    cutoff.setHours(0, 0, 0, 0);
    return registeredAt >= cutoff;
  }

  function parseSearchJobs(documentRoot, baseUrl, recentDays = 7, now = new Date()) {
    const links = [...documentRoot.querySelectorAll("a[href*='rec_idx=']")];
    const jobs = [];
    const seen = new Set();
    for (const anchor of links) {
      let url;
      try {
        url = new URL(anchor.href || anchor.getAttribute("href"), baseUrl);
      } catch (_) {
        continue;
      }
      const recIdx = url.searchParams.get("rec_idx");
      if (!recIdx || seen.has(recIdx) || !/\/zf_user\/jobs\/(?:relay\/)?view/.test(url.pathname)) continue;
      const row = anchor.closest(".item_recruit, .list_item, article, li") || anchor.parentElement;
      const rowText = oneLine(row?.textContent || "");
      if (!registeredWithinDays(rowText, recentDays, now)) continue;
      seen.add(recIdx);
      jobs.push({
        recIdx,
        url: `${url.origin}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
        title: oneLine(anchor.textContent || ""),
        listingText: rowText.slice(0, 500)
      });
    }
    return jobs;
  }

  function selectJobRoot(documentRoot, pageUrl) {
    let recIdx = "";
    try { recIdx = new URL(pageUrl).searchParams.get("rec_idx") || ""; } catch (_) {}
    if (!recIdx) return documentRoot;
    return [...documentRoot.querySelectorAll("section.jview")].find(element =>
      [...element.classList].some(name => name.endsWith(`-${recIdx}`))
    ) || documentRoot;
  }

  function definitionMap(root) {
    const map = {};
    root.querySelectorAll("dl").forEach(dl => {
      const term = oneLine(dl.querySelector("dt")?.textContent || "");
      const value = oneLine(dl.querySelector("dd")?.textContent || "");
      if (term && value && !map[term]) map[term] = value.replace(/지도보기/g, "").trim();
    });
    return map;
  }

  function validDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && year <= 2199 && date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function koreaDate(now) {
    const date = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  }

  function deadlineValue(value, now = new Date()) {
    const text = oneLine(String(value || "").normalize("NFKC"));
    const open = text.match(/상시\s*(?:채용|모집)|채용\s*시\s*(?:마감|까지)|충원\s*시\s*(?:마감|까지)/);
    // A period's right-hand side is the deadline, never its registration date.
    const parts = text.split(/\s*(?:~|〜|～|–|—)\s*/);
    const target = parts.at(-1);
    const fullPattern = /(?<!\d)(\d{4}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)/g;
    const full = [...target.matchAll(fullPattern)][0];
    let components;
    if (full) {
      components = full.slice(1).map(Number);
      if (full[1].length === 2) components[0] += 2000;
    }
    else {
      const short = target.match(/(?<![\d.\-/])(\d{1,2})\s*[.\/월]\s*(\d{1,2})(?!\d)/);
      if (short) {
        const start = parts.length > 1 ? [...parts[0].matchAll(fullPattern)].at(-1) : null;
        const [currentYear, currentMonth] = koreaDate(now);
        let year = start ? Number(start[1]) + (start[1].length === 2 ? 2000 : 0) : currentYear;
        const month = Number(short[1]);
        if (start && month < Number(start[2])) year++;
        else if (!start && currentMonth === 12 && month === 1) year++;
        else if (!start && currentMonth === 1 && month === 12) year--;
        components = [year, month, Number(short[2])];
      }
    }
    if (open && /부터/.test(text) && parts.length === 1) return { date: "", status: open[0].replace(/\s+/g, ""), raw: text };
    if (components && validDate(...components)) {
      return { date: components.map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-"), status: "날짜", raw: text };
    }
    if (open) return { date: "", status: open[0].replace(/\s+/g, ""), raw: text };
    const relative = target.match(/D\s*-\s*(\d+)|오늘\s*마감|금일\s*마감|내일\s*마감|D\s*-\s*DAY/i);
    if (relative && !components) {
      const [year, month, day] = koreaDate(now);
      const offset = relative[1] ? Number(relative[1]) : /내일/.test(relative[0]) ? 1 : 0;
      const date = new Date(Date.UTC(year, month - 1, day + offset));
      return { date: date.toISOString().slice(0, 10), status: "상대일자", raw: text };
    }
    return { date: "", status: "확인필요", raw: text };
  }

  function labeledDeadline(text, now) {
    const source = String(text || "");
    const labels = /(?:접수\s*마감(?:일|일시)?|마감\s*(?:일시|일|날짜)|접수\s*기간|모집\s*기간|지원\s*기간)\s*[:：]?/g;
    for (const match of source.matchAll(labels)) {
      const fragment = source.slice(match.index + match[0].length, match.index + match[0].length + 160)
        .split(/(?:지원방법|접수방법|전형절차|채용절차|근무조건|시작일|등록일|수정일|면접일|면접\s*예정|입사일)/)[0];
      const result = deadlineValue(fragment, now);
      if (result.date || result.status !== "확인필요") return result;
    }
    return { date: "", status: "확인필요", raw: "" };
  }

  function parseDeadline(root, detailText, now, pageUrl) {
    // Walk each term: Saramin can put the start and end pairs in the same dl.
    for (const label of root.querySelectorAll("dt, th")) {
      const term = oneLine(label.textContent).replace(/[\s:：]/g, "");
      if (!/^(?:접수)?마감(?:일|일시)?$|^(?:접수|모집|지원)기간$/.test(term)) continue;
      const value = label.nextElementSibling;
      if (!value?.matches("dd, td")) continue;
      const result = deadlineValue(value.textContent, now);
      if (result.date || result.status !== "확인필요") return { ...result, source: "접수정보" };
    }
    for (const area of root.querySelectorAll(".jv_howto, .jv_cont.jv_apply, .recruit_period")) {
      const copy = area.cloneNode(true);
      copy.querySelectorAll("br").forEach(el => el.replaceWith("\n"));
      const result = labeledDeadline(copy.textContent, now);
      if (result.date || result.status !== "확인필요") return { ...result, source: "접수기간" };
    }
    for (const node of root.querySelectorAll('[itemprop="validThrough"]')) {
      const result = deadlineValue(node.getAttribute("content") || node.getAttribute("datetime") || node.textContent, now);
      if (result.date) return { ...result, source: "validThrough" };
    }
    const doc = root.ownerDocument || root;
    const recIdx = new URL(pageUrl).searchParams.get("rec_idx");
    const jobs = [];
    function collect(value) {
      if (!value || typeof value !== "object") return;
      if ([value["@type"]].flat().includes("JobPosting")) jobs.push(value);
      Object.values(value).forEach(child => {
        if (Array.isArray(child)) child.forEach(collect);
        else if (child && typeof child === "object") collect(child);
      });
    }
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { collect(JSON.parse(script.textContent)); } catch (_) { /* Malformed JSON-LD is optional. */ }
    }
    for (const job of jobs) {
      const identities = [job.url, job["@id"], job.identifier?.value].filter(Boolean).map(String);
      const matches = identities.some(value => value === recIdx || (() => {
        try { return new URL(value, pageUrl).searchParams.get("rec_idx") === recIdx; } catch (_) { return false; }
      })());
      if (!matches && !(jobs.length === 1 && !identities.length && doc.querySelectorAll("section.jview").length <= 1)) continue;
      const result = deadlineValue(job.validThrough, now);
      if (result.date) return { ...result, source: "JobPosting.validThrough" };
    }
    const result = labeledDeadline(detailText, now);
    return { ...result, source: result.raw ? "상세요강" : "미확인" };
  }

  function parseJobDocument(documentRoot, pageUrl, detailText = "", imageUrls = [], now = new Date()) {
    const root = selectJobRoot(documentRoot, pageUrl);
    const url = new URL(pageUrl);
    const recIdx = url.searchParams.get("rec_idx") || "";
    const title = oneLine(root.querySelector("h1.tit_job, .jv_header h1, h1")?.textContent || "");
    const company = oneLine(root.querySelector(".jv_header a[href*='company-info/view'], a[href*='company-info/view']")?.textContent || "");
    if (!title) throw new Error("채용공고 제목을 찾지 못했습니다.");
    const summary = definitionMap(root.querySelector(".jv_summary") || root);
    const detail = clean(detailText);
    const duties = section(detail, ["합류하시면 이런 일을 해요!", "담당업무", "주요업무"], ["이런 분을 찾고 있어요!", "지원자격", "자격요건"]);
    const requirements = section(detail, ["이런 분을 찾고 있어요!", "지원자격", "자격요건"], ["이런 경험을 가진 분이라면 더 좋아요!", "우대사항", "근무 조건", "근무조건"]);
    const preferences = section(detail, ["이런 경험을 가진 분이라면 더 좋아요!", "우대사항"], ["근무 조건", "근무조건", "제출서류 및 채용절차", "채용절차"]);
    const work = section(detail, ["근무 조건", "근무조건"], ["제출서류 및 채용절차", "채용절차"]);
    const locationText = oneLine(root.querySelector(".jv_location")?.textContent || "")
      .replace(/^근무지위치\s*/, "").replace(/지도 보기/g, "").trim();
    const qualification = [summary["경력"], summary["학력"], requirements].filter(Boolean).join(" · ");
    const deadline = parseDeadline(root, detail, now, pageUrl);
    const skillText = [...root.querySelectorAll(".jv_summary, .jv_skill, .job_skill, .skill, [data-skill]")]
      .map(node => node.innerText || [...node.querySelectorAll("dd, li, .tag, .badge")].map(item => item.textContent).join("\n") || node.textContent).join("\n");
    const data = {
      "회사/직무(제목)": [company, title].filter(Boolean).join(" / "),
      "공고링크": `${url.origin}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
      "주요업무": duties,
      "지원자격": qualification,
      "우대사항": preferences,
      "기술스택": detectSkills(`${detail}\n${title}\n${skillText}`),
      "자격/어학": /자격증|어학|TOEIC|토익|OPIc|오픽/i.test(detail) ? "상세요강 원문 확인 필요" : "별도 자격증·어학 요건 명시 없음.",
      "근무조건/복지": [summary["근무형태"], summary["급여"], work].filter(Boolean).join(" · "),
      "지역": locationText || summary["근무지역"] || "",
      "마감일": deadline.date,
      "원문": detail,
      "추출정보": { "출처": "사람인", "공고ID": recIdx, "추출시각": now.toISOString(), "마감일상태": deadline.status, "마감일원문": deadline.raw, "마감일출처": deadline.source },
      "_ocrImages": imageUrls
    };
    data._needsOcr = Boolean(imageUrls.length && (!duties || detail.length < 180));
    return data;
  }

  function mergeOcrFields(data, ocrText, now = new Date()) {
    const text = clean(ocrText);
    if (!text) throw new Error("이미지에서 읽을 수 있는 글자를 찾지 못했습니다.");
    const duties = section(text, ["주요업무", "담당업무", "담당 업무", "수행업무"], ["지원자격", "자격요건", "자격 요건", "우대사항"]);
    const requirements = section(text, ["지원자격", "자격요건", "자격 요건"], ["우대사항", "우대 조건", "근무조건", "근무 조건"]);
    const preferences = section(text, ["우대사항", "우대 조건"], ["근무조건", "근무 조건", "복리후생", "복지", "채용절차"]);
    const work = section(text, ["근무조건", "근무 조건"], ["채용절차", "접수방법", "유의사항"]);
    const credentialLines = text.split("\n").map(oneLine).filter(line => /자격증|기사|TOEIC|토익|OPIc|오픽|어학|인증/i.test(line));
    const ocrDeadline = labeledDeadline(text, now);
    const useOcrDeadline = !data["마감일"] && (!data["추출정보"]?.["마감일상태"] || data["추출정보"]["마감일상태"] === "확인필요") &&
      (ocrDeadline.date || ocrDeadline.status !== "확인필요");
    return {
      ...data,
      "주요업무": duties || data["주요업무"],
      "지원자격": requirements ? [data["지원자격"], requirements].filter(Boolean).join(" · ") : data["지원자격"],
      "우대사항": preferences || data["우대사항"],
      "기술스택": [...new Set([...(data["기술스택"] || []), ...detectSkills(text)])],
      "자격/어학": credentialLines.length ? credentialLines.join(" · ") : data["자격/어학"],
      "근무조건/복지": work ? [data["근무조건/복지"], work].filter(Boolean).join(" · ") : data["근무조건/복지"],
      "원문": text,
      "마감일": useOcrDeadline ? ocrDeadline.date : data["마감일"] || "",
      "추출정보": { ...data["추출정보"], "OCR": "Tesseract.js kor+eng", "OCR시각": now.toISOString(),
        ...(useOcrDeadline ? { "마감일상태": ocrDeadline.status, "마감일원문": ocrDeadline.raw, "마감일출처": "OCR" } : {}) },
      "_needsOcr": false
    };
  }

  function normalizeScheduleConfig(value = {}) {
    const number = (candidate, fallback) => Number.isFinite(Number(candidate))
      ? Number(candidate)
      : fallback;
    const config = {
      scheduleEnabled: value.scheduleEnabled !== false,
      weekday: Math.trunc(number(value.weekday, 1)),
      hour: Math.trunc(number(value.hour, 9)),
      minute: Math.trunc(number(value.minute, 0))
    };
    config.weekday = Math.max(1, Math.min(7, config.weekday));
    config.hour = Math.max(0, Math.min(23, config.hour));
    config.minute = Math.max(0, Math.min(59, config.minute));
    return config;
  }

  function nextWeeklyOccurrence(value, now = new Date()) {
    const config = normalizeScheduleConfig(value);
    const next = new Date(now);
    const currentIsoWeekday = next.getDay() === 0 ? 7 : next.getDay();
    let daysUntil = (config.weekday - currentIsoWeekday + 7) % 7;
    next.setDate(next.getDate() + daysUntil);
    next.setHours(config.hour, config.minute, 0, 0);
    if (next <= now) {
      daysUntil = daysUntil === 0 ? 7 : daysUntil;
      if (daysUntil !== 0 && next <= now) next.setDate(next.getDate() + 7);
    }
    return next;
  }

  function currentWeeklyAnchor(value, now = new Date()) {
    const config = normalizeScheduleConfig(value);
    const anchor = new Date(now);
    const currentIsoWeekday = anchor.getDay() === 0 ? 7 : anchor.getDay();
    const daysSince = (currentIsoWeekday - config.weekday + 7) % 7;
    anchor.setDate(anchor.getDate() - daysSince);
    anchor.setHours(config.hour, config.minute, 0, 0);
    if (anchor > now) anchor.setDate(anchor.getDate() - 7);
    return anchor;
  }

  return {
    clean,
    oneLine,
    section,
    detectSkills,
    canonicalUrl,
    richText,
    notionProperties,
    registeredWithinDays,
    parseSearchJobs,
    selectJobRoot,
    parseJobDocument,
    mergeOcrFields,
    normalizeScheduleConfig,
    nextWeeklyOccurrence,
    currentWeeklyAnchor
  };
});
