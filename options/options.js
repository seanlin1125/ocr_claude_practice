const $key = document.getElementById('api-key');
const $save = document.getElementById('save');
const $test = document.getElementById('test');
const $toggle = document.getElementById('toggle-vis');
const $status = document.getElementById('status');

(async () => {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (geminiApiKey) $key.value = geminiApiKey;
})();

$save.addEventListener('click', async () => {
  const key = $key.value.trim();
  await chrome.storage.local.set({ geminiApiKey: key });
  setStatus('已儲存。', 'ok');
});

$test.addEventListener('click', async () => {
  const key = $key.value.trim();
  if (!key) return setStatus('請先輸入 API Key。', 'err');
  setStatus('測試中…', '');
  const res = await chrome.runtime.sendMessage({ type: 'GEMINI_TEST', apiKey: key });
  if (res?.ok) setStatus('✅ 連線成功！', 'ok');
  else setStatus('❌ ' + (res?.error || '失敗'), 'err');
});

$toggle.addEventListener('click', () => {
  const next = $key.type === 'password' ? 'text' : 'password';
  $key.type = next;
  $toggle.textContent = next === 'password' ? '顯示' : '隱藏';
});

function setStatus(text, cls) {
  $status.textContent = text;
  $status.className = 'status ' + (cls || '');
}
