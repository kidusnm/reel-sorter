// Checks the public GitHub repo's latest release a few times a day; installed copies can't update themselves outside the Web Store.
const REPO = 'kidusnm/reel-sorter';

const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

async function check() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' });
    if (!r.ok) return;
    const rel = await r.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const zip = rel.assets?.find(a => a.name.endsWith('.zip'))?.browser_download_url;
    const update = version && newer(version, chrome.runtime.getManifest().version)
      ? { version, zip: zip || rel.html_url, page: rel.html_url, notes: rel.body || '' }
      : null;
    await chrome.storage.local.set({ update });
    await chrome.action.setBadgeText({ text: update ? 'NEW' : '' });
  } catch {}
}

chrome.action.setBadgeBackgroundColor({ color: '#C8F542' });
chrome.action.setBadgeTextColor?.({ color: '#11130F' });
// After an update, drop the old notice even if GitHub can't be reached right now
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove('update');
  await chrome.action.setBadgeText({ text: '' });
  check();
});
chrome.runtime.onStartup.addListener(check);
chrome.alarms.get('update-check').then(a => a || chrome.alarms.create('update-check', { periodInMinutes: 360 }));
chrome.alarms.onAlarm.addListener(check);
chrome.runtime.onMessage.addListener(msg => { if (msg?.type === 'check-update') check(); });
