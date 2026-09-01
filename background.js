importScripts("core.js", "workflow.js");

const NOTION_VERSION = "2026-03-11";
const AUTO_COLLECTION_ALARM = "weekly-saramin-auto-collection";
const LEGACY_ALARM_NAMES = ["saramin-weekly-auto-collection"];
const SEARCH_URLS_KEY = "saraminSearchUrls";
const AUTO_STATE_KEY = "autoCollectionState";
const AUTO_HISTORY_KEY = "autoCollectionHistory";
const AUTO_CONFIG_KEY = "autoCollectionConfig";
const AUTO_DEFAULTS = {
  recentDays: 7,
  maxPagesPerSearch: 10,
  maxJobs: 100,
  minDelayMs: 2000,
  maxDelayMs: 4000,
  maxRetries: 3,
  scheduleEnabled: true,
  weekday: 1,
  hour: 9,
  minute: 0
};
let autoCollectionPromise = null;
const { notionProperties } = SaraminCore;
const {
  CancellationError,
  httpError,
  shouldRetry,
  isFatal,
  publicError,
  nextCursor,
  jobDecision
} = SaraminWorkflow;

async function setAutoState(changes) {
  const saved = await chrome.storage.local.get(AUTO_STATE_KEY);
  const state = { ...(saved[AUTO_STATE_KEY] || {}), ...changes };
  await chrome.storage.local.set({ [AUTO_STATE_KEY]: state });
  return state;
}

async function isCancelRequested() {
  const saved = await chrome.storage.local.get(AUTO_STATE_KEY);
  return Boolean(saved[AUTO_STATE_KEY]?.cancelRequested);
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
  const numberKeys = ["recentDays", "maxPagesPerSearch", "maxJobs", "minDelayMs", "maxDelayMs", "maxRetries"];
  const config = Object.fromEntries(numberKeys.map(key => [
    key,
    Number.isFinite(Number(value[key])) ? Number(value[key]) : AUTO_DEFAULTS[key]
  ]));
  Object.assign(config, SaraminCore.normalizeScheduleConfig(value));
  config.recentDays = Math.max(1, Math.min(30, config.recentDays));
  config.maxPagesPerSearch = Math.max(1, Math.min(50, config.maxPagesPerSearch));
  config.maxJobs = Math.max(1, Math.min(500, config.maxJobs));
  config.maxRetries = Math.max(1, Math.min(5, config.maxRetries));
  config.minDelayMs = Math.max(1000, Math.min(60000, config.minDelayMs));
  config.maxDelayMs = Math.max(config.minDelayMs, Math.min(60000, config.maxDelayMs));
  return config;
}

async function saveAutoConfig(value) {
  const before = await chrome.storage.local.get([AUTO_CONFIG_KEY, AUTO_STATE_KEY]);
  const prior = before[AUTO_CONFIG_KEY] || {};
  const merged = { ...(await getAutoConfig()), ...(value || {}) };
  const schedule = SaraminCore.normalizeScheduleConfig(merged);
  const numeric = {
    recentDays: Math.max(1, Math.min(30, Number(merged.recentDays))),
    maxPagesPerSearch: Math.max(1, Math.min(50, Number(merged.maxPagesPerSearch))),
    maxJobs: Math.max(1, Math.min(500, Number(merged.maxJobs))),
    maxRetries: Math.max(1, Math.min(5, Number(merged.maxRetries))),
    minDelayMs: Math.max(1000, Math.min(60000, Number(merged.minDelayMs))),
    maxDelayMs: Math.max(1000, Math.min(60000, Number(merged.maxDelayMs)))
  };
  if (!Object.values(numeric).every(Number.isFinite) || numeric.minDelayMs > numeric.maxDelayMs) {
    throw new Error("자동 수집 제한값을 올바르게 입력해 주세요.");
  }
  const config = { ...numeric, ...schedule };
  await chrome.storage.local.set({ [AUTO_CONFIG_KEY]: config });
  const scheduleChanged = prior.scheduleEnabled !== config.scheduleEnabled
    || Number(prior.weekday) !== config.weekday
    || Number(prior.hour) !== config.hour
    || Number(prior.minute) !== config.minute;
  if (!before[AUTO_STATE_KEY]?.scheduleActivatedAt || scheduleChanged) {
    await setAutoState({ scheduleActivatedAt: new Date().toISOString() });
  }
  const alarm = await ensureWeeklyAlarm(config);
  return { config, scheduledTime: alarm?.scheduledTime || null };
}

async function ensureWeeklyAlarm(config = null) {
  const current = config || await getAutoConfig();
  await Promise.all(LEGACY_ALARM_NAMES.map(name => chrome.alarms.clear(name)));
  await chrome.alarms.clear(AUTO_COLLECTION_ALARM);
  if (!current.scheduleEnabled) return null;
  const when = SaraminCore.nextWeeklyOccurrence(current, new Date()).getTime();
  chrome.alarms.create(AUTO_COLLECTION_ALARM, { when });
  return chrome.alarms.get(AUTO_COLLECTION_ALARM);
}

async function runStartupCollection() {
  const saved = await chrome.storage.local.get(AUTO_STATE_KEY);
  const state = saved[AUTO_STATE_KEY] || {};
  if (state.running) {
    await runAutoCollection("resume");
    await ensureWeeklyAlarm();
    return;
  }
  const config = await getAutoConfig();
  if (!config.scheduleEnabled) {
    await ensureWeeklyAlarm(config);
    return;
  }
  const now = new Date();
  const anchor = SaraminCore.currentWeeklyAnchor(config, now);
  const lastSuccess = state.lastScheduledSuccess ? new Date(state.lastScheduledSuccess) : null;
  const lastAttempt = state.lastCatchupAttempt ? new Date(state.lastCatchupAttempt) : null;
  const activatedAt = state.scheduleActivatedAt ? new Date(state.scheduleActivatedAt) : now;
  if (anchor >= activatedAt && now >= anchor && (!lastSuccess || lastSuccess < anchor) && (!lastAttempt || lastAttempt < anchor)) {
    await setAutoState({ lastCatchupAttempt: now.toISOString() });
    await runAutoCollection("missed-schedule");
  }
  await ensureWeeklyAlarm(config);
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
  const jobs = globalThis.SaraminCore.parseSearchJobs(
    document, location.href, recentDays, new Date()
  );
  return { jobs, fingerprint: jobs.map(job => job.recIdx).sort().join(",") };
}

async function collectSearchPage(tabId, config) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["core.js"] });
  let page = { jobs: [], fingerprint: "" };
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

async function advanceSearchPage(tabId, nextPageNumber, previousFingerprint, config) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: clickNextSearchPage,
    args: [nextPageNumber]
  });
  if (!result?.result) return false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await delay(500);
    const next = await collectSearchPage(tabId, config);
    if (next.fingerprint && next.fingerprint !== previousFingerprint) return true;
  }
  return false;
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
      if (error instanceof CancellationError || isFatal(error) || !shouldRetry(error)) throw error;
      if (attempt < config.maxRetries) {
        const exponential = Math.min(60000, 1000 * (2 ** (attempt - 1)));
        const jitter = Math.floor(Math.random() * 500);
        await delay(Math.max(error.retryAfterMs || 0, exponential + jitter));
      }
    }
  }
  throw lastError || new Error("처리 실패");
}

async function processSearchUrl(item, context, config, resume = {}) {
  return withBackgroundTab(item.url, async searchTabId => {
    for (let page = 1; page <= config.maxPagesPerSearch; page += 1) {
      if (await isCancelRequested()) throw new CancellationError();
      const result = await collectSearchPage(searchTabId, config);
      context.stats.pages += 1;
      for (let jobIndex = 0; jobIndex < result.jobs.length; jobIndex += 1) {
        if (await isCancelRequested()) throw new CancellationError();
        const job = result.jobs[jobIndex];
        if (page < (resume.page || 1) || (page === (resume.page || 1) && jobIndex < (resume.nextJobIndex || 0))) continue;
        const decision = jobDecision(job.recIdx, context.processedRecIdx, context.stats.found, config.maxJobs);
        if (decision === "limit") return;
        await setAutoState({ currentPage: page, nextJobIndex: jobIndex, processedRecIdx: [...context.processedRecIdx] });
        context.stats.found += 1;
        if (decision === "duplicate") {
          context.stats.skipped += 1;
          const cursor = nextCursor(page, jobIndex, result.jobs.length);
          await setAutoState({ ...cursor, ...context.stats, processedRecIdx: [...context.processedRecIdx] });
          continue;
        }
        try {
          const saved = await retryJob(job, config);
          if (saved.action === "created") context.stats.created += 1;
          else context.stats.updated += 1;
        } catch (error) {
          if (error instanceof CancellationError || isFatal(error)) throw error;
          context.stats.failed += 1;
          context.errors.push({ recIdx: job.recIdx, url: job.url, stage: "extract-or-save", ...publicError(error) });
        }
        context.processedRecIdx.add(job.recIdx);
        const cursor = nextCursor(page, jobIndex, result.jobs.length);
        await setAutoState({
          ...cursor,
          ...context.stats,
          processedRecIdx: [...context.processedRecIdx],
          errors: context.errors.slice(-20)
        });
        await requestDelay(config);
      }
      if (page === config.maxPagesPerSearch || !(await advanceSearchPage(searchTabId, page + 1, result.fingerprint, config))) break;
      await requestDelay(config);
    }
  });
}

async function runAutoCollection(trigger = "manual") {
  if (autoCollectionPromise) throw new Error("자동 수집이 이미 실행 중입니다.");

  autoCollectionPromise = (async () => {
    const saved = await chrome.storage.local.get([SEARCH_URLS_KEY, AUTO_STATE_KEY, "notionToken", "notionDataSourceId"]);
    const urls = (saved[SEARCH_URLS_KEY] || []).filter(item => item?.enabled);
    const setupError = !urls.length
      ? "활성화된 사람인 검색 URL을 1개 이상 등록해 주세요."
      : !String(saved.notionToken || "").trim()
        ? "Notion 액세스 토큰을 먼저 저장해 주세요."
        : !cleanId(saved.notionDataSourceId)
          ? "Notion 데이터 소스 ID를 먼저 저장해 주세요."
          : null;
    if (setupError) {
      const now = new Date().toISOString();
      const failed = await setAutoState({
        running: false,
        status: "failed",
        trigger,
        startedAt: now,
        finishedAt: now,
        totalSearchUrls: urls.length,
        error: setupError,
        errors: [{ recIdx: null, url: null, stage: "configuration", message: setupError, status: null }]
      });
      await recordAutoRun(failed);
      throw new Error(setupError);
    }
    const config = await getAutoConfig();
    const previous = saved[AUTO_STATE_KEY]?.running ? saved[AUTO_STATE_KEY] : null;
    const runTrigger = previous?.trigger || trigger;
    const context = {
      processedRecIdx: new Set(previous?.processedRecIdx || []),
      stats: previous ? { pages: previous.pages || 0, found: previous.found || 0, created: previous.created || 0, updated: previous.updated || 0, skipped: previous.skipped || 0, failed: previous.failed || 0 } : { pages: 0, found: 0, created: 0, updated: 0, skipped: 0, failed: 0 },
      errors: previous?.errors || []
    };
    const startedAt = new Date().toISOString();
    await setAutoState({
      running: true,
      status: "running",
      trigger: runTrigger,
      startedAt: previous?.startedAt || startedAt,
      finishedAt: null,
      totalSearchUrls: urls.length,
      searchIndex: previous?.searchIndex || 0,
      currentPage: previous?.currentPage || 1,
      nextJobIndex: previous?.nextJobIndex || 0,
      currentSearchId: null,
      currentSearchName: null,
      processedSearchUrls: previous?.processedSearchUrls || 0,
      cancelRequested: false,
      ...context.stats,
      errors: context.errors.slice(-20),
      error: null
    });

    try {
      // 활성 검색 URL과 각 검색 결과의 공고를 모두 순차적으로 처리합니다.
      for (let index = previous ? (previous.searchIndex || 0) : 0; index < urls.length; index += 1) {
        const item = urls[index];
        await setAutoState({
          searchIndex: index,
          currentPage: 1,
          nextJobIndex: 0,
          currentSearchId: item.id,
          currentSearchName: item.name
        });
        try {
          await processSearchUrl(item, context, config, index === (previous?.searchIndex || 0) ? { page: previous?.currentPage || 1, nextJobIndex: previous?.nextJobIndex || 0 } : {});
        } catch (error) {
          if (error instanceof CancellationError || isFatal(error)) throw error;
          context.stats.failed += 1;
          context.errors.push({ recIdx: null, url: item.url, stage: "search-page", ...publicError(error) });
        }
        await setAutoState({ searchIndex: index + 1, currentPage: 1, nextJobIndex: 0, processedSearchUrls: index + 1, ...context.stats, errors: context.errors.slice(-20) });
        if (context.stats.found >= config.maxJobs) break;
      }

      const finishedAt = new Date().toISOString();
      const completed = await setAutoState({
        running: false,
        status: "completed",
        finishedAt,
        lastSuccessfulRun: finishedAt,
        ...(["scheduled", "missed-schedule"].includes(runTrigger) ? { lastScheduledSuccess: finishedAt } : {}),
        processedRecIdx: [],
        cancelRequested: false,
        currentSearchId: null,
        currentSearchName: null
      });
      await recordAutoRun(completed);
      return completed;
    } catch (error) {
      const cancelled = error instanceof CancellationError;
      const failed = await setAutoState({
        running: false,
        status: cancelled ? "cancelled" : "failed",
        finishedAt: new Date().toISOString(),
        error: publicError(error).message
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

chrome.runtime.onStartup.addListener(() => {
  runStartupCollection().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  saveAutoConfig({}).catch(console.error);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== AUTO_COLLECTION_ALARM) return;
  runAutoCollection("scheduled")
    .catch(console.error)
    .finally(() => ensureWeeklyAlarm().catch(console.error));
});

function cleanId(value) {
  return String(value || "").trim().replace(/-/g, "");
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
    const retryAfter = Number(response.headers.get("Retry-After"));
    const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
    if (response.status === 401) throw httpError(401, "토큰이 올바르지 않습니다. 새로 복사해 저장해 주세요.");
    if (response.status === 404) throw httpError(404, "DB를 찾을 수 없습니다. 연결 권한과 데이터 소스 ID를 확인해 주세요.");
    if (response.status === 403) throw httpError(403, "Notion 연결에 읽기·삽입·업데이트 권한이 필요합니다.");
    throw httpError(response.status, `Notion API 오류 (${response.status})`, retryAfterMs);
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
  const supported = [
    "TEST_NOTION",
    "SAVE_NOTION_JOB",
    "RUN_AUTO_COLLECTION",
    "STOP_AUTO_COLLECTION",
    "SAVE_AUTO_CONFIG",
    "GET_AUTO_SCHEDULE"
  ];
  if (!supported.includes(message?.type)) return false;
  (async () => {
    if (message?.type === "TEST_NOTION") return testConnection();
    if (message?.type === "SAVE_NOTION_JOB") return saveJob(message.data);
    if (message?.type === "RUN_AUTO_COLLECTION") return runAutoCollection("manual");
    if (message?.type === "STOP_AUTO_COLLECTION") return setAutoState({ cancelRequested: true });
    if (message?.type === "SAVE_AUTO_CONFIG") return saveAutoConfig(message.config);
    if (message?.type === "GET_AUTO_SCHEDULE") {
      const config = await getAutoConfig();
      const alarm = await ensureWeeklyAlarm(config);
      return { config, scheduledTime: alarm?.scheduledTime || null };
    }
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
