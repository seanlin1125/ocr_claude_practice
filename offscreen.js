// offscreen.js — runs Tesseract.js inside an offscreen DOM document.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'OFFSCREEN_OCR') return;
  (async () => {
    try {
      if (typeof Tesseract === 'undefined') {
        throw new Error(
          '找不到 Tesseract.js。請下載 tesseract.min.js / worker.min.js / tesseract-core.wasm.js / eng.traineddata.gz 放入 vendor/ 後重新載入擴充功能。'
        );
      }
      const workerPath = chrome.runtime.getURL('vendor/worker.min.js');
      const corePath = chrome.runtime.getURL('vendor/');
      const langPath = chrome.runtime.getURL('vendor/');

      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath,
        corePath,
        langPath,
        cacheMethod: 'none'
      });
      const { data } = await worker.recognize(msg.dataUrl);
      await worker.terminate();
      sendResponse({ ok: true, text: (data?.text || '').trim() });
    } catch (err) {
      console.error('[OCR offscreen]', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});
