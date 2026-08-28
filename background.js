const NOTION_VERSION = "2026-03-11";

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
    throw new Error("지원하지 않는 요청입니다.");
  })().then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
