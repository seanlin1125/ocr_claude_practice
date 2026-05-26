# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrome Extension (Manifest V3, vanilla JS / HTML / CSS, **no build step**) that lets the user drag-select an English word/phrase on any web page, runs Tesseract.js OCR locally, sends the result to the Google Gemini API for translation + part-of-speech + example sentence, and stores cards in `chrome.storage.local`. UI is in Traditional Chinese.

## Loading & iterating

- Load: `chrome://extensions` → enable Developer mode → "Load unpacked" → select this folder.
- After editing any file: hit the ⟳ reload icon on the extension card. Content-script changes also require **reloading the target tab** — old content scripts stay injected until the page reloads.
- There are no tests, no build, no lint. The repo is the deployable artifact.

## Architecture

Five JS contexts, each with a specific job. Knowing which context owns which capability is the key to navigating this code.

| Context | File | Has access to |
|---|---|---|
| Service worker | [background.js](background.js) | `chrome.tabs.captureVisibleTab`, `chrome.storage`, `fetch` to Gemini, `chrome.offscreen` |
| Content script | [content/overlay.js](content/overlay.js) | Page DOM, mouse events, shadow DOM for floating UI |
| Offscreen document | [offscreen.html](offscreen.html) + [offscreen.js](offscreen.js) | DOM APIs needed by Tesseract.js (Web Workers, WebAssembly) |
| Popup | [popup/](popup/) | Two buttons; opens list / options |
| Options + List pages | [options/](options/), [list/](list/) | Full DOM; read/write `chrome.storage.local` |

**The OCR pipeline crosses all of these.** A single user action triggers this chain:

1. User presses `Cmd/Ctrl+Shift+O` or right-clicks → handled in [background.js](background.js) → `chrome.tabs.sendMessage(tabId, { type: 'OCR_START' })`. If the content script isn't there (e.g. tab predates the extension install), background injects it via `chrome.scripting.executeScript` and retries once.
2. [content/overlay.js](content/overlay.js) draws the selection rectangle in a Shadow DOM host, hides it on `mouseup`, then asks background to `CAPTURE_TAB`.
3. Background calls `chrome.tabs.captureVisibleTab` and returns the PNG dataURL. Content script crops it on a `<canvas>` (note: `captureVisibleTab` returns device-pixel image, so the crop uses `img.width / window.innerWidth` as DPR).
4. Content script sends cropped image as `OCR_IMAGE` to background. Background ensures an offscreen document exists, forwards `OFFSCREEN_OCR` to it.
5. [offscreen.js](offscreen.js) runs Tesseract.js and returns text.
6. Content script cleans text, sends `LOOKUP_WORD` to background. Background checks `chrome.storage.local.words` for duplicates (case-insensitive trim), and only if new calls Gemini.
7. Gemini is asked for strict JSON via `responseMimeType: 'application/json'`; result is stored and returned. Content script renders the floating card (with a "已存在" badge if it was a duplicate).

All cross-context calls use `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. The background message handler always `return true` to keep the channel open for async `sendResponse`.

## Tesseract.js in MV3 — non-obvious gotchas

These are landmines that were already navigated; preserve the workarounds when touching OCR code.

- **CSP** ([manifest.json](manifest.json)): `extension_pages` CSP must include `'wasm-unsafe-eval'`, otherwise WebAssembly compilation is blocked and you'll see `CompileError: ... wasm-eval ... is not an allowed source`.
- **Blob worker** ([offscreen.js](offscreen.js)): pass `workerBlobURL: false` to `Tesseract.createWorker`. Default `true` makes Tesseract spin up a `blob:` worker that then `importScripts(workerPath)`; `blob:` → `chrome-extension://` is treated as cross-origin and gets blocked.
- **corePath** ([offscreen.js](offscreen.js)): point at the **explicit** `vendor/tesseract-core.wasm.js` file (not the directory). When `corePath` is a directory, Tesseract guesses the SIMD variant and may hit path issues. The `.js` file then loads `tesseract-core.wasm` next to it.
- **OCR runs in offscreen**, not in the content script or service worker. Content scripts can't use Web Workers reliably across all sites (CSP varies per host page); service workers can't `instantiate` WebAssembly. Offscreen documents are the only home where Tesseract works.
- All Tesseract assets are bundled in [vendor/](vendor/) and committed: `tesseract.min.js`, `worker.min.js`, `tesseract-core.wasm.js`, `tesseract-core.wasm`, `eng.traineddata.gz`. There is no CDN fetch at runtime.

## Data model

`chrome.storage.local.words` is an array of:

```
{ id, word, translation, partOfSpeech, example, exampleTranslation,
  pinned, pinnedAt, createdAt }
```

Sort order on the list page: pinned first (by `pinnedAt` desc), then by `createdAt` desc. See `sorted()` in [list/list.js](list/list.js). The list page subscribes to `chrome.storage.onChanged` so new words added from other tabs appear without a refresh.

`chrome.storage.local.geminiApiKey` holds the Gemini API key. Settings UI is [options/](options/).

## Debugging

- **Service worker logs**: `chrome://extensions` → card → "service worker" link.
- **Offscreen logs** (the important one for OCR): same extension card → "offscreen.html" link under "Inspect views". The `logger` passed to `Tesseract.createWorker` prints `[OCR] {status, progress}` lines so you can see exactly which Tesseract step hangs.
- **Content-script logs**: page DevTools console of the tab you're framing on.
- `runOcr` in [background.js](background.js) wraps the offscreen call with a 60-second timeout so hangs surface as a visible card error instead of an indefinite "辨識中...".

## When the floating card / overlay UI changes

The overlay and result card live in a single Shadow DOM host injected by [content/overlay.js](content/overlay.js). Styles are an inline `CSS_TEXT` string at the bottom of that file (Shadow DOM, so host-page styles can't leak in either direction). There is **no** `content/overlay.css` despite what older notes may say — the manifest does not reference one.
