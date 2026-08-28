(() => {
  if (globalThis.__saraminNotionExtractorLoaded) return;
  globalThis.__saraminNotionExtractorLoaded = true;

  const clean = (value = "") => value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const oneLine = (value = "") => clean(value).replace(/\s*\n\s*/g, " ");

  function definitionMap(root = document) {
    const map = {};
    root.querySelectorAll("dl").forEach((dl) => {
      const term = oneLine(dl.querySelector("dt")?.innerText || "");
      const value = oneLine(dl.querySelector("dd")?.innerText || "");
      if (term && value && !map[term]) map[term] = value.replace(/지도보기/g, "").trim();
    });
    return map;
  }

  function imageUrlsFrom(root, baseUrl = location.href) {
    const urls = [...root.querySelectorAll("img")]
      .map((img) => img.currentSrc || img.getAttribute("data-src") || img.getAttribute("data-original") || img.src)
      .filter(Boolean)
      .map((src) => { try { return new URL(src, baseUrl).href; } catch (_) { return ""; } })
      .filter((src) => src.startsWith("https://"));
    return [...new Set(urls)].filter((src) => !/logo|button|icon|favicon|loading|blank/i.test(src)).slice(0, 12);
  }

  async function detailPayload(root) {
    const area = root.querySelector(".jv_detail") ||
      [...root.querySelectorAll("section, div")].find((el) => el.querySelector(":scope > h2")?.innerText.trim() === "상세요강");
    if (!area) return { text: "", imageUrls: [] };
    let imageUrls = imageUrlsFrom(area);
    const frame = area.querySelector("iframe[id^='iframe_content_'], iframe[src*='view-detail']");
    if (frame?.src) {
      try {
        const response = await fetch(frame.src, { credentials: "include" });
        if (response.ok) {
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          imageUrls = [...new Set([...imageUrls, ...imageUrlsFrom(doc, frame.src)])];
          doc.querySelectorAll("script, style, iframe, video, button").forEach((el) => el.remove());
          const frameText = clean(doc.body?.innerText || doc.body?.textContent || "");
          if (frameText) return { text: frameText, imageUrls };
        }
      } catch (_) {
        // 일반 상세 페이지 방식으로 계속 시도합니다.
      }
    }
    const clone = area.cloneNode(true);
    clone.querySelectorAll("script, style, iframe, video, button").forEach((el) => el.remove());
    return { text: clean(clone.innerText.replace(/^상세요강\s*/, "")), imageUrls };
  }

  function section(text, startWords, endWords) {
    const starts = startWords.map((word) => ({ word, index: text.indexOf(word) })).filter((x) => x.index >= 0).sort((a, b) => a.index - b.index);
    if (!starts.length) return "";
    const start = starts[0].index + starts[0].word.length;
    const ends = endWords.map((word) => text.indexOf(word, start)).filter((index) => index >= 0);
    const end = ends.length ? Math.min(...ends) : text.length;
    return clean(text.slice(start, end)
      .replace(/^[\]\[(){}\s:：📌📝🏠🎁🚀🛎️]+/, "")
      .replace(/[📋🏠🎁🚀🛎️\s]+$/, ""));
  }

  function detectSkills(text) {
    const catalog = ["Python", "SQL", "Excel", "Java", "C", "Linux", "Docker", "Git", "Power BI", "MES", "ERP", "PLC"];
    const aliases = { "Excel": /Excel|엑셀|스프레드\s*시트/i, "Power BI": /Power\s*BI|BI\s*툴/i, "C": /(^|[^A-Za-z])C([^A-Za-z]|$)/ };
    return catalog.filter((skill) => (aliases[skill] || new RegExp(`(^|[^A-Za-z])${skill.replace(" ", "\\s*")}([^A-Za-z]|$)`, "i")).test(text));
  }

  function deadline(root) {
    const howto = root.querySelector(".jv_howto") || root;
    const dls = [...howto.querySelectorAll("dl")];
    for (const dl of dls) {
      const dt = oneLine(dl.querySelector("dt")?.innerText || "");
      if (dt === "마감일") return oneLine(dl.querySelector("dd")?.innerText || "").match(/\d{4}\.\d{2}\.\d{2}/)?.[0]?.replaceAll(".", "-") || "";
    }
    return "";
  }

  async function extract() {
    const recIdx = new URL(location.href).searchParams.get("rec_idx");
    const relayRoot = recIdx
      ? [...document.querySelectorAll("section.jview")].find((el) => [...el.classList].some((name) => name.endsWith(`-${recIdx}`)))
      : null;
    const root = relayRoot || document;
    const title = oneLine(root.querySelector("h1.tit_job, .jv_header h1, h1")?.innerText || "");
    const company = oneLine(root.querySelector(".jv_header a[href*='company-info/view'], a[href*='company-info/view']")?.innerText || "");
    if (!title) throw new Error("채용공고 제목을 찾지 못했습니다.");
    const summary = definitionMap(root.querySelector(".jv_summary") || root);
    const detailPayloadResult = await detailPayload(root);
    const detail = detailPayloadResult.text;
    const duties = section(detail, ["합류하시면 이런 일을 해요!", "담당업무", "주요업무"], ["이런 분을 찾고 있어요!", "지원자격", "자격요건"]);
    const requirements = section(detail, ["이런 분을 찾고 있어요!", "지원자격", "자격요건"], ["이런 경험을 가진 분이라면 더 좋아요!", "우대사항", "근무 조건", "근무조건"]);
    const preferences = section(detail, ["이런 경험을 가진 분이라면 더 좋아요!", "우대사항"], ["근무 조건", "근무조건", "제출서류 및 채용절차", "채용절차"]);
    const work = section(detail, ["근무 조건", "근무조건"], ["제출서류 및 채용절차", "채용절차"]);
    const locationText = oneLine(root.querySelector(".jv_location")?.innerText || "").replace(/^근무지위치\s*/, "").replace(/지도 보기/g, "").trim();
    const qualification = [summary["경력"], summary["학력"], requirements].filter(Boolean).join(" · ");

    const data = {
      "회사/직무(제목)": [company, title].filter(Boolean).join(" / "),
      "공고링크": `${location.origin}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
      "주요업무": duties,
      "지원자격": qualification,
      "우대사항": preferences,
      "기술스택": detectSkills(`${detail}\n${title}`),
      "자격/어학": /자격증|어학|TOEIC|토익|OPIc|오픽/i.test(detail) ? "상세요강 원문 확인 필요" : "별도 자격증·어학 요건 명시 없음.",
      "근무조건/복지": [summary["근무형태"], summary["급여"], work].filter(Boolean).join(" · "),
      "지역": locationText || summary["근무지역"] || "",
      "마감일": deadline(root),
      "원문": detail,
      "추출정보": { "출처": "사람인", "공고ID": recIdx, "추출시각": new Date().toISOString() },
      "_ocrImages": detailPayloadResult.imageUrls
    };
    data._needsOcr = Boolean(data._ocrImages.length && (!duties || detail.length < 180));
    return data;
  }

  function mergeOcr(data, ocrText) {
    const text = clean(ocrText);
    if (!text) throw new Error("이미지에서 읽을 수 있는 글자를 찾지 못했습니다.");
    const duties = section(text, ["주요업무", "담당업무", "담당 업무", "수행업무"], ["지원자격", "자격요건", "자격 요건", "우대사항"]);
    const requirements = section(text, ["지원자격", "자격요건", "자격 요건"], ["우대사항", "우대 조건", "근무조건", "근무 조건"]);
    const preferences = section(text, ["우대사항", "우대 조건"], ["근무조건", "근무 조건", "복리후생", "복지", "채용절차"]);
    const work = section(text, ["근무조건", "근무 조건"], ["채용절차", "접수방법", "유의사항"]);
    const credentialLines = text.split("\n").map(oneLine).filter((line) => /자격증|기사|TOEIC|토익|OPIc|오픽|어학|인증/i.test(line));
    return {
      ...data,
      "주요업무": duties || data["주요업무"],
      "지원자격": requirements ? [data["지원자격"], requirements].filter(Boolean).join(" · ") : data["지원자격"],
      "우대사항": preferences || data["우대사항"],
      "기술스택": [...new Set([...(data["기술스택"] || []), ...detectSkills(text)])],
      "자격/어학": credentialLines.length ? credentialLines.join(" · ") : data["자격/어학"],
      "근무조건/복지": work ? [data["근무조건/복지"], work].filter(Boolean).join(" · ") : data["근무조건/복지"],
      "원문": text,
      "추출정보": { ...data["추출정보"], "OCR": "Tesseract.js kor+eng", "OCR시각": new Date().toISOString() },
      "_needsOcr": false
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_SARAMIN_JOB") {
      extract()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "PARSE_OCR_TEXT") {
      try { sendResponse({ ok: true, data: mergeOcr(message.data, message.ocrText) }); }
      catch (error) { sendResponse({ ok: false, error: error.message }); }
    }
  });
})();
