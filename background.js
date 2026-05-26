// background.js — service worker

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ocr-start',
    title: '用 OCR 選取單字',
    contexts: ['page', 'selection', 'image']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ocr-start' && tab?.id != null) {
    triggerOcr(tab.id);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'start-ocr') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id != null) triggerOcr(tab.id);
  });
});

async function triggerOcr(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'OCR_START' });
  } catch (e) {
    // Content script not injected yet (e.g. chrome:// pages); inject and retry once.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/overlay.js']
      });
      await chrome.tabs.sendMessage(tabId, { type: 'OCR_START' });
    } catch (err) {
      console.warn('[OCR] cannot start on this tab:', err);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'CAPTURE_TAB') {
        const windowId = sender.tab?.windowId;
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        sendResponse({ ok: true, dataUrl });
        return;
      }
      if (msg.type === 'OCR_IMAGE') {
        const text = await runOcr(msg.dataUrl);
        sendResponse({ ok: true, text });
        return;
      }
      if (msg.type === 'LOOKUP_WORD') {
        const result = await lookupWord(msg.query);
        sendResponse({ ok: true, ...result });
        return;
      }
      if (msg.type === 'GEMINI_TEST') {
        await callGemini(msg.apiKey, 'hello');
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      console.error('[OCR bg]', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async
});

// ---- OCR via offscreen document ----

let creatingOffscreen;
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Run Tesseract.js OCR in a DOM context.'
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function runOcr(dataUrl) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_OCR', dataUrl });
  if (!res?.ok) throw new Error(res?.error || 'OCR 失敗');
  return res.text;
}

// ---- Gemini lookup + storage ----

async function lookupWord(rawQuery) {
  const query = (rawQuery || '').trim();
  if (!query) throw new Error('未辨識到文字');

  const { words = [] } = await chrome.storage.local.get('words');
  const existing = words.find((w) => w.word.toLowerCase() === query.toLowerCase());
  if (existing) return { duplicate: true, entry: existing };

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey) throw new Error('尚未設定 Gemini API Key，請至設定頁輸入。');

  const entry = await callGemini(geminiApiKey, query);
  entry.id = crypto.randomUUID();
  entry.pinned = false;
  entry.createdAt = Date.now();

  const updated = [entry, ...words];
  await chrome.storage.local.set({ words: updated });
  return { duplicate: false, entry };
}

async function callGemini(apiKey, query) {
  const prompt =
    'You are an English-Chinese vocabulary assistant.\n' +
    'Return ONLY JSON with keys: word, translation, partOfSpeech, example, exampleTranslation.\n' +
    '- word: the original English word/phrase, lowercased and trimmed\n' +
    '- translation: concise Traditional Chinese translation\n' +
    '- partOfSpeech: 詞性 in Traditional Chinese (名詞/動詞/形容詞/副詞/片語...)\n' +
    '- example: one short natural English sentence using the word\n' +
    '- exampleTranslation: Traditional Chinese translation of that example\n' +
    `Input: "${query}"`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.4
    }
  };

  const res = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 回傳格式不正確');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Gemini 未回傳 JSON');
    parsed = JSON.parse(m[0]);
  }
  return {
    word: String(parsed.word || query).trim(),
    translation: String(parsed.translation || '').trim(),
    partOfSpeech: String(parsed.partOfSpeech || '').trim(),
    example: String(parsed.example || '').trim(),
    exampleTranslation: String(parsed.exampleTranslation || '').trim()
  };
}
