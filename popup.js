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
const DEFAULT_DATA_SOURCE_ID = "993d726e-f27e-4c40-a843-eb6ac21ac311";

async function loadNotionSettings() {
  const saved = await chrome.storage.local.get(["notionToken", "notionDataSourceId"]);
  notionToken.value = saved.notionToken || "";
  dataSourceId.value = saved.notionDataSourceId || DEFAULT_DATA_SOURCE_ID;
}

async function persistNotionSettings() {
  const token = notionToken.value.trim();
  const sourceId = dataSourceId.value.trim();
  if (!token) throw new Error("Notion 액세스 토큰을 입력해 주세요.");
  if (!sourceId) throw new Error("데이터 소스 ID를 입력해 주세요.");
  await chrome.storage.local.set({ notionToken: token, notionDataSourceId: sourceId });
}

loadNotionSettings();

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
