const scanButton = document.querySelector("#scan");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const ocrButton = document.querySelector("#ocr");
const progressBox = document.querySelector("#progress");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const progressValue = document.querySelector("#progressValue");
let extracted = null;

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
