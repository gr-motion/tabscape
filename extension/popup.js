document.getElementById('openLoopGeneratorBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'loop-generator/index.html' });
});

document.getElementById('openTabscapeBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'tabscape/index.html' });
});