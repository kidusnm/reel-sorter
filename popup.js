const $ = id => document.getElementById(id);
let tabId;

function show(s) {
  $('reels').hidden = !s?.onReels;
  $('site').hidden = !s || s.onReels;
  $('other').hidden = !!s;
  if (!s?.onReels) return;
  $('acct').textContent = s.account;
  $('count').textContent = s.count.toLocaleString('en-US');
  $('statusText').textContent = s.loading ? 'Loading…' : s.status || 'Ready';
  $('status').className = 'status ' + (s.loading ? 'loading' : s.status === 'All reels loaded' ? 'done' : '');
  $('load').textContent = s.loading ? 'Stop loading' : 'Load all reels';
}

async function send(type) {
  try {
    show(await chrome.tabs.sendMessage(tabId, { type }));
  } catch {
    show(null);
  }
}

$('ver').textContent = chrome.runtime.getManifest().version;
function showUpdate(update) {
  $('update').hidden = !update;
  if (!update) return;
  $('updTitle').textContent = `Version ${update.version} is out`;
  $('updGet').onclick = () => chrome.tabs.create({ url: update.zip });
}
$('updExt').onclick = () => chrome.tabs.create({ url: 'chrome://extensions' });
chrome.storage.local.get('update').then(r => showUpdate(r.update));
chrome.storage.onChanged.addListener(c => { if (c.update) showUpdate(c.update.newValue); });
chrome.runtime.sendMessage({ type: 'check-update' });

$('load').addEventListener('click', () => send('load'));
$('grid').addEventListener('click', () => send('grid').then(() => window.close()));

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab?.id;
  send('status');
  setInterval(() => send('status'), 1000);
});
