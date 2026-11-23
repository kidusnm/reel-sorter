(() => {
  const SRC = 'reel-sorter';
  const IG_APP_ID = '936619743392459';
  const SHORTCODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const IS_IG = location.hostname.includes('instagram.com');
  const items = new Map();
  const pages = [];
  const state = { loading: false, status: '', sort: null, open: false, min: false, profileKey: '' };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const profile = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    const params = new URLSearchParams(location.search);
    if (IS_IG) return parts.length === 2 && parts[1] === 'reels' ? { platform: 'instagram', slug: parts[0].toLowerCase() } : null;
    if (parts[parts.length - 1] === 'reels' && parts.length === 2) return { platform: 'facebook', slug: parts[0].toLowerCase() };
    if (params.get('sk') === 'reels_tab') {
      const id = params.get('id') || parts.find(p => /^\d+$/.test(p)) || '';
      return { platform: 'facebook', slug: parts[0] === 'profile.php' ? '' : (parts[0] || '').toLowerCase(), id };
    }
    return null;
  };
  const profileKey = p => (p ? `${p.platform}:${p.slug}:${p.id || ''}` : '');

  const belongs = (it, p) => {
    if (it.platform !== p.platform) return false;
    if (p.platform === 'instagram') return it.owner === p.slug;
    return (p.slug && it.owner.slug === p.slug) || (p.id && it.owner.id === p.id);
  };

  const current = () => {
    const p = profile();
    return p ? [...items.values()].filter(it => belongs(it, p)) : [];
  };

  const sorted = () => current().sort((a, b) => {
    const av = a.views ?? -1, bv = b.views ?? -1;
    return state.sort === 'asc' ? av - bv : bv - av;
  });

  const accountName = () => {
    const p = profile();
    if (!p) return '';
    if (p.slug) return '@' + p.slug;
    return current()[0]?.owner?.name || 'this page';
  };

  window.addEventListener('message', e => {
    if (e.source !== window || e.data?.src !== SRC) return;
    for (const it of e.data.items) {
      const key = it.platform + ':' + it.id;
      const prev = items.get(key);
      items.set(key, prev ? { ...prev, ...it, video: it.video || prev.video, thumb: it.thumb || prev.thumb } : it);
    }
    if (e.data.hasNext !== undefined && e.data.items.length) pages.push({ it: e.data.items[0], hasNext: e.data.hasNext });
    scheduleRender();
  });
  window.postMessage({ src: SRC + '-replay' }, location.origin);

  const hasNext = () => {
    const p = profile();
    for (let i = pages.length - 1; i >= 0; i--) if (p && belongs(pages[i].it, p)) return pages[i].hasNext;
  };

  // Auto-scroll at a human pace; stops at the end of the tab, after repeated empty scrolls, or on Stop.
  async function loadAll() {
    state.loading = true;
    state.status = 'Loading…';
    render();
    let misses = 0;
    let done = false;
    while (state.loading && profile()) {
      const before = current().length;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(2200 + Math.random() * 2200);
      if (current().length > before) misses = 0; else misses++;
      if ((hasNext() === false && misses >= 1) || misses >= 6) {
        done = true;
        break;
      }
    }
    state.status = done ? 'All reels loaded' : 'Stopped';
    state.loading = false;
    render();
  }

  const toggleLoad = () => {
    if (state.loading) state.loading = false;
    else loadAll();
    render();
  };

  // --- Downloads ---

  const dateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const clean = s => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');

  const codeToPk = code => {
    let n = 0n;
    for (const ch of code) n = n * 64n + BigInt(SHORTCODE.indexOf(ch));
    return n.toString();
  };

  // Instagram: one info request per click, since grid data carries no video URL. Never prefetched.
  async function resolve(ref) {
    if (ref.platform === 'facebook') {
      const it = items.get('facebook:' + ref.code);
      if (!it?.video) throw new Error('Open this page’s Reels tab and refresh, then try again');
      const creator = it.owner.slug && it.owner.slug !== 'profile.php' ? it.owner.slug : clean(it.owner.name) || it.owner.id;
      return { url: it.video, name: `facebook-${clean(creator)}-${it.code}-${dateStr()}.mp4` };
    }
    const pk = [...items.values()].find(it => it.platform === 'instagram' && it.code === ref.code)?.id || codeToPk(ref.code);
    const r = await fetch(`/api/v1/media/${pk}/info/`, { headers: { 'X-IG-App-ID': IG_APP_ID }, credentials: 'include' });
    if (!r.ok) throw new Error('Instagram returned ' + r.status);
    const media = (await r.json()).items?.[0];
    const url = (media?.video_versions || []).sort((a, b) => b.width * b.height - a.width * a.height)[0]?.url;
    if (!url) throw new Error('This post has no video');
    return { url, name: `instagram-${clean(media.user?.username)}-${ref.code}-${dateStr()}.mp4` };
  }

  const busy = new Set();
  async function download(ref, btn) {
    if (busy.has(ref.code)) return;
    busy.add(ref.code);
    setBtn(btn, 'busy', 'Saving…');
    try {
      const { url, name } = await resolve(ref);
      const r = await fetch(url);
      if (!r.ok) throw new Error('Video request failed (' + r.status + ')');
      const blobUrl = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      setBtn(btn, 'done', 'Saved');
    } catch (err) {
      setBtn(btn, 'fail', 'Failed');
      btn.title = String(err.message || err);
    }
    busy.delete(ref.code);
  }

  // --- UI ---

  const ICON = {
    logo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#1B1E25"/><rect x="5" y="5.5" width="14" height="3" rx="1.5" fill="#C8F542"/><rect x="5" y="10.5" width="10" height="3" rx="1.5" fill="#C8F542" opacity=".8"/><rect x="5" y="15.5" width="6" height="3" rx="1.5" fill="#C8F542" opacity=".6"/><path d="M14 15v5.2a.8.8 0 0 0 1.2.7l4.4-2.6a.8.8 0 0 0 0-1.4l-4.4-2.6a.8.8 0 0 0-1.2.7z" fill="#fff"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
    svg { width: 100%; height: 100%; display: block; }
    button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; }
    :host { --bg: #121417; --bg2: #1B1E25; --bg3: #252932; --line: #2A2E37; --text: #F4F5F7; --muted: #8F96A3; --accent: #C8F542; --ink: #11130F; --bad: #FF6B6B; }

    .panel { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 236px; padding: 14px; color: var(--text);
      background: var(--bg); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 18px 48px rgba(0,0,0,.45); font-size: 13px; }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .logo { width: 22px; height: 22px; flex: none; }
    .name { font-weight: 700; font-size: 14px; letter-spacing: -.01em; flex: 1; }
    .iconbtn { width: 26px; height: 26px; padding: 5px; border-radius: 8px; color: var(--muted); }
    .iconbtn:hover { background: var(--bg3); color: var(--text); }
    .stat { display: flex; align-items: baseline; gap: 6px; }
    .num { font-size: 30px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .lbl { color: var(--muted); }
    .status { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; min-height: 16px; margin: 2px 0 14px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
    .loading .dot { background: var(--accent); animation: pulse 1s ease-in-out infinite; }
    .done .dot { background: var(--accent); }
    @keyframes pulse { 50% { opacity: .25; } }
    .btn { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; height: 36px; border-radius: 10px;
      font-weight: 600; font-size: 13px; background: var(--bg2); border: 1px solid var(--line); }
    .btn:hover { background: var(--bg3); }
    .btn.primary { background: var(--accent); color: var(--ink); border-color: transparent; }
    .btn.primary:hover { filter: brightness(1.06); }
    .btn .i { width: 15px; height: 15px; }
    .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; margin: 8px 0; background: var(--bg2); border: 1px solid var(--line); border-radius: 10px; }
    .seg button { height: 28px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--muted); }
    .seg button.on { background: var(--bg3); color: var(--text); }

    .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 8px; height: 40px;
      padding: 0 14px 0 9px; border-radius: 20px; background: var(--bg); border: 1px solid var(--line); color: var(--text);
      font-weight: 700; font-size: 13px; box-shadow: 0 12px 32px rgba(0,0,0,.4); font-variant-numeric: tabular-nums; }
    .pill .logo { width: 22px; height: 22px; }
    .pill .new { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
    .update { display: flex; align-items: center; gap: 8px; width: 100%; margin: -2px 0 12px; padding: 8px 10px; border-radius: 10px;
      background: rgba(200,245,66,.1); border: 1px solid rgba(200,245,66,.35); color: var(--accent); font-size: 12px; font-weight: 600; text-align: left; }
    .update:hover { background: rgba(200,245,66,.16); }
    .update .i { width: 14px; height: 14px; flex: none; }

    .overlay { position: fixed; inset: 0; z-index: 2147483646; background: #0B0C0F; overflow-y: auto; color: var(--text); }
    .bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 14px; padding: 12px 20px;
      background: rgba(11,12,15,.88); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    .bar .title { flex: 1; min-width: 0; }
    .bar .acct { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar .sub { color: var(--muted); font-size: 12px; margin-top: 1px; }
    .bar .seg { margin: 0; width: 220px; }
    .bar .btn { width: auto; padding: 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 10px; padding: 16px 20px 40px; }
    .tile { position: relative; display: block; color: var(--text); aspect-ratio: 9 / 16; background: var(--bg2); border-radius: 12px; overflow: hidden; }
    .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .2s; }
    .tile:hover img { transform: scale(1.03); }
    .tile::after { content: ""; position: absolute; inset: 55% 0 0; background: linear-gradient(transparent, rgba(0,0,0,.7)); pointer-events: none; }
    .views { position: absolute; left: 10px; bottom: 9px; z-index: 1; display: flex; align-items: center; gap: 5px; font-weight: 700; font-size: 14px;
      text-shadow: 0 1px 3px rgba(0,0,0,.6); font-variant-numeric: tabular-nums; }
    .views .i { width: 12px; height: 12px; }
    .rank { position: absolute; left: 8px; top: 8px; z-index: 1; min-width: 26px; height: 22px; padding: 0 7px; border-radius: 11px;
      background: rgba(0,0,0,.6); font-size: 11px; font-weight: 700; display: grid; place-items: center; }
    .rank.top { background: var(--accent); color: var(--ink); }
    .grid.inline { padding: 0; color: var(--text); }
    .inline .tile { aspect-ratio: auto; height: 100%; border-radius: var(--r); }
    .empty { color: var(--muted); padding: 80px 20px; text-align: center; grid-column: 1 / -1; }

    .dl { position: absolute; right: 8px; top: 8px; z-index: 3; display: none; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 9px;
      border-radius: 15px; background: rgba(18,20,23,.92); color: var(--text); font-size: 12px; font-weight: 700;
      box-shadow: 0 4px 14px rgba(0,0,0,.35); backdrop-filter: blur(6px); }
    .dl .i { width: 14px; height: 14px; color: var(--accent); }
    .dl:hover { background: var(--accent); color: var(--ink); }
    .dl:hover .i { color: var(--ink); }
    .tile:hover .dl, .dl.show, .dl.busy, .dl.done, .dl.fail { display: flex; }
    .dl.busy .i { animation: pulse 1s ease-in-out infinite; }
    .dl.fail .i { color: var(--bad); }
  `;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);

  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html) el.innerHTML = html;
    return el;
  };
  const icon = name => h('span', 'i', ICON[name]);

  const dlButton = ref => {
    const b = h('button', 'dl');
    b.append(icon('down'), document.createTextNode('Download'));
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); download(ref, b); });
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'pointerup']) b.addEventListener(t, e => e.stopPropagation());
    return b;
  };
  function setBtn(b, cls, label) {
    b.className = 'dl ' + cls;
    b.replaceChildren(icon(cls === 'done' ? 'check' : cls === 'fail' ? 'x' : 'down'), document.createTextNode(label));
    if (cls !== 'busy') setTimeout(() => { if (b.classList.contains(cls)) { b.className = 'dl'; b.replaceChildren(icon('down'), document.createTextNode('Download')); b.title = ''; } }, 4000);
  }

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [sheet];
  const panel = h('div');
  const overlay = h('div', 'overlay');
  const bar = h('div', 'bar');
  const grid = h('div', 'grid');
  overlay.append(bar, grid);
  root.append(overlay, panel);
  document.documentElement.appendChild(host);

  const button = (cls, children, onClick) => {
    const b = h('button', cls);
    b.append(...children);
    b.addEventListener('click', onClick);
    return b;
  };
  const text = (tag, cls, s) => { const el = h(tag, cls); el.textContent = s; return el; };

  // On the page, pressing the active order again brings back the site's own order.
  function setSort(order) {
    state.sort = !state.open && state.sort === order ? null : order;
    render();
    if (!state.open && state.sort && !state.loading && cover.isConnected) {
      const top = cover.getBoundingClientRect().top;
      if (top < 0) window.scrollBy(0, top - 80);
    }
  }

  const sortSeg = () => {
    const seg = h('div', 'seg');
    seg.append(
      button(state.sort === 'desc' || (state.open && !state.sort) ? 'on' : '', ['Most views'], () => setSort('desc')),
      button(state.sort === 'asc' ? 'on' : '', ['Least views'], () => setSort('asc')),
    );
    return seg;
  };
  const loadBtn = cls => button(cls, state.loading ? ['Stop loading'] : [icon('play'), 'Load all reels'], toggleLoad);
  const statusCls = () => (state.loading ? 'loading' : state.status === 'All reels loaded' ? 'done' : '');

  function renderPanel() {
    panel.replaceChildren();
    panel.className = '';
    if (state.open) return;
    const n = current().length;
    if (state.min) {
      panel.append(button('pill', [h('span', 'logo', ICON.logo), `${n} reels`, ...(state.update ? [h('span', 'new')] : [])], () => { state.min = false; render(); }));
      return;
    }
    const box = h('div', 'panel ' + statusCls());
    const head = h('div', 'head');
    head.append(h('span', 'logo', ICON.logo), text('span', 'name', 'Reel Sorter'),
      button('iconbtn', [h('span', '', ICON.minus)], () => { state.min = true; render(); }));
    const stat = h('div', 'stat');
    stat.append(text('span', 'num', n.toLocaleString('en-US')), text('span', 'lbl', n === 1 ? 'reel loaded' : 'reels loaded'));
    const status = h('div', 'status');
    status.append(h('span', 'dot'), document.createTextNode(state.status || 'Scroll or press Load all'));
    if (state.update) box.append(button('update', [icon('down'), `Update ${state.update.version} available · Get it`], () => window.open(state.update.page, '_blank')));
    box.append(head, stat, status, loadBtn('btn primary'), sortSeg(),
      button('btn', [icon('grid'), 'Open sorted grid'], () => { state.open = true; render(); }));
    panel.append(box);
  }

  function renderBar() {
    const n = current().length;
    const title = h('div', 'title');
    title.append(text('div', 'acct', accountName()),
      text('div', 'sub', `${n.toLocaleString('en-US')} reels · ${state.loading ? 'loading…' : state.status || 'sorted by views'}`));
    bar.replaceChildren(h('span', 'logo', ICON.logo), title, sortSeg(), loadBtn('btn'),
      button('iconbtn', [h('span', '', ICON.x)], () => { state.open = false; render(); }));
  }

  const tile = (it, i) => {
    const a = h('a', 'tile');
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener';
    if (it.thumb) { const img = h('img'); img.src = it.thumb; img.loading = 'lazy'; a.append(img); }
    const views = h('span', 'views');
    views.append(icon('play'), document.createTextNode(it.viewsText || (it.views == null ? '—' : it.views.toLocaleString('en-US'))));
    a.append(text('span', 'rank' + (i < 3 && state.sort !== 'asc' ? ' top' : ''), '#' + (i + 1)), views, dlButton({ platform: it.platform, code: it.code }));
    return a;
  };

  function renderGrid() {
    overlay.style.display = state.open ? 'block' : 'none';
    if (!state.open) return;
    renderBar();
    const list = sorted();
    if (!list.length) {
      grid.replaceChildren(text('div', 'empty', 'No reels captured yet. Press Load all reels.'));
      return;
    }
    grid.replaceChildren(...list.map(tile));
  }

  // --- Sorting the site's own Reels tab ---

  // Instagram keeps only on-screen rows in the DOM and both sites are React, so their tiles are never moved:
  // a sorted copy covers the grid while the originals stay laid out underneath and keep loading.
  const cover = document.createElement('div');
  const coverRoot = cover.attachShadow({ mode: 'open' });
  coverRoot.adoptedStyleSheets = [sheet];
  const inline = h('div', 'grid inline');
  coverRoot.append(inline);
  let box = null;
  let drawn = '';

  function measure() {
    const codes = new Set(current().map(it => it.code));
    const tiles = [...document.querySelectorAll('a[data-rs]')].filter(a => codes.has(tileRef(a)?.code));
    if (!tiles.length) return null;
    let el = box?.isConnected && box.contains(tiles[0]) ? box : tiles[0].parentElement;
    while (!tiles.every(t => el.contains(t))) el = el.parentElement;
    const rects = tiles.map(t => t.getBoundingClientRect()).filter(r => r.width).sort((a, b) => a.top - b.top || a.left - b.left);
    if (!rects.length) return null;
    const first = rects[0];
    const lefts = [...new Set(rects.map(r => Math.round(r.left)))].sort((x, y) => x - y);
    const next = rects.find(r => r.top > first.bottom - 4);
    const gap = lefts.length > 1 ? Math.max(0, (lefts.at(-1) - lefts[0]) / (lefts.length - 1) - first.width) : 0;
    const outer = el.getBoundingClientRect();
    return {
      el, cols: lefts.length, w: first.width, h: first.height, gap,
      gapY: next ? next.top - first.bottom : gap,
      left: Math.min(...rects.map(r => r.left)) - outer.left,
      top: first.top - outer.top - parseFloat(getComputedStyle(el).paddingTop),
    };
  }

  function clearInline() {
    cover.remove();
    if (box) box.style.minHeight = box.style.isolation = box.style.boxSizing = '';
    box = null;
    drawn = '';
  }

  const pageColor = el => {
    for (; el; el = el.parentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (c !== 'transparent' && !/, 0\)$/.test(c)) return c;
    }
    return '#000';
  };

  function renderInline() {
    if (!state.sort || !profile()) { clearInline(); return; }
    const m = measure();
    if (!m) return;
    const list = sorted();
    const sig = [state.sort, m.cols, Math.round(m.w), Math.round(m.h), Math.round(m.left), Math.round(m.top), ...list.map(it => it.code + ':' + it.views)].join();
    if (m.el === box && cover.parentElement === box && sig === drawn) return;
    if (m.el !== box) clearInline();
    box = m.el;
    drawn = sig;
    const px = n => n + 'px';
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    box.style.isolation = 'isolate';
    box.style.boxSizing = 'border-box';
    cover.style.cssText = `position:absolute;display:block;box-sizing:border-box;left:0;top:0;width:100%;min-height:100%;z-index:10;padding:${px(m.top)} 0 0 ${px(m.left)};background:${pageColor(box)}`;
    inline.style.cssText = `grid-template-columns:repeat(${m.cols},${px(m.w)});grid-auto-rows:${px(m.h)};gap:${px(m.gapY)} ${px(m.gap)}`;
    inline.style.setProperty('--r', IS_IG ? '0' : '8px');
    inline.replaceChildren(...list.map(tile));
    if (cover.parentElement !== box) box.append(cover);
    box.style.minHeight = px(inline.offsetHeight + m.top);
  }

  function render() {
    host.style.display = profile() ? 'block' : 'none';
    renderPanel();
    renderGrid();
    renderInline();
  }

  let timer = 0;
  // Rebuilding the grid mid-download would drop that button's state, so only the counters refresh then.
  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!profile()) return;
      if (busy.size && (state.open || state.sort)) { renderPanel(); renderBar(); } else render();
    }, 400);
  }

  // --- Download buttons on the site's own tiles ---

  const tileRef = a => {
    const href = a.getAttribute('href') || '';
    if (IS_IG) {
      const m = href.match(/\/(reels?|p)\/([A-Za-z0-9_-]{8,})/);
      // Posts grid: /p/ links are photos unless the tile carries a video badge
      if (!m || (m[1] === 'p' && !a.querySelector('svg[aria-label*="Clip" i], svg[aria-label*="Video" i], svg[aria-label*="Reel" i]'))) return null;
      return { platform: 'instagram', code: m[2] };
    }
    const m = href.match(/\/reel\/(\d+)/);
    return m && { platform: 'facebook', code: m[1] };
  };

  function decorateTiles() {
    for (const a of document.querySelectorAll('a[href*="/reel"]:not([data-rs]), a[href*="/p/"]:not([data-rs])')) {
      const ref = tileRef(a);
      const box = a.getBoundingClientRect();
      // Reels-tab tiles paint the cover as a CSS background, not an <img>
      if (!ref || box.width < 90 || box.height < 90) continue;
      a.dataset.rs = '1';
      if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
      const tileHost = document.createElement('span');
      tileHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
      const sr = tileHost.attachShadow({ mode: 'open' });
      sr.adoptedStyleSheets = [sheet];
      const btn = dlButton(ref);
      btn.style.pointerEvents = 'auto';
      sr.append(btn);
      a.append(tileHost);
      a.addEventListener('mouseenter', () => btn.classList.add('show'));
      a.addEventListener('mouseleave', () => btn.classList.remove('show'));
    }
  }

  let tileTimer = 0;
  new MutationObserver(() => {
    clearTimeout(tileTimer);
    tileTimer = setTimeout(() => { decorateTiles(); if (state.sort && !busy.size) renderInline(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('resize', scheduleRender);

  // --- Toolbar popup ---

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'load' && profile()) toggleLoad();
    if (msg?.type === 'grid' && profile()) { state.open = true; state.min = false; render(); }
    const p = profile();
    reply({
      platform: IS_IG ? 'instagram' : 'facebook',
      onReels: !!p,
      account: accountName(),
      count: current().length,
      loading: state.loading,
      status: state.status,
    });
  });

  setInterval(() => {
    const key = profileKey(profile());
    if (key !== state.profileKey) {
      state.profileKey = key;
      state.loading = false;
      state.status = '';
      state.sort = null;
      state.open = false;
      render();
    }
  }, 1000);

  chrome.storage.local.get('update').then(r => { state.update = r.update; render(); });
  chrome.storage.onChanged.addListener(c => { if (c.update) { state.update = c.update.newValue; render(); } });

  state.profileKey = profileKey(profile());
  render();
  decorateTiles();
})();
