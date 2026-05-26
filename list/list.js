const $grid = document.getElementById('grid');
const $empty = document.getElementById('empty');
const $count = document.getElementById('count');
const $search = document.getElementById('search');
const $export = document.getElementById('export');

let words = [];
let filter = '';

async function load() {
  const data = await chrome.storage.local.get('words');
  words = data.words || [];
  render();
}

function sorted(list) {
  return [...list].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    if (a.pinned && b.pinned) return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function render() {
  const f = filter.trim().toLowerCase();
  const visible = sorted(
    f
      ? words.filter(
          (w) =>
            w.word.toLowerCase().includes(f) ||
            (w.translation || '').toLowerCase().includes(f)
        )
      : words
  );

  $count.textContent = `共 ${visible.length} / ${words.length} 個單字`;
  $empty.hidden = words.length > 0;
  $grid.innerHTML = '';

  for (const w of visible) {
    const card = document.createElement('article');
    card.className = 'card' + (w.pinned ? ' pinned' : '');
    card.innerHTML = `
      <div class="head">
        <span class="word">${esc(w.word)}</span>
        ${w.partOfSpeech ? `<span class="pos">${esc(w.partOfSpeech)}</span>` : ''}
      </div>
      <div class="trans">${esc(w.translation || '')}</div>
      ${w.example ? `<div class="ex">${esc(w.example)}</div>` : ''}
      ${w.exampleTranslation ? `<div class="ex-zh">${esc(w.exampleTranslation)}</div>` : ''}
      <div class="footer">
        <span class="date">${fmtDate(w.createdAt)}</span>
        <div class="btns">
          <button class="pin ${w.pinned ? 'on' : ''}" data-id="${w.id}" title="置頂">📌</button>
          <button class="del" data-id="${w.id}" title="刪除">🗑</button>
        </div>
      </div>
    `;
    $grid.appendChild(card);
  }
}

$grid.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.classList.contains('pin')) {
    const i = words.findIndex((w) => w.id === id);
    if (i >= 0) {
      words[i].pinned = !words[i].pinned;
      words[i].pinnedAt = words[i].pinned ? Date.now() : null;
      await chrome.storage.local.set({ words });
      render();
    }
  } else if (btn.classList.contains('del')) {
    const w = words.find((x) => x.id === id);
    if (w && confirm(`刪除「${w.word}」？`)) {
      words = words.filter((x) => x.id !== id);
      await chrome.storage.local.set({ words });
      render();
    }
  }
});

$search.addEventListener('input', () => {
  filter = $search.value;
  render();
});

$export.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(words, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.words) {
    words = changes.words.newValue || [];
    render();
  }
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function fmtDate(t) {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

load();
