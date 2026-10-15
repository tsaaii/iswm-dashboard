/* ISWM dashboard: the "ISWM Dashboard" design, drawn from live data. No libraries.
 * Landing (public): Live ULBs and Upcoming ULBs.  App (signed in): Overview, Sites, Cameras, Reports. */
(function () {
  'use strict';
  const root = document.getElementById('root');
  const PAGE = root.dataset.page, DEMO = root.dataset.demo === '1';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fT = v => (v || 0).toLocaleString('en-IN', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const fN = v => (v || 0).toLocaleString('en-IN');
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const hm = m => p2(Math.floor(m / 60)) + ':' + p2(m % 60);
  const sum = (arr, f) => { let s = 0; for (const t of arr) { const v = f(t); if (v) s += v; } return s; };
  const shiftOf = m => m >= 360 && m < 840 ? 'A (06–14)' : m >= 840 && m < 1320 ? 'B (14–22)' : 'C (22–06)';
  const W = () => window.innerWidth;
  // plants and records are on India time, whatever clock this computer has
  const nowI = () => new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
  const ST = {op: {l: 'Operational', fg: 'var(--green-700)', bg: 'var(--green-100)', dot: 'var(--green-600)'}, near: {l: 'Nearing completion', fg: 'var(--sky-600)', bg: 'var(--sky-100)', dot: 'var(--sky-400)'}, wip: {l: 'Under construction', fg: 'var(--ink-700)', bg: 'var(--ink-050)', dot: 'var(--ink-500)'}, lanc: {l: 'Land available, not started', fg: 'var(--amber-600)', bg: 'var(--amber-100)', dot: '#f59e0b'}, legacy: {l: 'Legacy / fresh waste', fg: 'var(--amber-600)', bg: 'var(--amber-100)', dot: '#fb923c'}, protest: {l: 'Public protest', fg: 'var(--red-600)', bg: 'var(--red-100)', dot: 'var(--red-600)'}, lna: {l: 'Land not available', fg: 'var(--ink-700)', bg: 'var(--ink-100)', dot: 'var(--ink-700)'}};
  const ORDER = ['op', 'near', 'wip', 'lanc', 'legacy', 'protest', 'lna'];
  const PERIODS = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['year', 'This year']];
  const GROUPS = [['trip', 'Trip list'], ['vehicle', 'Vehicle'], ['hour', 'Hour'], ['shift', 'Shift'], ['day', 'Day'], ['month', 'Month'], ['year', 'Year'], ['site', 'Site'], ['material', 'Material'], ['dest', 'Destination']];
  async function getJSON(url) {
    const r = await fetch(url, {headers: {Accept: 'application/json'}, credentials: 'same-origin'});
    if (r.status === 401) { location.href = '/login'; throw new Error('login'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  const S = {};          // what the person picked
  let actions = {};      // data-act name -> function, rebuilt on every draw
  let n = 0;
  const act = fn => { const k = 'a' + (n++); actions[k] = fn; return k; };
  function set(p) { Object.assign(S, p); draw(); }
  let pendingDraw = false;
  function draw() {
    // a redraw closes an open drop-down, so wait until the person has picked
    const a = document.activeElement;
    if (a && a.tagName === 'SELECT' && root.contains(a)) { pendingDraw = true; return; }
    pendingDraw = false;
    const keepFocus = a && a.id;
    actions = {}; n = 0;
    const html = PAGE === 'landing' ? landing() : app();
    const form = document.getElementById('logout-form');
    root.innerHTML = html;
    if (form) root.appendChild(form);
    if (keepFocus && document.getElementById(keepFocus)) document.getElementById(keepFocus).focus();
  }
  root.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && actions[b.dataset.act]) actions[b.dataset.act](e); });
  root.addEventListener('focusout', e => { if (pendingDraw && e.target.tagName === 'SELECT') setTimeout(draw, 0); });
  root.addEventListener('input', e => { if (e.target.id === 'link-url') S.linkUrl = e.target.value; });
  root.addEventListener('change', e => {
    const b = e.target.closest('[data-chg]');
    if (e.target.tagName === 'SELECT') e.target.blur();  // picked: the page may redraw again
    if (b && actions[b.dataset.chg]) actions[b.dataset.chg](e);
    else if (pendingDraw) draw();
  });
  window.addEventListener('resize', () => { clearTimeout(window._rs); window._rs = setTimeout(draw, 120); });

  // shared pieces ------------------------------------------------------------------------------------
  const chevron = (right, color) => '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;right:' + right + 'px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-500)"><path d="m6 9 6 6 6-6"></path></svg>';
  const options = (list, value) => list.map(o => '<option value="' + esc(o.v) + '"' + (o.v === value ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('');
  const liveDot = on => '<span style="width:7px;height:7px;border-radius:50%;background:' + (on ? 'var(--green-600)' : 'var(--ink-500)') + ';box-shadow:0 0 0 3px ' + (on ? 'rgba(15,161,78,.22)' : 'rgba(161,161,170,.2)') + '"></span>';
  const lastText = m => m == null ? 'No weighment yet today' : 'Live · last weighment ' + ((() => { const now = nowI(), d = now.getHours() * 60 + now.getMinutes() - m; return d <= 1 ? 'just now' : d < 60 ? d + ' min ago' : Math.floor(d / 60) + ' h ago'; })());
  const card = (inner, extra) => '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);' + (extra || '') + '">' + inner + '</div>';
  const th = (l, al) => '<th style="padding:10px 16px;text-align:' + (al || 'left') + ';font-size:12px;font-weight:700;color:var(--ink-500);border-bottom:1px solid var(--ink-100);white-space:nowrap;background:var(--green-050)">' + esc(l) + '</th>';
  const td = (v, style) => '<td style="padding:11px 16px;border-bottom:1px solid var(--ink-050);' + (style || '') + '">' + v + '</td>';
  const titleBlock = (t, sub) => '<div style="display:flex;flex-direction:column;gap:2px"><div style="font-size:15px;font-weight:700;letter-spacing:-.01em">' + esc(t) + '</div><div style="font-size:13px;color:var(--ink-500)">' + esc(sub) + '</div></div>';
  function barsHtml(bars, height, gap, grid) {
    return '<div style="display:flex;align-items:flex-end;gap:' + gap + 'px;height:' + height + 'px;border-bottom:1px solid var(--ink-100);background:repeating-linear-gradient(to top,var(--ink-050) 0,var(--ink-050) 1px,transparent 1px,transparent ' + grid + 'px)">' +
      bars.map(b => '<div title="' + esc(b.tip) + '" style="flex:1;min-width:0;height:' + b.h + '%;background:' + b.bg + ';border-radius:4px 4px 0 0"></div>').join('') + '</div>' +
      '<div style="display:flex;gap:' + gap + 'px;margin-top:-' + (gap > 4 ? 12 : 10) + 'px">' + bars.map(b => '<div style="flex:1;min-width:0;font-size:11px;color:var(--ink-500);white-space:nowrap;font-variant-numeric:tabular-nums">' + esc(b.lab) + '</div>').join('') + '</div>';
  }

  // ===== public landing ===============================================================================
  let LIVE = null, UP = null;
  function loadLive() {
    const q = '/api/public/live?day=' + (S.lDay || '') + '&ulb=' + encodeURIComponent(S.lUlb || 'ALL');
    getJSON(q).then(d => { LIVE = d; if (!S.lDay) S.lDay = d.today; draw(); }).catch(() => {});
  }
  function landing() {
    const tab = S.lTab || 'live';
    let h = '<div style="background:var(--white);border-bottom:1px solid var(--ink-100)"><div style="max-width:1180px;margin:0 auto;padding:14px clamp(12px,4vw,24px);display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:clamp(10px,3vw,20px)">' +
      '<img src="/static/logo-ap.png" alt="Government of Andhra Pradesh" style="width:clamp(48px,9vw,84px);height:auto;display:block">' +
      '<div style="text-align:center;min-width:0"><div style="font-size:clamp(17px,3.4vw,34px);font-weight:400;letter-spacing:-.015em;line-height:1.15;color:var(--ink-900);text-wrap:balance">Integrated Solid Waste Management Project</div><div style="font-size:clamp(10px,1.4vw,14px);letter-spacing:.14em;text-transform:uppercase;color:var(--green-700);font-weight:700;margin-top:6px">Govt of Andhra Pradesh</div></div>' +
      '<img src="/static/logo-sac.png" alt="Swachha Andhra Corporation" style="width:clamp(48px,9vw,84px);height:auto;display:block"></div></div>';
    h += '<div style="border-bottom:1px solid var(--ink-100);background:rgba(255,255,255,.92);backdrop-filter:blur(8px);position:sticky;top:0;z-index:5"><div style="max-width:1180px;margin:0 auto;padding:10px clamp(12px,4vw,24px);display:flex;align-items:center;gap:12px">' +
      '<div style="display:flex;gap:2px;padding:3px;background:var(--white);border:1px solid var(--ink-100);border-radius:10px">' +
      [['live', 'Live ULBs'], ['up', 'Upcoming ULBs']].map(([k, l]) => '<button data-act="' + act(() => { set({lTab: k}); if (k === 'up' && !UP) getJSON('/api/public/upcoming').then(d => { UP = d; draw(); }); }) + '" style="border:0;border-radius:var(--radius-pill);padding:6px 14px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;background:' + (tab === k ? 'var(--green-600)' : 'transparent') + ';color:' + (tab === k ? 'var(--white)' : 'var(--ink-500)') + '">' + l + '</button>').join('') + '</div>' +
      '<div style="margin-left:auto;display:flex;align-items:center;gap:16px">' +
      (W() >= 720 ? '<span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-500);white-space:nowrap">' + liveDot(LIVE && LIVE.last_min != null) + esc(LIVE ? lastText(LIVE.last_min) : 'Live') + '</span>' : '') +
      '<a href="/login" class="h-green7" style="display:inline-flex;align-items:center;height:36px;padding:0 16px;border:0;border-radius:var(--radius-pill);background:var(--green-600);color:var(--white);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;text-decoration:none">Sign in</a></div></div></div>';
    h += '<div style="max-width:1180px;margin:0 auto;padding:clamp(20px,5vw,36px) clamp(12px,4vw,24px) 48px;display:flex;flex-direction:column;gap:20px">';
    h += tab === 'live' ? landingLive() : landingUp();
    h += '<div style="font-size:12px;color:var(--ink-500);margin-top:8px">Sites and capacity from the package progress sheet' + (DEMO ? ' · daily trip figures are sample data' : '') + '</div></div>';
    return h;
  }
  function landingLive() {
    if (!LIVE) return '<div style="color:var(--ink-500)">Loading…</div>';
    const ds = S.lDay || LIVE.today, isT = ds === LIVE.today, d = parse(ds), sel = S.lUlb || 'ALL';
    const u = LIVE.ops.find(o => o.id === sel), tons = LIVE.kg / 1000, pre = ds < LIVE.op_start;
    const c = LIVE.hours, mx = Math.max(1, ...c), nh = isT ? nowI().getHours() : 24, pk = c.indexOf(Math.max(...c));
    const opts = [{v: 'ALL', l: 'All live ULBs (' + LIVE.ops.length + ')'}].concat(LIVE.ops.map(o => ({v: o.id, l: o.name + ' · Pkg ' + o.pk})).sort((a, b) => a.l.localeCompare(b.l)));
    const go = p => { set(p); loadLive(); };
    const kpis = [{label: 'Trips', value: fN(LIVE.trips), unit: '', sub: isT ? 'So far today' : 'Inward trips that day'},
      {label: 'Inward waste', value: fT(tons), unit: 'tonnes', sub: 'Net weight, complete records'},
      sel === 'ALL' ? {label: 'Plants in operation', value: pre ? '0' : String(LIVE.ops.length), unit: 'of ' + LIVE.total_ulbs, sub: (pre ? 'First plants opened ' : 'Operational since ') + parse(LIVE.op_start).toLocaleDateString('en-IN', {day: 'numeric', month: 'long', year: 'numeric'})}
        : {label: 'Capacity used', value: pre ? '—' : String(Math.round(tons / u.cap * 100)), unit: pre ? '' : '%', sub: 'Of about ' + u.cap + ' TPD estimated capacity'}];
    const bars = c.map((v, hr) => ({h: hr > nh ? 0 : (v ? Math.max(3, v / mx * 100) : 0), bg: isT && hr === nh ? 'var(--green-700)' : 'var(--green-500)', lab: hr % 2 === 0 ? p2(hr) : '', tip: p2(hr) + ':00–' + p2(hr) + ':59 · ' + v + ' trips'}));
    return '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:20px 32px;margin-bottom:8px">' +
      '<div style="flex:1 1 420px;min-width:0"><h1 style="margin:0;font-size:clamp(30px,4vw,42px);font-weight:400;letter-spacing:-.015em;line-height:1.1">Live ULBs</h1><div style="color:var(--ink-500);font-size:15px;margin-top:6px">' + esc(sel === 'ALL' ? 'Weighbridge activity across all operational plants' : 'ISWM ' + u.name + ' · Package ' + u.pk + ' · ' + u.ag) + '</div></div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex:1 1 auto;justify-content:flex-end">' +
      '<div style="position:relative;flex:1 1 220px;min-width:0;max-width:320px"><select id="l-ulb" aria-label="ULB" data-chg="' + act(e => go({lUlb: e.target.value})) + '" style="appearance:none;-webkit-appearance:none;width:100%;height:46px;padding:0 36px 0 16px;border:1px solid var(--ink-100);border-radius:var(--radius-pill);background:var(--white);font:inherit;font-size:14px;font-weight:700;color:var(--ink-900);cursor:pointer;box-shadow:var(--shadow-card)">' + options(opts, sel) + '</select>' + chevron(14) + '</div>' +
      '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:5px;display:flex;align-items:center;gap:2px">' +
      '<button aria-label="Day before" class="h-ink050" data-act="' + act(() => go({lDay: ymd(addD(d, -1))})) + '" style="width:34px;height:34px;border:0;border-radius:var(--radius-pill);background:transparent;cursor:pointer;font-size:17px;color:var(--ink-700)">‹</button>' +
      '<div style="display:flex;flex-direction:column;align-items:center;padding:0 10px;min-width:150px;line-height:1.25"><span style="font-size:11px;color:var(--ink-500);font-weight:700">' + esc(isT ? 'Today · live' : d.toLocaleDateString('en-IN', {weekday: 'long'})) + '</span><span style="font-size:14px;font-weight:700;white-space:nowrap">' + esc(d.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'})) + '</span></div>' +
      '<button aria-label="Day after" class="h-ink050" ' + (isT ? 'disabled ' : '') + 'data-act="' + act(() => go({lDay: ymd(addD(d, 1))})) + '" style="width:34px;height:34px;border:0;border-radius:var(--radius-pill);background:transparent;cursor:pointer;font-size:17px;color:var(--ink-700)">›</button>' +
      '<button ' + (isT ? 'disabled ' : '') + 'data-act="' + act(() => go({lDay: LIVE.today})) + '" style="height:34px;padding:0 12px;border:0;border-left:1px solid var(--ink-100);background:transparent;cursor:pointer;font-size:13px;font-weight:700;color:var(--green-700)">Today</button></div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px">' + kpis.map(k =>
        '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:22px 24px;display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;color:var(--ink-500);font-weight:700">' + esc(k.label) + '</div><div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:clamp(34px,8vw,44px);font-weight:400;letter-spacing:-.015em;line-height:1;font-variant-numeric:tabular-nums">' + esc(k.value) + '</span><span style="font-size:16px;color:var(--ink-500);font-weight:700">' + esc(k.unit) + '</span></div><div style="font-size:13px;color:var(--ink-500)">' + esc(k.sub) + '</div></div>').join('') + '</div>' +
      '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:22px 24px;display:flex;flex-direction:column;gap:20px">' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 16px">' + titleBlock('Trips per hour', sel === 'ALL' ? 'Inward trips, all operational plants' : 'Inward trips, ISWM ' + u.name) + '<div style="font-size:13px;color:var(--ink-500)">' + esc(LIVE.trips ? 'Busiest hour · ' + p2(pk) + ':00 with ' + c[pk] + ' trips' : 'No trips recorded') + '</div></div>' +
      barsHtml(bars, W() >= 640 ? 260 : 180, 5, 65) + '</div>';
  }
  function landingUp() {
    if (!UP) return '<div style="color:var(--ink-500)">Loading…</div>';
    const U = UP.ulbs, ops = U.filter(u => u.status === 'op'), pend = U.filter(u => u.status !== 'op'), liveCap = sum(ops, u => u.cap), awd = UP.awarded_tpd, wide = W() >= 640;
    const stats = [{label: 'Pending ULBs', value: fN(pend.length), unit: 'of ' + U.length, sub: 'Not yet in operation', c: 'var(--ink-900)'}, {label: 'Awarded capacity', value: fN(Math.round(awd)), unit: 'TPD', sub: 'Across ' + UP.packages.length + ' packages', c: 'var(--ink-900)'}, {label: 'Live capacity', value: fN(liveCap), unit: 'TPD', sub: 'From ' + ops.length + ' operational plants', c: 'var(--green-700)'}];
    const ags = {};
    UP.packages.forEach(p => { const a = ags[p.ag] || (ags[p.ag] = {l: p.ag, pk: [], n: 0, of: 0}); a.pk.push(p.n); a.of += p.ulb; a.n += U.filter(u => u.pk === p.n && u.status !== 'op').length; });
    const ag = Object.values(ags).sort((a, b) => b.n - a.n), mA = Math.max(...ag.map(a => a.n));
    const cl = UP.packages.map(p => ({l: 'Cluster ' + p.n + (p.n === 10 ? ' · Kurnool & Nandyal' : ''), sub: p.ag + ' · DyEE ' + p.dy, n: U.filter(u => u.pk === p.n && u.status !== 'op').length, of: p.ulb})), mC = Math.max(...cl.map(c => c.n));
    const cols = wide ? 'minmax(0,190px) minmax(0,1fr) 64px' : 'minmax(0,1fr) auto';
    const rowsHtml = rows => rows.map(r => '<div style="display:grid;grid-template-columns:' + cols + ';align-items:center;gap:6px 14px"><div style="min-width:0"><div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.l) + '</div><div style="font-size:12px;color:var(--ink-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(r.sub) + '</div></div>' +
      '<div style="order:' + (wide ? 0 : 1) + ';grid-column:' + (wide ? 'auto' : '1 / -1') + ';height:8px;background:var(--ink-050);border-radius:999px;overflow:hidden"><div style="height:100%;width:' + r.w + '%;background:var(--green-600);border-radius:999px"></div></div>' +
      '<div style="text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap"><span style="font-weight:700">' + r.n + '</span><span style="color:var(--ink-500);font-size:12px"> / ' + r.of + '</span></div></div>').join('');
    const box = (t, sub, rows) => '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:22px 24px;display:flex;flex-direction:column;gap:16px;min-width:0">' + titleBlock(t, sub) + '<div style="display:flex;flex-direction:column;gap:12px">' + rowsHtml(rows) + '</div></div>';
    return '<div style="margin-bottom:8px"><h1 style="margin:0;font-size:clamp(30px,4vw,42px);font-weight:400;letter-spacing:-.015em;line-height:1.1">Upcoming ULBs</h1><div style="color:var(--ink-500);font-size:15px;margin-top:6px">Sites not yet in operation, and how much awarded capacity is live</div></div>' +
      '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:24px;display:flex;flex-direction:column;gap:20px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:20px">' +
      stats.map(k => '<div style="display:flex;flex-direction:column;gap:6px"><div style="font-size:13px;color:var(--ink-500);font-weight:700">' + esc(k.label) + '</div><div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:40px;font-weight:400;letter-spacing:-.015em;line-height:1;font-variant-numeric:tabular-nums;color:' + k.c + '">' + esc(k.value) + '</span><span style="font-size:15px;color:var(--ink-500);font-weight:700">' + esc(k.unit) + '</span></div><div style="font-size:13px;color:var(--ink-500)">' + esc(k.sub) + '</div></div>').join('') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><div style="height:12px;background:var(--ink-050);border-radius:999px;overflow:hidden"><div style="height:100%;width:' + (liveCap / awd * 100) + '%;background:var(--green-600);border-radius:999px"></div></div><div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--ink-500)"><span>Live capacity · ' + (liveCap / awd * 100).toFixed(1) + '% of awarded</span><span>Awarded · ' + fN(awd) + ' TPD</span></div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:12px">' +
      box('Pending sites by agency', 'ULBs not yet in operation', ag.map(a => ({l: a.l, sub: 'Package' + (a.pk.length > 1 ? 's ' : ' ') + a.pk.join(' & '), n: a.n, of: a.of, w: a.n / mA * 100}))) +
      box('Pending sites by cluster', 'One cluster per package', cl.map(c => ({...c, w: c.n / mC * 100}))) + '</div>';
  }

  // ===== signed in ======================================================================================
  let ME = null, SYNC = {};
  const TRIPS = {}, LOADING = {};
  function trips(ids, from, to) {
    const k = ids.join(',') + '|' + from + '|' + to;
    if (TRIPS[k]) return TRIPS[k].rows;
    if (!LOADING[k]) {
      LOADING[k] = true;
      getJSON('/api/trips?ids=' + encodeURIComponent(ids.join(',')) + '&from=' + from + '&to=' + to)
        .then(d => { TRIPS[k] = {rows: d.trips, at: Date.now()}; }).catch(() => {}).finally(() => { delete LOADING[k]; draw(); });
    }
    return null;
  }
  function refreshToday() {  // today's figures change: fetch again every 30 s
    Object.keys(TRIPS).forEach(k => { if (k.endsWith('|' + ME.today) && Date.now() - TRIPS[k].at > 25000) delete TRIPS[k]; });
    getJSON('/api/sync?ids=' + ME.ops.join(',')).then(d => { SYNC = d; }).catch(() => {}).finally(draw);
  }
  const byId = id => ME.ulbs.find(u => u.id === id);
  function range(p) {
    const t = parse(ME.today);
    if (p === '7d') return [ymd(addD(t, -6)), ME.today];
    if (p === '30d') return [ymd(addD(t, -29)), ME.today];
    if (p === 'year') return [t.getFullYear() + '-01-01', ME.today];
    return [ME.today, ME.today];
  }
  function metrics(tr, days, ids) {
    const ins = tr.filter(t => t.dir === 'IN'), outs = tr.filter(t => t.dir === 'OUT'), cIn = ins.filter(t => t.net != null);
    const recv = sum(cIn, t => t.net) / 1000, wind = sum(cIn, t => t.mat === 'Wet' ? t.net : t.mat === 'Mixed' ? t.net * .7 : 0) / 1000;
    const by = m => sum(outs, t => t.mat === m ? t.net : 0) / 1000, rdf = by('RDF'), comp = by('Compost'), rec = by('Recyclables'), inert = by('Inerts');
    return {trips: ins.length, outTrips: outs.length, recv, wind, rdf, comp, rec, inert, disp: rdf + comp + rec + inert, div: recv ? Math.max(0, Math.min(1, 1 - inert / recv)) : 0, avg: cIn.length ? recv / cIn.length : 0, veh: new Set(ins.map(t => t.veh)).size, inc: tr.filter(t => t.net == null).length, cap: sum(ids, id => byId(id).cap) * days};
  }
  const syncMin = id => SYNC[id] == null ? null : SYNC[id];
  const syncOk = id => syncMin(id) != null && syncMin(id) < 30;
  const syncText = id => { const m = syncMin(id); return m == null ? 'Not synced yet' : m < 30 ? m + ' min ago' : 'Delayed · ' + Math.round(m / 60) + ' h'; };
  function app() {
    if (!ME) return '<div style="padding:40px;color:var(--ink-500)">Loading…</div>';
    const ops = ME.ops, single = ops.length === 1, sc = ME.ulbs, tab = S.tab || 'overview';
    const site = single ? ops[0] : (S.site || 'ALL'), ids = site === 'ALL' ? ops : [site];
    const period = S.period || 'today', [from, to] = range(period), days = Math.round((parse(to) - parse(from)) / 864e5) + 1;
    const todayAll = ops.length ? trips(ops, ME.today, ME.today) : [];
    const lastMin = todayAll && todayAll.length ? Math.max(...todayAll.map(t => t.min)) : null;
    const initials = ME.who.split(/[ ,]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const tabs = [['overview', 'Overview'], ...(sc.length > 1 ? [['sites', 'Sites']] : []), ['cameras', 'Cameras'], ['reports', 'Reports']];
    let h = '<div style="background:var(--white);border-bottom:1px solid var(--ink-100);position:sticky;top:0;z-index:5"><div style="max-width:1320px;margin:0 auto;padding:0 clamp(12px,4vw,24px)">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-height:56px;padding:8px 0">' +
      '<div style="width:28px;height:28px;border-radius:var(--radius-md);background:var(--green-600);display:flex;align-items:center;justify-content:center;flex:none"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"></path><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"></path><path d="m14 16-3 3 3 3"></path><path d="M8.293 13.596 7.196 9.5 3.1 10.598"></path><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"></path><path d="m13.378 9.633 4.096 1.098 1.097-4.096"></path></svg></div>' +
      '<span style="font-weight:700;font-size:15px;letter-spacing:-.01em;white-space:nowrap">ISWM AP</span><span style="color:var(--ink-200);font-size:18px">/</span>' +
      '<span style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(ME.scope) + '</span>' +
      '<span style="font-size:11px;font-weight:700;color:var(--ink-700);background:var(--ink-050);border-radius:999px;padding:2px 8px;white-space:nowrap">' + esc(ME.access) + '</span>' +
      '<div style="margin-left:auto;display:flex;align-items:center;gap:14px"><span style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-700);white-space:nowrap">' + liveDot(lastMin != null) + esc(lastText(lastMin)) + '</span>' +
      '<div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:50%;background:var(--green-600);color:var(--white);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none">' + esc(initials) + '</div>' + (W() >= 720 ? '<span style="font-size:13px;font-weight:700;white-space:nowrap">' + esc(ME.who) + '</span>' : '') + '</div>' +
      '<button class="h-green050" data-act="' + act(() => document.getElementById('logout-form').submit()) + '" style="height:32px;padding:0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-pill);background:var(--white);font-size:13px;color:var(--ink-700);cursor:pointer;white-space:nowrap">Sign out</button></div></div>' +
      '<div style="display:flex;gap:4px;margin-bottom:-1px;overflow-x:auto">' + tabs.map(([k, l]) => '<button data-act="' + act(() => set({tab: k})) + '" style="background:none;border:0;border-bottom:2px solid ' + (tab === k ? 'var(--green-600)' : 'transparent') + ';color:' + (tab === k ? 'var(--ink-900)' : 'var(--ink-500)') + ';font-size:14px;font-weight:700;padding:10px 12px;cursor:pointer">' + l + '</button>').join('') + '</div></div></div>';
    h += '<div style="max-width:1320px;margin:0 auto;padding:clamp(18px,5vw,28px) clamp(12px,4vw,24px) 40px;display:flex;flex-direction:column;gap:20px">';
    const title = {overview: 'Overview', sites: 'Sites', cameras: 'Plant cameras', reports: 'Reports'}[tab];
    const sub = {overview: 'Collection, processing and dispatch' + (ids.length === 1 ? ' at ISWM ' + byId(ids[0]).name : ' across ' + ids.length + ' operational plants'), sites: sc.length + ' ULBs in your access · ' + ops.length + ' operational', cameras: 'Live views from the plant', reports: 'Build a trip report and download it'}[tab];
    h += '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:16px 24px"><div style="flex:1 1 280px;min-width:0"><h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-.015em;line-height:1.2">' + esc(title) + '</h1><div style="color:var(--ink-500);font-size:14px;margin-top:4px">' + esc(sub) + '</div></div>';
    const siteOpts = (single ? [] : [{v: 'ALL', l: 'All operational plants (' + ops.length + ')'}]).concat(ops.map(id => ({v: id, l: 'ISWM ' + byId(id).name})));
    const sel = (id, list, value, chg, dis) => dis ? '<div style="width:240px;max-width:100%;height:36px;display:flex;align-items:center;padding:0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-md);background:var(--white);font-size:14px;font-weight:700;color:var(--ink-900);box-shadow:var(--shadow-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc((list.find(o => o.v === value) || list[0] || {}).l || '') + '</div>' : '<div style="position:relative;width:240px;max-width:100%"><select id="' + id + '" data-chg="' + chg + '"' + (dis ? ' disabled' : '') + ' style="appearance:none;-webkit-appearance:none;width:100%;min-width:0;height:36px;padding:0 32px 0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-md);background:var(--white);font:inherit;font-size:14px;color:var(--ink-900);cursor:pointer;box-shadow:var(--shadow-sm)">' + options(list, value) + '</select>' + chevron(10, 'var(--ink-500)') + '</div>';
    if (tab === 'overview' || tab === 'sites') {
      h += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">' + (tab === 'overview' ? sel('site-sel', siteOpts, site, act(e => set({site: e.target.value})), single) : '') +
        '<div style="display:flex;gap:2px;padding:3px;background:var(--ink-050);border-radius:10px">' + PERIODS.map(([k, l]) => '<button data-act="' + act(() => set({period: k})) + '" style="border:0;border-radius:var(--radius-pill);padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;background:' + (period === k ? 'var(--white)' : 'transparent') + ';color:' + (period === k ? 'var(--ink-900)' : 'var(--ink-500)') + ';box-shadow:' + (period === k ? '0 1px 2px rgba(24,24,27,.12)' : 'none') + '">' + l + '</button>').join('') + '</div></div>';
    }
    const camSite = S.camSite && ops.includes(S.camSite) ? S.camSite : ops[0];
    if (tab === 'cameras' && ops.length) h += sel('cam-sel', ops.map(id => ({v: id, l: 'ISWM ' + byId(id).name})), camSite, act(e => set({camSite: e.target.value})), single);
    if (tab === 'reports') h += '<div style="display:flex;flex-wrap:wrap;gap:8px"><button class="h-green050" data-act="' + act(() => download('xls')) + '" style="height:36px;padding:0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-pill);background:var(--white);color:var(--ink-900);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:8px">' + dlIcon + 'Excel</button><button class="h-green7" data-act="' + act(() => download('csv')) + '" style="height:36px;padding:0 16px;border:0;border-radius:var(--radius-pill);background:var(--green-600);color:var(--white);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:8px">' + dlIcon + 'Download CSV</button></div>';
    h += '</div>';
    if (!ops.length) h += '<div style="color:var(--ink-500)">None of your ULBs is in operation yet.</div>';
    else if (tab === 'overview') h += overview(ids, from, to, days, period);
    else if (tab === 'sites') h += sitesTab(sc, ops, from, to, days);
    else if (tab === 'cameras') h += camerasTab(camSite);
    else if (tab === 'reports') h += reportsTab(ops, single);
    h += '<div style="font-size:12px;color:var(--ink-500)">' + (DEMO ? 'Daily figures are sample data · ' : '') + 'net weight counts complete records only (gross and tare)</div></div>';
    return h;
  }
  const dlIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
  const loading = '<div style="color:var(--ink-500);padding:20px 0">Loading…</div>';

  function overview(ids, from, to, days, period) {
    const tr = trips(ids, from, to), feedTr = trips(ids, ME.today, ME.today);
    if (!tr) return loading;
    const m = metrics(tr, days, ids), synced = ids.filter(syncOk).length;
    const stock = DEMO ? sum(ids, id => byId(id).cap * .62 * 21) : null;
    const kpis = [{label: 'Collection trips', value: fN(m.trips), unit: '', sub: fN(m.veh) + ' vehicles · ' + fN(m.outTrips) + ' outward'},
      {label: 'Waste received', value: fT(m.recv), unit: 't', sub: pct(m.recv, m.cap) + ' of plant capacity'},
      {label: 'Windrowed', value: fT(m.wind), unit: 't', sub: pct(m.wind, m.recv) + ' of received'},
      {label: 'Recycled', value: fT(m.rec), unit: 't', sub: '+ ' + fT(m.rdf) + ' t RDF'},
      {label: 'Sent out', value: fT(m.disp), unit: 't', sub: fN(m.outTrips) + ' outward trips'},
      {label: 'Kept from landfill', value: m.recv ? Math.round(m.div * 100) : '—', unit: m.recv ? '%' : '', sub: fT(m.inert) + ' t inerts to landfill', color: 'var(--green-600)'}];
    const kpis2 = [['Avg load per trip', fT(m.avg) + ' t'], ['Compost produced', fT(m.comp) + ' t'], ['Windrow stock now', stock == null ? '—' : fN(Math.round(stock)) + ' t'],
      ['Incomplete records', fN(m.inc), m.inc ? 'var(--amber-600)' : ''], ['Plants synced', synced + ' / ' + ids.length, synced < ids.length ? 'var(--red-600)' : '']];
    let bars, tTitle, tNote;
    if (period === 'today') {
      const c = new Array(24).fill(0); tr.forEach(t => { if (t.dir === 'IN') c[Math.floor(t.min / 60)]++; });
      const mx = Math.max(1, ...c), nh = nowI().getHours();
      bars = c.map((v, hr) => ({h: hr > nh ? 0 : Math.max(2, v / mx * 100), bg: hr === nh ? 'var(--green-600)' : 'var(--green-200)', lab: hr % 3 === 0 ? p2(hr) : '', tip: p2(hr) + ':00 — ' + v + ' trips'}));
      tTitle = 'Trips by hour'; tNote = 'Inward trips · current hour highlighted';
    } else if (period === 'year') {
      const t0 = parse(ME.today), y = t0.getFullYear(), cm = t0.getMonth(), c = new Array(12).fill(0), M = 'JFMAMJJASOND';
      tr.forEach(t => { if (t.dir === 'IN' && t.net) c[+t.date.slice(5, 7) - 1] += t.net / 1000; });
      const mx = Math.max(1, ...c);
      bars = c.map((v, i) => ({h: i > cm ? 0 : Math.max(v ? 2 : 0, v / mx * 100), bg: i === cm ? 'var(--green-600)' : 'var(--green-200)', lab: M[i], tip: M[i] + ' ' + y + ' — ' + fT(v) + ' t'}));
      tTitle = 'Waste received by month'; tNote = 'Tonnes · plants operational since ' + parse(ME.op_start).toLocaleDateString('en-IN', {day: 'numeric', month: 'long'});
    } else {
      const c = {}; tr.forEach(t => { if (t.dir === 'IN' && t.net) c[t.date] = (c[t.date] || 0) + t.net / 1000; });
      const dl = []; for (let i = 0; i < days; i++) dl.push(ymd(addD(parse(from), i)));
      const mx = Math.max(1, ...dl.map(d => c[d] || 0));
      bars = dl.map((d, i) => ({h: Math.max(2, (c[d] || 0) / mx * 100), bg: d === ME.today ? 'var(--green-600)' : 'var(--green-200)', lab: (days <= 7 || i % 5 === 0) ? d.slice(8) : '', tip: d + ' — ' + fT(c[d] || 0) + ' t'}));
      tTitle = 'Waste received by day'; tNote = 'Tonnes · today highlighted';
    }
    const fl = [['Received at weighbridge', m.recv, 1], ['Windrowed for composting', m.wind], ['Compost dispatched', m.comp], ['RDF to cement plants', m.rdf], ['Recyclables sold', m.rec], ['Inerts to landfill', m.inert]];
    const dm = {}; tr.forEach(t => { if (t.dir === 'OUT') { const o = dm[t.dest] || (dm[t.dest] = {name: t.dest || '—', mat: t.mat, trips: 0, net: 0}); o.trips++; o.net += (t.net || 0) / 1000; } });
    const dests = Object.values(dm).sort((a, b) => b.net - a.net);
    const feed = (feedTr || []).slice().sort((a, b) => b.min - a.min).slice(0, 8);
    const kpiCols = W() >= 1200 ? 'repeat(6,minmax(0,1fr))' : W() >= 600 ? 'repeat(3,minmax(0,1fr))' : 'repeat(2,minmax(0,1fr))';
    return '<div style="display:grid;grid-template-columns:' + kpiCols + ';gap:12px">' + kpis.map(k => '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);padding:18px 20px;display:flex;flex-direction:column;gap:6px;min-width:0"><div style="font-size:13px;color:var(--ink-500);font-weight:700">' + esc(k.label) + '</div><div style="display:flex;align-items:baseline;gap:4px"><span style="font-size:30px;font-weight:400;letter-spacing:-.015em;line-height:1.1;font-variant-numeric:tabular-nums;color:' + (k.color || 'var(--ink-900)') + '">' + esc(k.value) + '</span><span style="font-size:15px;color:var(--ink-500);font-weight:700">' + esc(k.unit) + '</span></div><div style="font-size:12px;color:var(--ink-500)">' + esc(k.sub) + '</div></div>').join('') + '</div>' +
      card(kpis2.map(([l, v, c]) => '<div style="flex:1 1 170px;padding:12px 20px;border-right:1px solid var(--ink-050);border-top:1px solid var(--ink-050);margin-top:-1px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px;color:var(--ink-500)">' + esc(l) + '</span><span style="font-size:14px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;color:' + (c || 'var(--ink-900)') + '">' + esc(v) + '</span></div>').join(''), 'display:flex;flex-wrap:wrap;overflow:hidden') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px">' +
      card(titleBlock(tTitle, tNote) + barsHtml(bars, 190, 4, 47.5), 'padding:20px;display:flex;flex-direction:column;gap:18px;min-width:0') +
      card(titleBlock('Where the waste went', 'Share of waste received') + fl.map(([l, v, b]) => '<div style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;gap:12px;font-size:13px"><span style="color:var(--ink-700);font-weight:' + (b ? 600 : 400) + '">' + esc(l) + '</span><span style="font-variant-numeric:tabular-nums;white-space:nowrap"><span style="font-weight:700">' + fT(v) + ' t</span><span style="color:var(--ink-500)"> · ' + pct(v, m.recv) + '</span></span></div><div style="height:6px;background:var(--ink-050);border-radius:999px;overflow:hidden"><div style="height:100%;width:' + (m.recv ? Math.min(100, v / m.recv * 100) : 0) + '%;background:' + (b ? 'var(--ink-900)' : l.startsWith('Inerts') ? 'var(--red-600)' : 'var(--green-600)') + ';border-radius:999px"></div></div></div>').join('') +
        '<div style="font-size:12px;color:var(--ink-500);margin-top:auto">Rest is in process on windrows or lost as moisture (~' + pct(Math.max(0, m.recv - m.disp), m.recv) + ').</div>', 'padding:20px;display:flex;flex-direction:column;gap:14px;min-width:0') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:12px">' +
      card('<div style="padding:18px 20px 14px">' + titleBlock('Outward destinations', PERIODS.find(p => p[0] === period)[1]) + '</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>' + th('Destination') + th('Trips', 'right') + th('Tonnes', 'right') + th('Share', 'right') + '</tr></thead><tbody>' +
        dests.map(d => '<tr>' + td('<div style="font-weight:700">' + esc(d.name) + '</div><div style="font-size:12px;color:var(--ink-500)">' + esc(d.mat) + '</div>') + td(fN(d.trips), 'text-align:right;font-variant-numeric:tabular-nums') + td(fT(d.net), 'text-align:right;font-variant-numeric:tabular-nums;font-weight:700') + td(pct(d.net, m.disp), 'text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-500)') + '</tr>').join('') + '</tbody></table></div>' +
        (dests.length ? '' : '<div style="padding:20px;color:var(--ink-500);font-size:13px">No outward trips yet in this period.</div>'), 'overflow:hidden;min-width:0') +
      card('<div style="padding:18px 20px 14px">' + titleBlock('Latest weighments', 'Today · new ones appear as they are saved') + '</div><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>' + th('Time') + th('Vehicle') + th('Type') + th('Net', 'right') + '</tr></thead><tbody>' +
        feed.map(t => '<tr>' + td(hm(t.min), 'font-variant-numeric:tabular-nums;color:var(--ink-700)') + td('<div style="font-family:var(--font-mono);font-size:13px;white-space:nowrap">' + esc(t.veh) + '</div><div style="font-size:12px;color:var(--ink-500)">' + esc(byId(t.site).name) + '</div>') +
          td('<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:' + (t.dir === 'IN' ? 'var(--ink-050)' : 'var(--green-100)') + ';color:' + (t.dir === 'IN' ? 'var(--ink-700)' : 'var(--green-700)') + '">' + (t.dir === 'IN' ? 'In' : 'Out') + ' · ' + esc(t.mat) + '</span>') +
          td(t.net == null ? 'Tare pending' : fT(t.net / 1000) + ' t', 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:700;color:' + (t.net == null ? 'var(--amber-600)' : 'var(--ink-900)')) + '</tr>').join('') + '</tbody></table></div>' +
        (feedTr && !feed.length ? '<div style="padding:20px;color:var(--ink-500);font-size:13px">No weighments yet today.</div>' : ''), 'overflow:hidden;min-width:0') + '</div>';
  }

  function sitesTab(sc, ops, from, to, days) {
    const tr = trips(ops, from, to);
    if (!tr) return loading;
    const M = {}; ops.forEach(id => { M[id] = metrics(tr.filter(t => t.site === id), days, [id]); });
    const rows = sc.slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.pk - b.pk || a.name.localeCompare(b.name)).map(u => {
      const m = M[u.id], S2 = ST[u.status], op = !!m, ok = syncOk(u.id);
      const cells = [td('<div style="font-weight:700">ISWM ' + esc(u.name) + '</div><div style="font-size:12px;color:var(--ink-500)">Pkg ' + u.pk + ' · ' + esc(u.ag) + '</div>'),
        td('<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:' + S2.bg + ';color:' + S2.fg + '"><span style="width:6px;height:6px;border-radius:50%;background:' + S2.dot + '"></span>' + S2.l + '</span>'),
        td(u.cap + ' TPD', 'text-align:right;font-variant-numeric:tabular-nums;color:var(--ink-700)'), td(op ? fN(m.trips) : '—', 'text-align:right;font-variant-numeric:tabular-nums'),
        td(op ? fT(m.recv) + ' t' : '—', 'text-align:right;font-variant-numeric:tabular-nums;font-weight:700'), td(op ? pct(m.recv, m.cap) : '—', 'text-align:right;font-variant-numeric:tabular-nums'),
        td(op && m.recv ? pct(m.div, 1) : '—', 'text-align:right;font-variant-numeric:tabular-nums'), td(op ? fN(m.inc) : '—', 'text-align:right;font-variant-numeric:tabular-nums;color:' + (op && m.inc ? 'var(--amber-600)' : 'var(--ink-900)')),
        td(op ? '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:' + (ok ? 'var(--green-100)' : 'var(--red-100)') + ';color:' + (ok ? 'var(--green-700)' : 'var(--red-600)') + '"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span>' + esc(syncText(u.id)) + '</span>' : '')];
      return '<tr class="h-row"' + (op ? ' data-act="' + act(() => set({site: u.id, tab: 'overview'})) + '"' : '') + ' style="cursor:' + (op ? 'pointer' : 'default') + '">' + cells.join('') + '</tr>';
    });
    const ms = ops.map(id => M[id]), T = k => sum(ms, m => m[k]), recv = T('recv'), inert = T('inert'), b = 'text-align:right;font-variant-numeric:tabular-nums;font-weight:700';
    return card('<div style="overflow-x:auto"><table style="width:100%;min-width:1040px;border-collapse:collapse;font-size:14px"><thead><tr>' + th('ULB') + th('Status') + th('Est. capacity', 'right') + th('Trips', 'right') + th('Received', 'right') + th('Utilisation', 'right') + th('Kept from landfill', 'right') + th('Incomplete', 'right') + th('Sync') + '</tr></thead><tbody>' + rows.join('') +
      '<tr style="background:var(--green-050)">' + td('Operational total', 'font-weight:700') + td(ops.length + ' plants', 'color:var(--ink-500);font-size:12px') + td(fN(sum(ops, id => byId(id).cap)) + ' TPD', b) + td(fN(T('trips')), b) + td(fT(recv) + ' t', b) + td(pct(recv, T('cap')), b) + td(recv ? Math.round(Math.max(0, Math.min(1, 1 - inert / recv)) * 100) + '%' : '—', b) + td(fN(T('inc')), b) + td('') + '</tr></tbody></table></div>', 'overflow:hidden');
  }

  // cameras: the plant's cameras, with the names given at the plant, through the ISWM relay
  const CAMS = {};
  function camerasTab(cs) {
    if (!CAMS[cs]) { CAMS[cs] = {list: null}; getJSON('/api/cams/' + cs).then(d => { CAMS[cs] = {list: d.cams, linked: d.linked, online: d.online, error: d.error}; draw(); }).catch(() => { CAMS[cs].list = []; draw(); }); }
    const td0 = trips([cs], ME.today, ME.today) || [], last = td0.slice().sort((a, b) => b.min - a.min)[0], m = metrics(td0, 1, [cs]);
    const off = CAMS[cs].linked ? !CAMS[cs].online : (!syncOk(cs) && syncMin(cs) != null);
    const stats = [['Trips today', fN(m.trips)], ['Received today', fT(m.recv) + ' t'], ['Last weighment', last ? hm(last.min) + ' · ' + last.veh : '—'], ['Last sync', syncText(cs)]];
    const list = CAMS[cs].list, q = S.camQ || 'normal';
    const now = nowI(), ts = ymd(now) + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes());
    let h = card(stats.map(([l, v]) => '<div style="flex:1 1 170px;padding:12px 20px;border-right:1px solid var(--ink-050);border-top:1px solid var(--ink-050);margin-top:-1px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px;color:var(--ink-500)">' + esc(l) + '</span><span style="font-size:14px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums">' + esc(v) + '</span></div>').join(''), 'display:flex;flex-wrap:wrap;overflow:hidden');
    const note = CAMS[cs].error ? CAMS[cs].error : CAMS[cs].linked && off ? 'Plant is offline: it is not connected to the relay right now' : list && list.length ? 'Pictures come from the plant only while this page is open, and pause after 10 minutes' : list ? 'This plant has not shared its cameras yet' : 'Asking the plant for its cameras…';
    h += '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px"><div style="font-size:13px;color:var(--ink-500)">' + esc(note) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">' +
      (ME.can_configure ? '<button class="h-green050" data-act="' + act(() => { set({camCfg: !S.camCfg, linkErr: '', linkMsg: ''}); if (!S.camCfg) return; getJSON('/api/links').then(d => { LINKS = d; draw(); }).catch(() => {}); }) + '" style="height:36px;padding:0 16px;border:1px solid var(--ink-200);border-radius:var(--radius-pill);background:var(--white);color:var(--ink-900);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">' + (S.camCfg ? 'Close settings' : 'Configure cameras') + '</button>' : '') +
      '<div style="display:flex;gap:2px;padding:3px;background:var(--ink-050);border-radius:10px">' + [['low', 'Low data'], ['normal', 'Normal'], ['high', 'Sharper']].map(([k, l]) => '<button data-act="' + act(() => set({camQ: k})) + '" style="border:0;border-radius:var(--radius-pill);padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;background:' + (q === k ? 'var(--white)' : 'transparent') + ';color:' + (q === k ? 'var(--ink-900)' : 'var(--ink-500)') + ';box-shadow:' + (q === k ? '0 1px 2px rgba(24,24,27,.12)' : 'none') + '">' + l + '</button>').join('') + '</div></div></div>';
    if (S.camCfg) h += linksPanel();
    h += '<div id="cam-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:12px">' + (list || []).map((c, i) =>
      '<div style="position:relative;aspect-ratio:16/9;background:var(--ink-900);border-radius:var(--radius-lg);overflow:hidden;color:#ffffff">' +
      '<div data-msg="' + esc(c[0]) + '" style="position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;color:var(--ink-300);font-size:13px;text-align:center;padding:0 24px">' + (off ? 'Plant is not connected' : 'Asking the plant for pictures… (up to 20 s)') + '</div>' +
      (off ? '' : '<img data-cam="' + esc(c[0]) + '" alt="' + esc(c[1]) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">') +
      '<div style="position:absolute;top:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:13px;font-weight:700;background:rgba(0,0,0,.55);padding:3px 10px;border-radius:999px;white-space:nowrap">' + esc(c[1]) + '</span><span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;background:' + (off ? 'rgba(255,255,255,.18)' : '#dc2626') + ';padding:3px 8px;border-radius:999px"><span style="width:6px;height:6px;border-radius:50%;background:#ffffff"></span>' + (off ? 'OFFLINE' : 'LIVE') + '</span></div>' +
      '<div style="position:absolute;bottom:12px;left:12px;right:12px;display:flex;justify-content:space-between;align-items:flex-end;gap:8px;flex-wrap:wrap"><span style="font-family:var(--font-mono);font-size:12px;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px">' + esc(off ? 'Last sync ' + syncText(cs) : ts) + '</span>' + (i < 2 && last ? '<span style="font-size:12px;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px">' + esc(last.veh + ' · ' + (last.net != null ? fT(last.net / 1000) + ' t' : 'tare pending')) + '</span>' : '') + '</div></div>').join('') + '</div>';
    setTimeout(() => attachCams(cs, q), 0);
    return h;
  }
  // Configure cameras: paste a plant's live link from the ISWM relay
  let LINKS = null;
  function linksPanel() {
    const field = 'width:100%;min-width:0;height:36px;padding:0 10px;border:1px solid var(--ink-200);border-radius:var(--radius-md);background:var(--white);font:inherit;font-size:13px;color:var(--ink-900);outline:none';
    const post = (method, url, body) => fetch(url, {method, credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRF': root.dataset.csrf}, body: body ? JSON.stringify(body) : undefined}).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Could not save.'); return d; }));
    const save = () => {
      const link = document.getElementById('link-url').value, ulb = document.getElementById('link-ulb').value;
      post('POST', '/api/links', {link, ulb}).then(d => { set({linkErr: '', linkMsg: 'Saved. Showing ' + d.ulb + ' …'}); setTimeout(() => location.reload(), 600); }).catch(e => set({linkErr: e.message}));
    };
    const ulbs = LINKS ? LINKS.ulbs : [];
    return '<div style="background:var(--white);border:1px solid var(--ink-100);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:20px;display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;flex-direction:column;gap:2px"><div style="font-size:16px;font-weight:700">Camera links</div><div style="font-size:13px;color:var(--ink-500)">Paste a plant\'s live link from the ISWM relay, like https://iswm-api-….run.app/live/iswm-ananthapur?key=…. Once a link is set, the dashboard shows only the linked plants, with their cameras live.</div></div>' +
      '<div style="display:grid;grid-template-columns:' + (W() >= 760 ? 'minmax(0,1fr) minmax(0,220px) auto' : 'minmax(0,1fr)') + ';gap:8px;align-items:center">' +
      '<input id="link-url" aria-label="Plant live link" value="' + esc(S.linkUrl || '') + '" placeholder="https://iswm-api-….run.app/live/iswm-ananthapur?key=…" style="' + field + ';font-family:var(--font-mono);font-size:12px">' +
      '<div style="position:relative"><select id="link-ulb" aria-label="ULB" data-chg="' + act(e => { S.linkUlb = e.target.value; }) + '" style="' + field + ';appearance:none;-webkit-appearance:none;padding-right:28px;cursor:pointer"><option value="">ULB: find from the link</option>' + ulbs.map(u => '<option value="' + esc(u.id) + '"' + (S.linkUlb === u.id ? ' selected' : '') + '>' + esc(u.name + ' · Pkg ' + u.pk) + '</option>').join('') + '</select>' + chevron(10) + '</div>' +
      '<button class="h-green7" data-act="' + act(save) + '" style="height:36px;padding:0 18px;border:0;border-radius:var(--radius-pill);background:var(--green-600);color:var(--white);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">Save link</button></div>' +
      (S.linkErr ? '<div role="alert" style="font-size:13px;color:var(--red-600);background:var(--red-100);border-radius:var(--radius-md);padding:10px 12px">' + esc(S.linkErr) + '</div>' : '') +
      (S.linkMsg ? '<div style="font-size:13px;color:var(--green-700)">' + esc(S.linkMsg) + '</div>' : '') +
      (LINKS && LINKS.links.length ? '<div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--ink-100);padding-top:14px">' + LINKS.links.map(l =>
        '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px"><b style="min-width:140px">ISWM ' + esc(l.name) + '</b><span style="flex:1;min-width:0;font-family:var(--font-mono);font-size:12px;color:var(--ink-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.link) + '</span>' +
        (l.fixed ? '<span style="font-size:12px;color:var(--ink-500)">set on the server</span>' : '<button data-act="' + act(() => post('DELETE', '/api/links/' + l.ulb).then(() => location.reload()).catch(e => set({linkErr: e.message}))) + '" style="height:30px;padding:0 12px;border:1px solid var(--ink-200);border-radius:999px;background:var(--white);color:var(--red-600);font-size:13px;font-weight:700;cursor:pointer">Remove</button>') + '</div>').join('') + '</div>'
        : (LINKS ? '<div style="font-size:13px;color:var(--ink-500)">No links yet: the dashboard shows every operational plant.</div>' : ''));
  }

  // Each camera: fetch its newest picture about once a second (single pictures, not an endless stream,
  // so the browser's few connections stay free for the rest of the page). Pauses after 10 minutes.
  const FEEDS = {};
  const PAUSE_MS = 10 * 60 * 1000;
  function attachCams(cs, q) {
    document.querySelectorAll('#cam-grid img[data-cam]').forEach(img => {
      const cam = img.dataset.cam, key = cs + '/' + cam + '/' + q;
      let f = FEEDS[key];
      if (!f) {
        f = FEEDS[key] = {img: new Image(), url: null, started: Date.now(), alive: true, got: false};
        const loop = () => {
          if (!f.alive) return;
          if (Date.now() - f.started > PAUSE_MS) { f.paused = true; showMsg(cam, 'Paused after 10 minutes to save data. Click to continue.', true); return; }
          fetch('/cam/' + encodeURIComponent(cs) + '/' + encodeURIComponent(cam) + '.jpg?q=' + q + '&n=' + Date.now(), {credentials: 'same-origin', cache: 'no-store'})
            .then(r => r.status === 200 ? r.blob() : null)
            .then(b => { if (b && f.alive) { const old = f.url; f.url = URL.createObjectURL(b); f.img.src = f.url; if (old) URL.revokeObjectURL(old); if (!f.got) { f.got = true; showMsg(cam, ''); } } })
            .catch(() => {})
            .finally(() => { if (f.alive) f.t = setTimeout(loop, 1000); });
        };
        f.resume = () => { f.started = Date.now(); f.paused = false; showMsg(cam, f.got ? '' : 'Asking the plant for pictures… (up to 20 s)'); loop(); };
        loop();
      }
      f.img.alt = img.alt;
      f.img.setAttribute('style', img.getAttribute('style'));
      f.img.setAttribute('data-cam', cam);
      img.replaceWith(f.img);
      if (f.got && !f.paused) showMsg(cam, '');
      if (f.paused) showMsg(cam, 'Paused after 10 minutes to save data. Click to continue.', true);
    });
    Object.keys(FEEDS).forEach(k => { const f = FEEDS[k]; if (!document.body.contains(f.img)) { f.alive = false; clearTimeout(f.t); if (f.url) URL.revokeObjectURL(f.url); delete FEEDS[k]; } });
  }
  function showMsg(cam, text, resume) {
    const m = document.querySelector('#cam-grid [data-msg="' + cam + '"]');
    if (!m) return;
    m.textContent = text;
    m.style.zIndex = text ? '2' : '0';
    m.style.background = text && resume ? 'rgba(0,0,0,.6)' : 'transparent';
    m.style.cursor = resume ? 'pointer' : 'default';
    m.onclick = resume ? () => { Object.values(FEEDS).forEach(f => { if (f.paused) f.resume(); }); } : null;
  }

  // reports
  let REPORT = null;
  function reportsTab(ops, single) {
    const t = parse(ME.today);
    const rFrom = S.rFrom || ymd(addD(t, -6)), rTo = S.rTo || ME.today, rGroup = S.rGroup || 'vehicle', rDir = S.rDir || 'all';
    const rSite = single ? ops[0] : (S.rSite || 'ALL'), rids = rSite === 'ALL' ? ops : [rSite], name = id => byId(id).name;
    let tr = trips(rids, rFrom, rTo);
    const siteOpts = (single ? [] : [{v: 'ALL', l: 'All operational plants (' + ops.length + ')'}]).concat(ops.map(id => ({v: id, l: 'ISWM ' + byId(id).name})));
    const presets = [['Today', ME.today, ME.today], ['Yesterday', ymd(addD(t, -1)), ymd(addD(t, -1))], ['Last 7 days', ymd(addD(t, -6)), ME.today], ['This month', ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ME.today], ['This year', t.getFullYear() + '-01-01', ME.today]];
    const input = 'width:auto;min-width:0;height:36px;padding:0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-md);background:var(--white);font:inherit;font-size:14px;color:var(--ink-900);outline:none;box-shadow:var(--shadow-sm);flex:1 1 130px';
    const selStyle = 'appearance:none;-webkit-appearance:none;width:100%;min-width:0;height:36px;padding:0 32px 0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-md);background:var(--white);font:inherit;font-size:14px;color:var(--ink-900);cursor:pointer;box-shadow:var(--shadow-sm)';
    let h = card('<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--ink-700)">Group trips by</div><div style="display:flex;flex-wrap:wrap;gap:6px">' +
      GROUPS.map(([k, l]) => '<button data-act="' + act(() => set({rGroup: k})) + '" style="height:30px;padding:0 12px;border-radius:999px;border:1px solid ' + (rGroup === k ? 'var(--green-600)' : 'var(--ink-200)') + ';background:' + (rGroup === k ? 'var(--green-600)' : 'var(--white)') + ';color:' + (rGroup === k ? 'var(--white)' : 'var(--ink-700)') + ';font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">' + l + '</button>').join('') + '</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--ink-700)">Date range</div><div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<input id="r-from" type="date" aria-label="From" value="' + rFrom + '" max="' + ME.today + '" data-chg="' + act(e => e.target.value && set({rFrom: e.target.value})) + '" style="' + input + '"><span style="color:var(--ink-500)">→</span>' +
      '<input id="r-to" type="date" aria-label="To" value="' + rTo + '" max="' + ME.today + '" data-chg="' + act(e => e.target.value && set({rTo: e.target.value})) + '" style="' + input + '"></div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px 12px">' + presets.map(([l, f, to]) => '<button class="h-textgreen7" data-act="' + act(() => set({rFrom: f, rTo: to})) + '" style="border:0;background:none;padding:0;font-size:13px;color:var(--green-600);font-weight:700;cursor:pointer">' + l + '</button>').join('') + '</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><div style="font-size:13px;font-weight:700;color:var(--ink-700)">Filter</div>' +
      (single ? '<div style="height:36px;display:flex;align-items:center;padding:0 12px;border:1px solid var(--ink-100);border-radius:var(--radius-md);background:var(--white);font-size:14px;font-weight:700;box-shadow:var(--shadow-sm)">ISWM ' + esc(name(rSite)) + '</div>'
        : '<div style="position:relative"><select id="r-site" aria-label="Plant" data-chg="' + act(e => set({rSite: e.target.value})) + '" style="' + selStyle + '">' + options(siteOpts, rSite) + '</select>' + chevron(10, 'var(--ink-500)') + '</div>') +
      '<div style="position:relative"><select id="r-dir" aria-label="Direction" data-chg="' + act(e => set({rDir: e.target.value})) + '" style="' + selStyle + '">' + options([{v: 'all', l: 'Inward and outward'}, {v: 'IN', l: 'Inward only'}, {v: 'OUT', l: 'Outward only'}], rDir) + '</select>' + chevron(10, 'var(--ink-500)') + '</div></div>',
      'padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px 28px');
    if (!tr) { REPORT = null; return h + loading; }
    if (rDir !== 'all') tr = tr.filter(x => x.dir === rDir);
    const R = 'right';
    let cols, rows, total;
    if (rGroup === 'trip') {
      cols = [['Ticket'], ['Date'], ['Time'], ['Site'], ['Vehicle'], ['Direction'], ['Material'], ['Gross kg', R], ['Tare kg', R], ['Net kg', R], ['Shift'], ['Destination']];
      rows = tr.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.min - b.min).map(x => [x.ticket, x.date, hm(x.min), name(x.site), x.veh, x.dir === 'IN' ? 'Inward' : 'Outward', x.mat, x.gross, x.tare == null ? 'Pending' : x.tare, x.net == null ? 'Pending' : x.net, shiftOf(x.min), x.dest || '—']);
      total = ['Total', tr.length + ' trips', '', '', '', '', '', '', '', fN(sum(tr, x => x.net)), '', ''];
    } else {
      const kf = {vehicle: x => x.veh, hour: x => p2(Math.floor(x.min / 60)) + ':00–' + p2(Math.floor(x.min / 60)) + ':59', shift: x => shiftOf(x.min), day: x => x.date, month: x => x.date.slice(0, 7), year: x => x.date.slice(0, 4), site: x => name(x.site), material: x => x.mat, dest: x => x.dest || '— (inward)'}[rGroup];
      const mp = new Map();
      for (const x of tr) { const k = kf(x); let o = mp.get(k); if (!o) { o = {k, n: 0, c: 0, net: 0, in: 0, out: 0, v: new Set()}; mp.set(k, o); } o.n++; x.dir === 'IN' ? o.in++ : o.out++; o.v.add(x.veh); if (x.net != null) { o.c++; o.net += x.net; } }
      const arr = [...mp.values()].sort(['vehicle', 'dest', 'material'].includes(rGroup) ? (a, b) => b.n - a.n : (a, b) => a.k < b.k ? -1 : 1);
      cols = [[GROUPS.find(g => g[0] === rGroup)[1]], ['Trips', R], ['Inward', R], ['Outward', R], ['Vehicles', R], ['Net (t)', R], ['Avg load (t)', R], ['Incomplete', R]];
      rows = arr.map(o => [o.k, o.n, o.in, o.out, o.v.size, fT(o.net / 1000), o.c ? fT(o.net / o.c / 1000) : '—', o.n - o.c]);
      const N = sum(arr, o => o.n), C = sum(arr, o => o.c), NET = sum(arr, o => o.net);
      total = ['Total', fN(N), fN(sum(arr, o => o.in)), fN(sum(arr, o => o.out)), new Set(tr.map(x => x.veh)).size, fT(NET / 1000), C ? fT(NET / C / 1000) : '—', fN(N - C)];
    }
    REPORT = {cols, rows, total, name: 'ISWM_trips_by_' + rGroup + '_' + rFrom + '_to_' + rTo};
    const al = c => c[1] || 'left', cap = 200;
    h += card('<div style="padding:18px 20px 14px">' + titleBlock('Trips by ' + GROUPS.find(g => g[0] === rGroup)[1].toLowerCase(), fN(tr.length) + ' trips · ' + rFrom + ' to ' + rTo + ' · ' + (rids.length === 1 ? 'ISWM ' + name(rids[0]) : rids.length + ' plants') + ' · ' + {all: 'inward + outward', IN: 'inward', OUT: 'outward'}[rDir]) + '</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums"><thead><tr>' + cols.map(c => th(c[0], al(c))).join('') + '</tr></thead><tbody>' +
      rows.slice(0, cap).map(r => '<tr class="h-row">' + r.map((v, i) => td(esc(typeof v === 'number' ? fN(v) : v), 'text-align:' + al(cols[i]) + ';white-space:nowrap;color:' + (v === 'Pending' ? 'var(--amber-600)' : 'inherit'))).join('') + '</tr>').join('') +
      '<tr style="background:var(--green-050)">' + total.map((v, i) => td(esc(v), 'font-weight:700;text-align:' + al(cols[i]) + ';white-space:nowrap')).join('') + '</tr></tbody></table></div>' +
      (rows.length > cap ? '<div style="padding:12px 20px;font-size:12px;color:var(--ink-500)">Showing first ' + cap + ' of ' + fN(rows.length) + ' rows — the download has all of them.</div>' : ''), 'overflow:hidden');
    return h;
  }
  function download(kind) {
    if (!REPORT) return;
    const {cols, rows, total, name} = REPORT;
    const save = (content, type, ext) => { const b = new Blob([content], {type}), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name + ext; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
    // a cell starting with = + - @ would run as a formula in Excel
    const cell = v => { v = String(v); return /^[=+\-@]/.test(v) ? "'" + v : v; };
    if (kind === 'csv') {
      const q = v => { v = cell(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      save('﻿' + [cols.map(c => c[0]), ...rows, total].map(r => r.map(q).join(',')).join('\n'), 'text/csv', '.csv');
    } else {
      const x = v => esc(cell(v));
      save('<html><head><meta charset="utf-8"></head><body><table border="1"><tr>' + cols.map(c => '<th>' + x(c[0]) + '</th>').join('') + '</tr>' + rows.map(r => '<tr>' + r.map(v => '<td>' + x(v) + '</td>').join('') + '</tr>').join('') + '<tr>' + total.map(v => '<td><b>' + x(v) + '</b></td>').join('') + '</tr></table></body></html>', 'application/vnd.ms-excel', '.xls');
    }
  }

  // start
  if (PAGE === 'landing') { draw(); loadLive(); setInterval(() => { if ((S.lTab || 'live') === 'live' && LIVE && S.lDay === LIVE.today) loadLive(); }, 30000); }
  if (PAGE === 'app') {
    draw();
    getJSON('/api/me').then(d => { ME = d; refreshToday(); setInterval(refreshToday, 30000); }).catch(() => {});
  }
})();
