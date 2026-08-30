const NOTION_VERSION = "2026-03-11";
const AUTO_COLLECTION_ALARM = "weekly-saramin-auto-collection";
const WEEK_IN_MINUTES = 7 * 24 * 60;
const SEARCH_URLS_KEY = "saraminSearchUrls";
const AUTO_STATE_KEY = "autoCollectionState";
const AUTO_HISTORY_KEY = "autoCollectionHistory";
const AUTO_CONFIG_KEY = "autoCollectionConfig";
const AUTO_DEFAULTS = { recentDays: 7, maxPagesPerSearch: 10, maxJobs: 100, minDelayMs: 2000, maxDelayMs: 4000, maxRetries: 3 };
let autoCollectionPromise = null;

function nextMondayAtNine(now = new Date()) {
  const next = new Date(now);
  const daysUntilMonday = (8 - next.getDay()) % 7;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  return next;
}

async function ensureWeeklyAlarm() {
  const alarm = await chrome.alarms.get(AUTO_COLLECTION_ALARM);
  if (alarm?.periodInMinutes === WEEK_IN_MINUTES) return alarm;
  if (alarm) await chrome.alarms.clear(AUTO_COLLECTION_ALARM);
  chrome.alarms.create(AUTO_COLLECTION_ALARM, {
    when: nextMondayAtNine().getTime(),
    periodInMinutes: WEEK_IN_MINUTES
  });
  return chrome.alarms.get(AUTO_COLLECTION_ALARM);
}

async function setAutoState(changes) {
  const saved = await chrome.storage.local.get(AUTO_STATE_KEY);
  const state = { ...(saved[AUTO_STATE_KEY] || {}), ...changes };
  await chrome.storage.local.set({ [AUTO_STATE_KEY]: state });
  return state;
}

async function recordAutoRun(state) {
  const saved = await chrome.storage.local.get(AUTO_HISTORY_KEY);
  const history = Array.isArray(saved[AUTO_HISTORY_KEY]) ? saved[AUTO_HISTORY_KEY] : [];
  const entry = { startedAt: state.startedAt, finishedAt: state.finishedAt, status: state.status, trigger: state.trigger, totalSearchUrls: state.totalSearchUrls || 0, pages: state.pages || 0, found: state.found || 0, created: state.created || 0, updated: state.updated || 0, skipped: state.skipped || 0, failed: state.failed || 0, errors: (state.errors || []).slice(-20), error: state.error || null };
  await chrome.storage.local.set({ [AUTO_HISTORY_KEY]: [entry, ...history].slice(0, 20) });
}

async function getAutoConfig() {
  const saved = await chrome.storage.local.get(AUTO_CONFIG_KEY);
  const value = saved[AUTO_CONFIG_KEY] || {};
  const config = Object.fromEntries(Object.entries(AUTO_DEFAULTS).map(([key, fallback]) => [key, Number.isFinite(Number(value[key])) ? Number(value[key]) : fallback]));
  config.recentDays = Math.max(1, Math.min(30, config.recentDays));
  config.maxPagesPerSearch = Math.max(1, Math.min(50, config.maxPagesPerSearch));
  config.maxJobs = Math.max(1, Math.min(500, config.maxJobs));
  config.maxRetries = Math.max(1, Math.min(5, config.maxRetries));
  config.minDelayMs = Math.max(1000, Math.min(60000, config.minDelayMs));
  config.maxDelayMs = Math.max(config.minDelayMs, Math.min(60000, config.maxDelayMs));
  return config;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const requestDelay = config => delay(config.minDelayMs + Math.floor(Math.random() * Math.max(1, config.maxDelayMs - config.minDelayMs + 1)));

async function waitForTab(tabId, timeoutMs = 30000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("페이지 로딩 시간이 초과되었습니다."));
    }, timeoutMs);
    function listener(updatedId, changeInfo) {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function withBackgroundTab(url, task) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id);
    await delay(1500);
    return await task(tab.id);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function scanSearchPage(recentDays = 7) {
  const links = [...document.querySelectorAll("a[href*='rec_idx=']")];
  const jobs = [];
  const seen = new Set();
  for (const anchor of links) {
    let url;
    try { url = new URL(anchor.href, location.href); } catch (_) { continue; }
    const recIdx = url.searchParams.get("rec_idx");
    if (!recIdx || seen.has(recIdx) || !/\/zf_user\/jobs\/(?:relay\/)?view/.test(url.pathname)) continue;
    const row = anchor.closest(".item_recruit, .list_item, article, li") || anchor.parentElement;
    const rowText = (row?.innerText || "").replace(/\s+/g, " ").trim();
    const daysAgo = rowText.match(/(\d+)일\s*전\s*등록/)?.[1];
    if (daysAgo && Number(daysAgo) > 7) continue;
    const registeredDate = rowText.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*등록/);
    if (registeredDate) {
      const registeredAt = new Date(`${registeredDate[1]}-${registeredDate[2]}-${registeredDate[3]}T00:00:00`);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - recentDays);
      cutoff.setHours(0, 0, 0, 0);
      if (registeredAt < cutoff) continue;
    }
    seen.add(recIdx);
    jobs.push({
      recIdx,
      url: `${location.origin}/zf_user/jobs/relay/view?rec_idx=${recIdx}`,
      title: (anchor.innerText || "").replace(/\s+/g, " ").trim(),
      listingText: rowText.slice(0, 500)
    });
  }

  return { jobs };
}

async function collectSearchPage(tabId, config) {
  let page = { jobs: [] };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: scanSearchPage, args: [config.recentDays] });
    page = result?.result || page;
    if (page.jobs.length) break;
    await delay(1000);
  }
  return page;
}

function clickNextSearchPage(nextPageNumber) {
  const pagination = document.querySelector(".PageBox, .pagination, [class*='pagination']");
  if (!pagination) return false;
  const controls = [...pagination.querySelectorAll("button, a")];
  const numbered = controls.find(control => Number((control.innerText || control.textContent || "").trim()) === nextPageNumber);
  const next = numbered || controls.find(control => {
    const label = `${control.getAttribute("aria-label") || ""} ${control.title || ""} ${control.innerText || ""}`.trim();
    return /다음|next/i.test(label) && !control.disabled;
  });
  if (!next) return false;
  next.click();
  return true;
}

async function advanceSearchPage(tabId, nextPageNumber) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickNextSearchPage,
    args: [nextPageNumber]
  });
  if (!result?.result) return false;
  await delay(2000);
  return true;
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "이미지형 채용공고를 로컬 Tesseract OCR로 처리합니다."
  });
}

async function applyOcrIfNeeded(tabId, data) {
  if (!data?._needsOcr || !data?._ocrImages?.length) return data;
  await ensureOffscreenDocument();
  const ocr = await chrome.runtime.sendMessage({ type: "OFFSCREEN_OCR", imageUrls: data._ocrImages });
  if (!ocr?.ok) throw new Error(ocr?.error || "OCR 처리에 실패했습니다.");
  const parsed = await chrome.tabs.sendMessage(tabId, { type: "PARSE_OCR_TEXT", data, ocrText: ocr.text }, { frameId: 0 });
  if (!parsed?.ok) throw new Error(parsed?.error || "OCR 결과를 분류하지 못했습니다.");
  return parsed.data;
}

async function extractAndSaveJob(job) {
  return withBackgroundTab(job.url, async tabId => {
    let extracted = await chrome.tabs.sendMessage(tabId, { type: "SCAN_SARAMIN_JOB" }, { frameId: 0 });
    if (!extracted?.ok) throw new Error(extracted?.error || "상세 공고를 추출하지 못했습니다.");
    extracted = await applyOcrIfNeeded(tabId, extracted.data);
    return saveJob(extracted);
  });
}

async function retryJob(job, config) {
  let lastError;
  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    try { return await extractAndSaveJob(job); }
    catch (error) {
      lastError = error;
      if (attempt < config.maxRetries) await requestDelay(config);
    }
  }
  throw new Error(`${lastError?.message || "처리 실패"} (${config.maxRetries}회 시도)`);
}

async function processSearchUrl(item, context, config, resume = {}) {
  return withBackgroundTab(item.url, async searchTabId => {
    for (let page = 1; page <= config.maxPagesPerSearch; page += 1) {
      const result = await collectSearchPage(searchTabId, config);
      context.stats.pages += 1;
      for (let jobIndex = 0; jobIndex < result.jobs.length; jobIndex += 1) {
        const job = result.jobs[jobIndex];
        if (page < (resume.page || 1) || (page === (resume.page || 1) && jobIndex < (resume.jobIndex || 0))) continue;
        if (context.stats.found >= config.maxJobs) return;
        await setAutoState({ currentPage: page, currentJobIndex: jobIndex, processedRecIdx: [...context.processedRecIdx] });
        context.stats.found += 1;
        if (context.processedRecIdx.has(job.recIdx)) {
          context.stats.skipped += 1;
          continue;
        }
        context.processedRecIdx.add(job.recIdx);
        try {
          const saved = await retryJob(job, config);
          if (saved.action === "created") context.stats.created += 1;
          else context.stats.updated += 1;
        } catch (error) {
          context.stats.failed += 1;
          context.errors.push({ recIdx: job.recIdx, url: job.url, stage: "extract-or-save", message: error.message });
        }
        await setAutoState({ ...context.stats, errors: context.errors.slice(-50) });
        await requestDelay(config);
      }
      if (page === config.maxPagesPerSearch || !(await advanceSearchPage(searchTabId, page + 1))) break;
      await requestDelay(config);
    }
  });
}

async function runAutoCollection(trigger = "manual") {
  if (autoCollectionPromise) throw new Error("자동 수집이 이미 실행 중입니다.");

  autoCollectionPromise = (async () => {
    const saved = await chrome.storage.local.get([SEARCH_URLS_KEY, AUTO_STATE_KEY]);
    const urls = (saved[SEARCH_URLS_KEY] || []).filter(item => item?.enabled);
    const config = await getAutoConfig();
    const previous = saved[AUTO_STATE_KEY]?.running ? saved[AUTO_STATE_KEY] : null;
    const context = {
      processedRecIdx: new Set(previous?.processedRecIdx || []),
      stats: previous ? { pages: previous.pages || 0, found: previous.found || 0, created: previous.created || 0, updated: previous.updated || 0, skipped: previous.skipped || 0, failed: previous.failed || 0 } : { pages: 0, found: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
      errors: previous?.errors || []
    };
    const startedAt = new Date().toISOString();
    await setAutoState({
      running: true,
      status: "running",
      trigger: previous ? "resume" : trigger,
      startedAt: previous?.startedAt || startedAt,
      finishedAt: null,
      totalSearchUrls: urls.length,
      searchIndex: previous?.searchIndex || 0,
      currentPage: previous?.currentPage || 1,
      currentJobIndex: previous?.currentJobIndex || 0,
      currentSearchId: null,
      currentSearchName: null,
      processedSearchUrls: previous?.processedSearchUrls || 0,
      ...context.stats,
      errors: [],
      error: null
    });

    try {
      // 활성 검색 URL과 각 검색 결과의 공고를 모두 순차적으로 처리합니다.
      for (let index = previous ? (previous.searchIndex || 0) : 0; index < urls.length; index += 1) {
        const item = urls[index];
        await setAutoState({
          searchIndex: index,
          currentPage: 1,
          currentJobIndex: 0,
          currentSearchId: item.id,
          currentSearchName: item.name
        });
        try {
          await processSearchUrl(item, context, config, index === (previous?.searchIndex || 0) ? { page: previous?.currentPage || 1, jobIndex: previous?.currentJobIndex || 0 } : {});
        } catch (error) {
          context.stats.failed += 1;
          context.errors.push({ recIdx: null, url: item.url, stage: "search-page", message: error.message });
        }
        await setAutoState({ processedSearchUrls: index + 1, ...context.stats, errors: context.errors.slice(-50) });
        if (context.stats.found >= config.maxJobs) break;
      }

      const completed = await setAutoState({
        running: false,
        status: "completed",
        finishedAt: new Date().toISOString(),
        lastSuccessfulRun: new Date().toISOString(),
        processedRecIdx: [],
        currentSearchId: null,
        currentSearchName: null
      });
      await recordAutoRun(completed);
      return completed;
    } catch (error) {
      const failed = await setAutoState({
        running: false,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message
      });
      await recordAutoRun(failed);
      throw error;
    }
  })();

  try {
    return await autoCollectionPromise;
  } finally {
    autoCollectionPromise = null;
    if (await chrome.offscreen.hasDocument().catch(() => false)) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureWeeklyAlarm().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  ensureWeeklyAlarm().then(async () => {
    const saved = await chrome.storage.local.get(AUTO_STATE_KEY);
    if (saved[AUTO_STATE_KEY]?.running) await runAutoCollection("resume");
  }).catch(console.error);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_COLLECTION_ALARM) {
    runAutoCollection("scheduled").catch(console.error);
  }
});

ensureWeeklyAlarm().catch(console.error);

function cleanId(value) {
  return String(value || "").trim().replace(/-/g, "");
}

function canonicalUrl(value) {
  const raw = String(value || "").trim();
  const markdown = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/);
  const candidate = markdown ? markdown[1] : raw;
  try {
    const url = new URL(candidate);
    const recIdx = url.searchParams.get("rec_idx");
    return recIdx ? `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${recIdx}` : candidate;
  } catch (_) {
    return candidate;
  }
}

function richText(value) {
  const text = String(value || "");
  const chunks = [];
  for (let i = 0; i < text.length && chunks.length < 100; i += 2000) {
    chunks.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
  }
  return { rich_text: chunks };
}

function notionProperties(data) {
  const title = String(data["회사/직무(제목)"] || "제목 없는 채용공고").slice(0, 2000);
  const link = canonicalUrl(data["공고링크"]);
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(data["마감일"] || "").slice(0, 10))
    ? String(data["마감일"]).slice(0, 10)
    : null;
  const properties = {
    "회사/직무(제목)": { title: [{ type: "text", text: { content: title } }] },
    "공고링크": { url: link || null },
    "주요업무": richText(data["주요업무"]),
    "지원자격": richText(data["지원자격"]),
    "우대사항": richText(data["우대사항"]),
    "기술스택": { multi_select: Array.isArray(data["기술스택"]) ? data["기술스택"].filter(Boolean).map(name => ({ name: String(name).slice(0, 100) })) : [] },
    "자격/어학": richText(data["자격/어학"]),
    "근무조건/복지": richText(data["근무조건/복지"]),
    "지역": richText(data["지역"]),
    "마감일": { date: deadline ? { start: deadline } : null }
  };
  return { properties, link };
}

async function getSettings() {
  return chrome.storage.local.get(["notionToken", "notionDataSourceId"]);
}

async function notionFetch(path, options = {}) {
  const { notionToken } = await getSettings();
  if (!notionToken) throw new Error("Notion 액세스 토큰을 먼저 저장해 주세요.");
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${notionToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("토큰이 올바르지 않습니다. 새로 복사해 저장해 주세요.");
    if (response.status === 404) throw new Error("DB를 찾을 수 없습니다. 연결의 콘텐츠 사용 권한과 데이터 소스 ID를 확인해 주세요.");
    if (response.status === 403) throw new Error("Notion 연결에 읽기·삽입·업데이트 권한이 필요합니다.");
    throw new Error(body.message || `Notion API 오류 (${response.status})`);
  }
  return body;
}

async function testConnection() {
  const { notionDataSourceId } = await getSettings();
  const id = cleanId(notionDataSourceId);
  if (!id) throw new Error("데이터 소스 ID를 입력해 주세요.");
  const source = await notionFetch(`/data_sources/${id}`);
  const title = source.title?.map(item => item.plain_text).join("") || "채용공고 분석 DB";
  return { title };
}

async function saveJob(data) {
  const { notionDataSourceId } = await getSettings();
  const id = cleanId(notionDataSourceId);
  if (!id) throw new Error("데이터 소스 ID를 입력해 주세요.");
  const { properties, link } = notionProperties(data || {});
  if (!link) throw new Error("공고링크가 없어 저장할 수 없습니다.");

  const query = await notionFetch(`/data_sources/${id}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 1, filter: { property: "공고링크", url: { equals: link } } })
  });

  if (query.results?.length) {
    const page = await notionFetch(`/pages/${query.results[0].id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties })
    });
    return { action: "updated", url: page.url, title: data["회사/직무(제목)"] };
  }

  const page = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: id }, properties })
  });
  return { action: "created", url: page.url, title: data["회사/직무(제목)"] };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const supported = ["TEST_NOTION", "SAVE_NOTION_JOB", "RUN_AUTO_COLLECTION", "ENSURE_AUTO_ALARM"];
  if (!supported.includes(message?.type)) return false;
  (async () => {
    if (message?.type === "TEST_NOTION") return testConnection();
    if (message?.type === "SAVE_NOTION_JOB") return saveJob(message.data);
    if (message?.type === "RUN_AUTO_COLLECTION") return runAutoCollection("manual");
    if (message?.type === "ENSURE_AUTO_ALARM") {
      const alarm = await ensureWeeklyAlarm();
      return { scheduledTime: alarm?.scheduledTime || null };
    }
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
