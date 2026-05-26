// content/overlay.js — selection UI + floating result card

(() => {
  if (window.__ocrOverlayInjected) return;
  window.__ocrOverlayInjected = true;

  let host = null;       // shadow host element on page
  let shadow = null;
  let state = 'idle';    // 'idle' | 'selecting' | 'processing'
  let startX = 0, startY = 0;
  let rectEl = null;
  let dimEl = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'OCR_START') startSelection();
  });

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__ocr_host__';
    Object.assign(host.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none'
    });
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function startSelection() {
    if (state !== 'idle') return;
    ensureHost();
    state = 'selecting';

    dimEl = document.createElement('div');
    dimEl.className = 'dim';
    dimEl.style.pointerEvents = 'auto';
    dimEl.style.cursor = 'crosshair';
    shadow.appendChild(dimEl);

    rectEl = document.createElement('div');
    rectEl.className = 'rect';
    shadow.appendChild(rectEl);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '拖曳框選英文單字 — Esc 取消';
    shadow.appendChild(hint);

    dimEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function cleanupSelection() {
    if (!shadow) return;
    shadow.querySelectorAll('.dim, .rect, .hint').forEach((n) => n.remove());
    rectEl = null;
    dimEl = null;
    window.removeEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      cancelAll();
    }
  }

  function cancelAll() {
    cleanupSelection();
    shadow?.querySelectorAll('.card').forEach((n) => n.remove());
    state = 'idle';
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    rectEl.style.left = startX + 'px';
    rectEl.style.top = startY + 'px';
    rectEl.style.width = '0px';
    rectEl.style.height = '0px';
    rectEl.style.display = 'block';
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseMove(e) {
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    rectEl.style.left = x + 'px';
    rectEl.style.top = y + 'px';
    rectEl.style.width = w + 'px';
    rectEl.style.height = h + 'px';
  }

  async function onMouseUp(e) {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 8 || h < 8) {
      cancelAll();
      return;
    }

    state = 'processing';
    // hide overlay before capture
    if (dimEl) dimEl.style.display = 'none';
    if (rectEl) rectEl.style.display = 'none';
    shadow.querySelectorAll('.hint').forEach((n) => n.remove());

    // small delay to allow paint
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const card = showCard({ loading: true, anchor: { x, y, w, h } });

    try {
      const cap = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' });
      if (!cap?.ok) throw new Error(cap?.error || '截圖失敗');

      const cropDataUrl = await cropImage(cap.dataUrl, x, y, w, h);
      const ocr = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', dataUrl: cropDataUrl });
      if (!ocr?.ok) throw new Error(ocr?.error || 'OCR 失敗');

      const query = cleanText(ocr.text);
      if (!query) throw new Error('未辨識到文字');

      const lookup = await chrome.runtime.sendMessage({ type: 'LOOKUP_WORD', query });
      if (!lookup?.ok) throw new Error(lookup?.error || '查詢失敗');

      renderCard(card, { entry: lookup.entry, duplicate: lookup.duplicate });
    } catch (err) {
      renderCard(card, { error: String(err?.message || err) });
    } finally {
      cleanupSelection();
      state = 'idle';
    }
  }

  function cleanText(s) {
    return (s || '')
      .replace(/[^A-Za-z'\- ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  async function cropImage(dataUrl, x, y, w, h) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const dpr = img.width / window.innerWidth; // captureVisibleTab is at device pixel ratio
    const sx = Math.round(x * dpr);
    const sy = Math.round(y * dpr);
    const sw = Math.round(w * dpr);
    const sh = Math.round(h * dpr);
    const canvas = document.createElement('canvas');
    // upscale slightly for better OCR on small text
    const scale = sw < 400 ? 2 : 1;
    canvas.width = sw * scale;
    canvas.height = sh * scale;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  function showCard({ loading, anchor }) {
    ensureHost();
    const card = document.createElement('div');
    card.className = 'card';
    card.style.pointerEvents = 'auto';
    // position card near selection
    const margin = 8;
    const cardW = 320;
    let left = anchor.x + anchor.w + margin;
    if (left + cardW > window.innerWidth) left = Math.max(margin, anchor.x - cardW - margin);
    let top = anchor.y;
    if (top + 200 > window.innerHeight) top = Math.max(margin, window.innerHeight - 220);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.innerHTML = `
      <button class="close" title="關閉">×</button>
      <div class="body">
        <div class="loading">辨識中…</div>
      </div>`;
    card.querySelector('.close').addEventListener('click', () => card.remove());
    shadow.appendChild(card);
    return card;
  }

  function renderCard(card, { entry, duplicate, error }) {
    const body = card.querySelector('.body');
    if (error) {
      body.innerHTML = `<div class="err">${escapeHtml(error)}</div>`;
      return;
    }
    const dupBadge = duplicate ? `<div class="dup">📚 已存在於單字本</div>` : '';
    body.innerHTML = `
      ${dupBadge}
      <div class="word">${escapeHtml(entry.word)} <span class="pos">${escapeHtml(entry.partOfSpeech || '')}</span></div>
      <div class="trans">${escapeHtml(entry.translation || '')}</div>
      <div class="ex">${escapeHtml(entry.example || '')}</div>
      <div class="ex-zh">${escapeHtml(entry.exampleTranslation || '')}</div>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const CSS_TEXT = `
    .dim { position: fixed; inset: 0; background: rgba(0,0,0,0.25); }
    .rect { position: fixed; border: 2px solid #4f8cff; background: rgba(79,140,255,0.15); pointer-events: none; display: none; }
    .hint {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.75); color: #fff; padding: 6px 12px; border-radius: 6px;
      font: 13px/1.4 system-ui, -apple-system, sans-serif; pointer-events: none;
    }
    .card {
      position: fixed; width: 320px; max-width: 90vw; background: #fff; color: #222;
      border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,0.25);
      font: 14px/1.5 system-ui, -apple-system, "Noto Sans TC", sans-serif;
      padding: 12px 14px 14px; z-index: 2147483647;
    }
    .card .close {
      position: absolute; top: 4px; right: 6px; border: none; background: transparent;
      font-size: 20px; line-height: 1; color: #888; cursor: pointer;
    }
    .card .close:hover { color: #222; }
    .card .loading, .card .err { color: #666; padding: 8px 0; }
    .card .err { color: #c0392b; }
    .card .dup { font-size: 12px; color: #b8860b; margin-bottom: 6px; }
    .card .word { font-size: 18px; font-weight: 600; margin-bottom: 2px; }
    .card .pos { font-size: 12px; color: #888; font-weight: normal; margin-left: 6px; }
    .card .trans { font-size: 15px; color: #2c3e50; margin-bottom: 8px; }
    .card .ex { font-size: 13px; color: #333; font-style: italic; margin-top: 6px; }
    .card .ex-zh { font-size: 13px; color: #666; margin-top: 2px; }
  `;
})();
