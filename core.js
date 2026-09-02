(function initializeSaraminCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SaraminCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SKILL_CATALOG = [
    "Python", "SQL", "Excel", "Java", "C", "Linux", "Docker", "Git",
    "Power BI", "MES", "ERP", "PLC", "Hugging Face", "Ollama", "vLLM", "RAG"
  ];

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
    const aliases = {
      Excel: /Excel|엑셀|스프레드\s*시트/i,
      "Power BI": /Power\s*BI|BI\s*툴/i,
      C: /(^|[^A-Za-z])C([^A-Za-z]|$)/,
      "Hugging Face": /Hugging\s*Face|허깅\s*페이스/i,
      vLLM: /(^|[^A-Za-z])vLLM([^A-Za-z]|$)/i,
      RAG: /(^|[^A-Za-z])RAG([^A-Za-z]|$)|검색\s*증강/i
    };
    return SKILL_CATALOG.filter(skill => {
      const pattern = aliases[skill] || new RegExp(
        `(^|[^A-Za-z])${skill.replace(" ", "\\s*")}([^A-Za-z]|$)`, "i"
      );
      return pattern.test(String(text || ""));
    });
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
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineValue) ? deadlineValue : null;
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

  function parseDeadline(root) {
    for (const dl of root.querySelectorAll(".jv_howto dl, dl")) {
      if (oneLine(dl.querySelector("dt")?.textContent || "") !== "마감일") continue;
      return oneLine(dl.querySelector("dd")?.textContent || "")
        .match(/\d{4}\.\d{2}\.\d{2}/)?.[0]?.replaceAll(".", "-") || "";
    }
    return "";
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
    const data = {
      "회사/직무(제목)": [company, title].filter(Boolean).join(" / "),
      "공고링크": `${url.origin}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
      "주요업무": duties,
      "지원자격": qualification,
      "우대사항": preferences,
      "기술스택": detectSkills(`${detail}\n${title}`),
      "자격/어학": /자격증|어학|TOEIC|토익|OPIc|오픽/i.test(detail) ? "상세요강 원문 확인 필요" : "별도 자격증·어학 요건 명시 없음.",
      "근무조건/복지": [summary["근무형태"], summary["급여"], work].filter(Boolean).join(" · "),
      "지역": locationText || summary["근무지역"] || "",
      "마감일": parseDeadline(root),
      "원문": detail,
      "추출정보": { "출처": "사람인", "공고ID": recIdx, "추출시각": now.toISOString() },
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
    return {
      ...data,
      "주요업무": duties || data["주요업무"],
      "지원자격": requirements ? [data["지원자격"], requirements].filter(Boolean).join(" · ") : data["지원자격"],
      "우대사항": preferences || data["우대사항"],
      "기술스택": [...new Set([...(data["기술스택"] || []), ...detectSkills(text)])],
      "자격/어학": credentialLines.length ? credentialLines.join(" · ") : data["자격/어학"],
      "근무조건/복지": work ? [data["근무조건/복지"], work].filter(Boolean).join(" · ") : data["근무조건/복지"],
      "원문": text,
      "추출정보": { ...data["추출정보"], "OCR": "Tesseract.js kor+eng", "OCR시각": now.toISOString() },
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
