// Runs in the page's world: reads the reel data Instagram/Facebook already fetch, never requests anything itself.
(() => {
  const SRC = 'reel-sorter';
  const buffer = [];

  const send = (items, hasNext) => {
    if (!items.length && hasNext === undefined) return;
    const msg = { src: SRC, items, hasNext };
    buffer.push(msg);
    window.postMessage(msg, location.origin);
  };

  const parseCount = s => {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || '').toUpperCase()] || 1));
  };

  const igItem = o => {
    if (!o.code || !o.pk || o.media_type !== 2 || !o.user?.username) return null;
    const views = o.play_count ?? o.view_count ?? o.ig_play_count ?? null;
    const cands = o.image_versions2?.candidates || [];
    const tall = cands.filter(c => c.height > c.width);
    const thumb = (tall.filter(c => c.width >= 300).pop() || tall[0] || cands[0])?.url;
    return {
      platform: 'instagram', id: String(o.pk), code: o.code, views, viewsText: null, thumb,
      owner: o.user.username.toLowerCase(), url: `https://www.instagram.com/reel/${o.code}/`,
    };
  };

  const fbItem = n => {
    const m = n?.node?.attachments?.[0]?.media;
    if (!m?.id) return null;
    const prog = m.videoDeliveryResponseFragment?.videoDeliveryResponseResult?.progressive_urls || [];
    const pick = q => prog.find(p => p.progressive_url && p.metadata?.quality === q)?.progressive_url;
    let ownerSlug = '';
    try { ownerSlug = new URL(m.owner?.url).pathname.split('/').filter(Boolean)[0] || ''; } catch {}
    return {
      platform: 'facebook', id: String(m.id), code: String(m.id),
      views: parseCount(m.play_count_reduced), viewsText: m.play_count_reduced || null,
      thumb: m.thumbnailImage?.uri || m.first_frame_thumbnail || null,
      video: pick('HD') || pick('SD') || prog.find(p => p.progressive_url)?.progressive_url || null,
      owner: { id: String(m.owner?.id || ''), slug: ownerSlug.toLowerCase(), name: m.owner?.name || '' },
      url: `https://www.facebook.com/reel/${m.id}/`,
    };
  };

  const extract = root => {
    const items = [];
    let hasNext;
    const walk = (o, out) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { for (const v of o) walk(v, out); return; }
      if (o.profile_reel_node) { const it = fbItem(o.profile_reel_node); if (it) out.push(it); return; }
      if (o.code && o.pk && o.media_type !== undefined) { const it = igItem(o); if (it) { out.push(it); return; } }
      if (Array.isArray(o.edges) && o.page_info && typeof o.page_info.has_next_page === 'boolean') {
        const sub = [];
        walk(o.edges, sub);
        if (sub.length) hasNext = o.page_info.has_next_page;
        out.push(...sub);
        return;
      }
      for (const k in o) walk(o[k], out);
    };
    walk(root, items);
    return { items, hasNext };
  };

  const MARK = /clips_connection|clips_user_connection|profile_reel_node/;

  const handleText = text => {
    if (typeof text !== 'string' || !MARK.test(text)) return;
    const all = [];
    let hasNext;
    for (const line of text.replace(/^for \(;;\);/, '').split('\n')) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const r = extract(j);
      all.push(...r.items);
      if (r.hasNext !== undefined) hasNext = r.hasNext;
    }
    send(all, hasNext);
  };

  const scanInline = () => {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (MARK.test(s.textContent)) handleText(s.textContent);
    }
  };

  const open = XMLHttpRequest.prototype.open;
  const sendX = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rsUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (/graphql|\/api\//.test(this.__rsUrl || '')) {
      this.addEventListener('load', () => {
        try { if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText); } catch {}
      });
    }
    return sendX.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    const url = String(input?.url || input);
    if (/graphql|\/api\//.test(url)) {
      p.then(r => r.clone().text().then(handleText)).catch(() => {});
    }
    return p;
  };

  document.addEventListener('DOMContentLoaded', scanInline);
  window.addEventListener('load', scanInline);

  window.addEventListener('message', e => {
    if (e.source === window && e.data?.src === SRC + '-replay') {
      for (const msg of buffer) window.postMessage(msg, location.origin);
    }
  });
})();
