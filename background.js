const NOTION_VERSION = "2026-03-11";
const AUTO_COLLECTION_ALARM = "weekly-saramin-auto-collection";
const WEEK_IN_MINUTES = 7 * 24 * 60;
const SEARCH_URLS_KEY = "saraminSearchUrls";
const AUTO_STATE_KEY = "autoCollectionState";
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

async function processSearchUrl(_item) {
  // 다음 단계에서 검색 결과 DOM 수집을 이 함수에 연결합니다.
  return { status: "queued" };
}

async function runAutoCollection(trigger = "manual") {
  if (autoCollectionPromise) throw new Error("자동 수집이 이미 실행 중입니다.");

  autoCollectionPromise = (async () => {
    const saved = await chrome.storage.local.get(SEARCH_URLS_KEY);
    const urls = (saved[SEARCH_URLS_KEY] || []).filter(item => item?.enabled);
    const startedAt = new Date().toISOString();
    await setAutoState({
      running: true,
      status: "running",
      trigger,
      startedAt,
      finishedAt: null,
      totalSearchUrls: urls.length,
      searchIndex: 0,
      currentSearchId: null,
      currentSearchName: null,
      processedSearchUrls: 0,
      error: null
    });

    try {
      // 1단계에서는 검색 URL을 순차적으로 Pipeline에 전달하고 진행 상태만 기록합니다.
      for (let index = 0; index < urls.length; index += 1) {
        const item = urls[index];
        await setAutoState({
          searchIndex: index,
          currentSearchId: item.id,
          currentSearchName: item.name
        });
        await processSearchUrl(item);
        await setAutoState({ processedSearchUrls: index + 1 });
      }

      return await setAutoState({
        running: false,
        status: "completed",
        finishedAt: new Date().toISOString(),
        lastSuccessfulRun: new Date().toISOString(),
        currentSearchId: null,
        currentSearchName: null
      });
    } catch (error) {
      await setAutoState({
        running: false,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error.message
      });
      throw error;
    }
  })();

  try {
    return await autoCollectionPromise;
  } finally {
    autoCollectionPromise = null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureWeeklyAlarm().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  ensureWeeklyAlarm().catch(console.error);
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
  (async () => {
    if (message?.type === "TEST_NOTION") return testConnection();
    if (message?.type === "SAVE_NOTION_JOB") return saveJob(message.data);
    if (message?.type === "RUN_AUTO_COLLECTION") return runAutoCollection("manual");
    if (message?.type === "ENSURE_AUTO_ALARM") {
      const alarm = await ensureWeeklyAlarm();
      return { scheduledTime: alarm?.scheduledTime || null };
    }
    throw new Error("지원하지 않는 요청입니다.");
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
