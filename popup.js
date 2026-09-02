const scanButton = document.querySelector("#scan");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const ocrButton = document.querySelector("#ocr");
const progressBox = document.querySelector("#progress");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const progressValue = document.querySelector("#progressValue");
const notionToken = document.querySelector("#notionToken");
const dataSourceId = document.querySelector("#dataSourceId");
const notionSettings = document.querySelector("#notionSettings");
const saveNotionButton = document.querySelector("#saveNotion");
let extracted = null;
const SEARCH_URLS_KEY = "saraminSearchUrls";
const AUTO_STATE_KEY = "autoCollectionState";
const AUTO_HISTORY_KEY = "autoCollectionHistory";
const AUTO_CONFIG_KEY = "autoCollectionConfig";
const AUTO_DEFAULTS = { recentDays: 7, maxPagesPerSearch: 10, maxJobs: 100, minDelayMs: 2000, maxDelayMs: 4000, maxRetries: 3 };
const searchUrlForm = document.querySelector("#searchUrlForm");
const searchName = document.querySelector("#searchName");
const searchUrl = document.querySelector("#searchUrl");
const searchUrlList = document.querySelector("#searchUrlList");
const cancelSearchEdit = document.querySelector("#cancelSearchEdit");
const runAutoCollectionButton = document.querySelector("#runAutoCollection");
const autoStatus = document.querySelector("#autoStatus");
const autoHistory = document.querySelector("#autoHistory");
const stopAutoCollectionButton = document.querySelector("#stopAutoCollection");
const scheduleEnabled = document.querySelector("#scheduleEnabled");
const scheduleWeekday = document.querySelector("#scheduleWeekday");
const scheduleTime = document.querySelector("#scheduleTime");
const nextScheduledRun = document.querySelector("#nextScheduledRun");
let searchUrls = [];
let editingSearchId = null;
const configFields = { recentDays: document.querySelector("#recentDays"), maxPagesPerSearch: document.querySelector("#maxPagesPerSearch"), maxJobs: document.querySelector("#maxJobs"), maxRetries: document.querySelector("#maxRetries"), minDelaySeconds: document.querySelector("#minDelaySeconds"), maxDelaySeconds: document.querySelector("#maxDelaySeconds") };

async function loadNotionSettings() {
  const saved = await chrome.storage.local.get(["notionToken", "notionDataSourceId"]);
  notionToken.value = saved.notionToken || "";
  dataSourceId.value = saved.notionDataSourceId || "";
}

async function persistNotionSettings() {
  const token = notionToken.value.trim();
  const sourceId = dataSourceId.value.trim();
  if (!token) throw new Error("Notion 액세스 토큰을 입력해 주세요.");
  if (!sourceId) throw new Error("데이터 소스 ID를 입력해 주세요.");
  await chrome.storage.local.set({ notionToken: token, notionDataSourceId: sourceId });
}

loadNotionSettings();

function validSaraminSearchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "saramin.co.kr" || url.hostname.endsWith(".saramin.co.kr"));
  } catch (_) {
    return false;
  }
}

function resetSearchForm() {
  editingSearchId = null;
  searchUrlForm.reset();
  document.querySelector("#saveSearchUrl").textContent = "URL 추가";
  cancelSearchEdit.hidden = true;
}

async function persistSearchUrls() {
  await chrome.storage.local.set({ [SEARCH_URLS_KEY]: searchUrls });
}

function renderSearchUrls() {
  searchUrlList.replaceChildren();
  if (!searchUrls.length) {
    const empty = document.createElement("div");
    empty.className = "url-empty";
    empty.textContent = "등록된 검색 URL이 없습니다.";
    searchUrlList.append(empty);
    return;
  }

  searchUrls.forEach(item => {
    const box = document.createElement("div");
    box.className = `url-item${item.enabled ? "" : " disabled"}`;
    const heading = document.createElement("div");
    heading.className = "url-heading";
    const name = document.createElement("span");
    name.className = "url-name";
    name.textContent = item.name;
    const state = document.createElement("span");
    state.className = "hint";
    state.textContent = item.enabled ? "활성" : "비활성";
    heading.append(name, state);
    const link = document.createElement("span");
    link.className = "url-link";
    link.title = item.url;
    link.textContent = item.url;
    const actions = document.createElement("div");
    actions.className = "url-actions";
    [["toggle", item.enabled ? "비활성화" : "활성화"], ["edit", "수정"], ["delete", "삭제"]].forEach(([action, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "delete" ? "danger" : "secondary";
      button.dataset.action = action;
      button.dataset.id = item.id;
      button.textContent = label;
      actions.append(button);
    });
    box.append(heading, link, actions);
    searchUrlList.append(box);
  });
}

function formatAutoState(state) {
  if (!state?.status) return "실행 기록이 없습니다.";
  if (state.running) return `실행 중 · URL ${state.processedSearchUrls || 0}/${state.totalSearchUrls || 0} · 공고 ${state.found || 0}개`;
  const time = state.finishedAt ? new Date(state.finishedAt).toLocaleString("ko-KR") : "";
  if (state.status === "failed") return `실패 · ${state.error || "알 수 없는 오류"}`;
  if (state.status === "cancelled") return `중지됨 · ${state.found || 0}개 처리`;
  return `최근 완료 ${time} · 발견 ${state.found || 0} · 신규 ${state.created || 0} · 업데이트 ${state.updated || 0} · 중복 ${state.skipped || 0} · 실패 ${state.failed || 0}`;
}

function renderAutoHistory(history = []) {
  autoHistory.replaceChildren();
  history.slice(0, 5).forEach(entry => {
    const item = document.createElement("div");
    item.className = "history-item";
    const time = entry.finishedAt ? new Date(entry.finishedAt).toLocaleString("ko-KR") : "진행 중";
    const label = entry.status === "completed" ? "완료" : entry.status === "cancelled" ? "중지됨" : "실패";
    item.textContent = `${time} · ${label} · 발견 ${entry.found || 0} · 신규 ${entry.created || 0} · 업데이트 ${entry.updated || 0} · 실패 ${entry.failed || 0}`;
    autoHistory.append(item);
  });
}

function renderAutoConfig(config = AUTO_DEFAULTS) {
  configFields.recentDays.value = config.recentDays;
  configFields.maxPagesPerSearch.value = config.maxPagesPerSearch;
  configFields.maxJobs.value = config.maxJobs;
  configFields.maxRetries.value = config.maxRetries;
  configFields.minDelaySeconds.value = Math.round(config.minDelayMs / 1000);
  configFields.maxDelaySeconds.value = Math.round(config.maxDelayMs / 1000);
  scheduleEnabled.checked = config.scheduleEnabled !== false;
  scheduleWeekday.value = String(config.weekday || 1);
  scheduleTime.value = `${String(config.hour ?? 9).padStart(2, "0")}:${String(config.minute ?? 0).padStart(2, "0")}`;
}

function renderNextRun(scheduledTime, enabled) {
  nextScheduledRun.textContent = enabled && scheduledTime
    ? `브라우저 현지 시간 기준 · 다음 실행 ${new Date(scheduledTime).toLocaleString("ko-KR")}`
    : "브라우저 현지 시간 기준 · 자동 실행 꺼짐";
}

async function loadAutoSettings() {
  const saved = await chrome.storage.local.get([SEARCH_URLS_KEY, AUTO_STATE_KEY, AUTO_HISTORY_KEY, AUTO_CONFIG_KEY]);
  searchUrls = Array.isArray(saved[SEARCH_URLS_KEY]) ? saved[SEARCH_URLS_KEY] : [];
  renderSearchUrls();
  autoStatus.textContent = formatAutoState(saved[AUTO_STATE_KEY]);
  stopAutoCollectionButton.hidden = !saved[AUTO_STATE_KEY]?.running;
  renderAutoHistory(saved[AUTO_HISTORY_KEY]);
  const scheduleResponse = await chrome.runtime.sendMessage({ type: "GET_AUTO_SCHEDULE" });
  if (!scheduleResponse?.ok) throw new Error(scheduleResponse?.error || "예약 정보를 불러오지 못했습니다.");
  renderAutoConfig(scheduleResponse.data.config);
  renderNextRun(scheduleResponse.data.scheduledTime, scheduleResponse.data.config.scheduleEnabled);
}

loadAutoSettings().catch(error => {
  autoStatus.textContent = `자동 수집 설정을 불러오지 못했습니다: ${error.message}`;
});

document.querySelector("#saveAutoConfig").addEventListener("click", async () => {
  const values = Object.fromEntries(Object.entries(configFields).map(([key, field]) => [key, Number(field.value)]));
  const [hour, minute] = scheduleTime.value.split(":").map(Number);
  const config = {
    recentDays: values.recentDays,
    maxPagesPerSearch: values.maxPagesPerSearch,
    maxJobs: values.maxJobs,
    maxRetries: values.maxRetries,
    minDelayMs: values.minDelaySeconds * 1000,
    maxDelayMs: values.maxDelaySeconds * 1000,
    scheduleEnabled: scheduleEnabled.checked,
    weekday: Number(scheduleWeekday.value),
    hour,
    minute
  };
  const numericValues = [config.recentDays, config.maxPagesPerSearch, config.maxJobs, config.maxRetries, config.minDelayMs, config.maxDelayMs, config.weekday, config.hour, config.minute];
  if (!numericValues.every(Number.isFinite) || config.minDelayMs > config.maxDelayMs || config.recentDays < 1 || config.maxPagesPerSearch < 1 || config.maxJobs < 1 || config.maxRetries < 1) {
    setStatus("자동 수집 제한값을 올바르게 입력해 주세요.", true);
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "SAVE_AUTO_CONFIG", config });
  if (!response?.ok) {
    setStatus(response?.error || "자동 수집 설정을 저장하지 못했습니다.", true);
    return;
  }
  renderAutoConfig(response.data.config);
  renderNextRun(response.data.scheduledTime, response.data.config.scheduleEnabled);
  setStatus("자동 수집 설정과 주간 예약을 저장했습니다.");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[AUTO_STATE_KEY]?.newValue) {
    const state = changes[AUTO_STATE_KEY].newValue;
    autoStatus.textContent = formatAutoState(state);
    stopAutoCollectionButton.hidden = !state.running;
  }
  if (areaName === "local" && changes[AUTO_HISTORY_KEY]?.newValue) renderAutoHistory(changes[AUTO_HISTORY_KEY].newValue);
});

searchUrlForm.addEventListener("submit", async event => {
  event.preventDefault();
  const name = searchName.value.trim();
  const url = searchUrl.value.trim();
  if (!name || !url) return;
  if (!validSaraminSearchUrl(url)) {
    setStatus("https:// 사람인 검색 URL을 입력해 주세요.", true);
    return;
  }
  if (editingSearchId) {
    searchUrls = searchUrls.map(item => item.id === editingSearchId ? { ...item, name, url } : item);
  } else {
    searchUrls.push({ id: crypto.randomUUID(), name, url, enabled: true });
  }
  await persistSearchUrls();
  renderSearchUrls();
  resetSearchForm();
  setStatus("검색 URL 목록을 저장했습니다.");
});

cancelSearchEdit.addEventListener("click", resetSearchForm);

searchUrlList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const item = searchUrls.find(entry => entry.id === button.dataset.id);
  if (!item) return;
  if (button.dataset.action === "edit") {
    editingSearchId = item.id;
    searchName.value = item.name;
    searchUrl.value = item.url;
    document.querySelector("#saveSearchUrl").textContent = "수정 저장";
    cancelSearchEdit.hidden = false;
    searchName.focus();
    return;
  }
  if (button.dataset.action === "delete") {
    if (!confirm(`‘${item.name}’ 검색 URL을 삭제할까요?`)) return;
    searchUrls = searchUrls.filter(entry => entry.id !== item.id);
    if (editingSearchId === item.id) resetSearchForm();
  } else {
    searchUrls = searchUrls.map(entry => entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry);
  }
  await persistSearchUrls();
  renderSearchUrls();
});

runAutoCollectionButton.addEventListener("click", async () => {
  const enabledCount = searchUrls.filter(item => item.enabled).length;
  if (!enabledCount) {
    setStatus("활성화된 검색 URL이 없습니다.", true);
    return;
  }
  if (!confirm(`활성 검색 URL ${enabledCount}개에서 최근 공고를 찾아 Notion에 실제 저장·업데이트할까요?`)) return;
  runAutoCollectionButton.disabled = true;
  stopAutoCollectionButton.hidden = false;
  autoStatus.textContent = "자동 수집 테스트를 시작합니다…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "RUN_AUTO_COLLECTION" });
    if (!response?.ok) throw new Error(response?.error || "자동 수집 테스트에 실패했습니다.");
    autoStatus.textContent = formatAutoState(response.data);
    setStatus("활성 검색 URL의 순차 전달 테스트를 완료했습니다.");
  } catch (error) {
    autoStatus.textContent = `실패 · ${error.message}`;
    setStatus(error.message, true);
  } finally {
    runAutoCollectionButton.disabled = false;
  }
});

stopAutoCollectionButton.addEventListener("click", async () => {
  stopAutoCollectionButton.disabled = true;
  await chrome.runtime.sendMessage({ type: "STOP_AUTO_COLLECTION" });
  autoStatus.textContent = "중지 요청을 처리하는 중입니다…";
});

document.querySelector("#toggleToken").addEventListener("click", event => {
  const show = notionToken.type === "password";
  notionToken.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "숨기기" : "보기";
});

document.querySelector("#saveSettings").addEventListener("click", async () => {
  try {
    await persistNotionSettings();
    notionSettings.open = false;
    setStatus("Notion 연결 설정을 저장했습니다.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector("#deleteToken").addEventListener("click", async () => {
  if (!notionToken.value && !(await chrome.storage.local.get("notionToken")).notionToken) {
    setStatus("이 PC에 저장된 Notion 토큰이 없습니다.");
    return;
  }
  if (!confirm("이 PC에 저장된 Notion 액세스 토큰을 삭제할까요?")) return;
  await chrome.storage.local.remove("notionToken");
  notionToken.value = "";
  notionToken.type = "password";
  document.querySelector("#toggleToken").textContent = "보기";
  setStatus("이 PC에 저장된 Notion 토큰을 삭제했습니다.");
});

document.querySelector("#testNotion").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await persistNotionSettings();
    setStatus("Notion 연결을 확인하는 중입니다…");
    const response = await chrome.runtime.sendMessage({ type: "TEST_NOTION" });
    if (!response?.ok) throw new Error(response?.error || "연결 테스트에 실패했습니다.");
    setStatus(`Notion 연결 성공: ${response.data.title}`);
    notionSettings.open = false;
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function publicData(data) {
  const { _ocrImages, _needsOcr, ...visible } = data || {};
  return visible;
}

function render(data) {
  extracted = data;
  preview.value = JSON.stringify(publicData(data), null, 2);
  result.hidden = false;
  ocrButton.hidden = !(data?._ocrImages?.length && data?._needsOcr);
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  setStatus("공고 내용을 읽는 중입니다…");
  try {
    const tab = await currentTab();
    const isSaraminJob = /^https:\/\/www\.saramin\.co\.kr\/zf_user\/jobs\/(?:view|relay\/view)(?:\?|$)/.test(tab?.url || "");
    if (!isSaraminJob) {
      throw new Error("사람인 채용공고 상세 페이지에서 실행해 주세요.");
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SARAMIN_JOB" }, { frameId: 0 });
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_SARAMIN_JOB" }, { frameId: 0 });
    }
    if (!response?.ok) throw new Error(response?.error || "공고를 추출하지 못했습니다.");
    render(response.data);
    setStatus("추출이 완료됐습니다. 저장 전에 내용을 확인해 주세요.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    scanButton.disabled = false;
  }
});

document.querySelector("#copy").addEventListener("click", async () => {
  if (!extracted) return;
  await navigator.clipboard.writeText(JSON.stringify(publicData(extracted), null, 2));
  setStatus("JSON을 클립보드에 복사했습니다.");
});

document.querySelector("#download").addEventListener("click", () => {
  if (!extracted) return;
  const visible = publicData(extracted);
  const blob = new Blob([JSON.stringify(visible, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(visible["회사/직무(제목)"] || "채용공고").replace(/[\\/:*?\"<>|]/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

saveNotionButton.addEventListener("click", async () => {
  if (!extracted) return;
  saveNotionButton.disabled = true;
  try {
    await persistNotionSettings();
    setStatus("Notion에서 중복을 확인하고 저장하는 중입니다…");
    const response = await chrome.runtime.sendMessage({ type: "SAVE_NOTION_JOB", data: publicData(extracted) });
    if (!response?.ok) throw new Error(response?.error || "Notion 저장에 실패했습니다.");
    const verb = response.data.action === "updated" ? "기존 공고를 업데이트했습니다." : "새 공고를 등록했습니다.";
    setStatus(`${verb} Notion 페이지를 새 탭에서 엽니다.`);
    if (response.data.url) await chrome.tabs.create({ url: response.data.url });
  } catch (error) {
    notionSettings.open = true;
    setStatus(error.message, true);
  } finally {
    saveNotionButton.disabled = false;
  }
});

function updateProgress(message) {
  const percent = Math.max(0, Math.min(100, Math.round((message.progress || 0) * 100)));
  progressBar.value = percent;
  progressValue.textContent = `${percent}%`;
  progressText.textContent = message.status === "recognizing text" ? "이미지에서 글자를 읽는 중…" : "OCR 모델 준비 중…";
}

ocrButton.addEventListener("click", async () => {
  if (!extracted?._ocrImages?.length) return;
  ocrButton.disabled = true;
  progressBox.hidden = false;
  setStatus("OCR을 실행하고 있습니다. 팝업을 닫지 마세요.");
  let worker;
  try {
    worker = await Tesseract.createWorker(["kor", "eng"], 1, {
      workerPath: chrome.runtime.getURL("ocr/worker.min.js"),
      langPath: chrome.runtime.getURL("ocr/lang"),
      corePath: chrome.runtime.getURL("ocr/core"),
      workerBlobURL: false,
      logger: updateProgress
    });
    const texts = [];
    for (let index = 0; index < extracted._ocrImages.length; index += 1) {
      progressText.textContent = `이미지 ${index + 1}/${extracted._ocrImages.length} 읽는 중…`;
      const result = await worker.recognize(extracted._ocrImages[index]);
      if (result.data.text?.trim()) texts.push(result.data.text.trim());
    }
    const tab = await currentTab();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "PARSE_OCR_TEXT",
      data: extracted,
      ocrText: texts.join("\n\n")
    }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error || "OCR 결과를 분류하지 못했습니다.");
    render(response.data);
    progressBar.value = 100;
    progressValue.textContent = "100%";
    setStatus("OCR 추출과 항목 분류가 완료됐습니다. 내용을 확인해 주세요.");
  } catch (error) {
    setStatus(`OCR 실패: ${error.message}`, true);
  } finally {
    if (worker) await worker.terminate();
    ocrButton.disabled = false;
  }
});
