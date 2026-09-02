(() => {
  if (globalThis.__saraminNotionExtractorLoaded) return;
  globalThis.__saraminNotionExtractorLoaded = true;

  const { clean, selectJobRoot, parseJobDocument, mergeOcrFields } = SaraminCore;

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

  async function extract() {
    const root = selectJobRoot(document, location.href);
    const detailPayloadResult = await detailPayload(root);
    return parseJobDocument(document, location.href, detailPayloadResult.text, detailPayloadResult.imageUrls);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_SARAMIN_JOB") {
      extract()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === "PARSE_OCR_TEXT") {
      try { sendResponse({ ok: true, data: mergeOcrFields(message.data, message.ocrText) }); }
      catch (error) { sendResponse({ ok: false, error: error.message }); }
    }
  });
})();
