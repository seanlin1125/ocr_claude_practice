document.getElementById('open-list').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('list/list.html') });
  window.close();
});
document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
