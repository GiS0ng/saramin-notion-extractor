chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "OFFSCREEN_OCR") return false;
  (async () => {
    const worker = await Tesseract.createWorker(["kor", "eng"], 1, {
      workerPath: chrome.runtime.getURL("ocr/worker.min.js"),
      langPath: chrome.runtime.getURL("ocr/lang"),
      corePath: chrome.runtime.getURL("ocr/core"),
      workerBlobURL: false
    });
    try {
      const texts = [];
      for (const imageUrl of message.imageUrls || []) {
        const result = await worker.recognize(imageUrl);
        if (result.data.text?.trim()) texts.push(result.data.text.trim());
      }
      return { ok: true, text: texts.join("\n\n") };
    } finally {
      await worker.terminate();
    }
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
