/* ISWM dashboard: fills the pages from /api and shows the cameras on demand. No libraries. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = n => Math.round(n || 0).toLocaleString('en-IN');
  const tonnes = kg => (kg || 0) >= 100000 ? Math.round(kg / 1000).toLocaleString('en-IN') + ' t' : ((kg || 0) / 1000).toLocaleString('en-IN', {maximumFractionDigits: 1}) + ' t';
  const kg = n => n == null ? null : num(n) + ' kg';
  const trips = n => (n || 0) + (n === 1 ? ' trip' : ' trips');
  const ago = iso => {
    if (!iso) return 'never';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago';
  };
  const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const isoToday = () => isoDay(new Date());
  const hourLabel = h => (h % 12 || 12) + (h < 12 ? ' am' : ' pm');
  const STATE = {ok: ['Working', 'ok'], attention: ['Needs attention', 'attention'], offline: ['Offline', 'offline']};
  async function get(url) {
    const r = await fetch(url, {headers: {'Accept': 'application/json'}, credentials: 'same-origin'});
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // --- charts ------------------------------------------------------------------------------------
  // Bars side by side for inward and outward on one shared axis; hover a column for its numbers.
  function bars(box, labels, series, opt) {
    box._chart = {labels, series, opt};
    const W = box.clientWidth || 800, H = box.clientHeight || 240;
    const pad = {l: opt.padL || 44, r: 8, t: 10, b: 28};
    const max = Math.max(1, ...series.flatMap(s => s.values));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    const slot = (W - pad.l - pad.r) / labels.length;
    const bw = Math.max(2, Math.min(22, (slot - 6) / series.length - 2));
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    for (let v = 0; v <= top + 1e-9; v += step) {
      s += '<line class="' + (v === 0 ? 'base' : 'gridline') + '" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="axis" x="' + (pad.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + opt.yFmt(v) + '</text>';
    }
    const every = Math.max(1, Math.ceil(46 / slot));
    labels.forEach((lab, i) => {
      const cx = pad.l + slot * i + slot / 2, x0 = cx - (bw * series.length + 2 * (series.length - 1)) / 2;
      series.forEach((ser, k) => {
        const v = ser.values[i], yy = y(v), h = y(0) - yy;
        if (h > 0.5) s += '<path fill="var(--' + ser.key + ')" d="' + bar(x0 + k * (bw + 2), yy, bw, h, Math.min(4, h, bw / 2)) + '"/>';
      });
      if (i % every === 0) s += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + '</text>';
      s += '<rect class="hit" data-i="' + i + '" x="' + (pad.l + slot * i) + '" y="' + pad.t + '" width="' + slot + '" height="' + (H - pad.t - pad.b) + '"/>';
    });
    box.innerHTML = s + '</svg>';
    if (!box._hover) {
      box._hover = true;
      box.addEventListener('mousemove', e => {
        const hit = e.target.closest('.hit'), tip = $('tip');
        box.querySelectorAll('.hit.on').forEach(x => { if (x !== hit) x.classList.remove('on'); });
        if (!hit) { tip.hidden = true; return; }
        hit.classList.add('on');
        tip.innerHTML = box._chart.opt.tip(+hit.dataset.i);
        tip.hidden = false;
        let left = e.clientX + 14;
        if (left + tip.offsetWidth > window.innerWidth - 8) left = e.clientX - tip.offsetWidth - 14;
        tip.style.left = left + 'px'; tip.style.top = (e.clientY + 12) + 'px';
      });
      box.addEventListener('mouseleave', () => { $('tip').hidden = true; box.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on')); });
    }
  }
  const redraw = box => { if (box._chart && !box.hidden) bars(box, box._chart.labels, box._chart.series, box._chart.opt); };
  window.addEventListener('resize', () => document.querySelectorAll('.chart').forEach(redraw));
  // a bar with 4px rounded top ends, flat on the baseline
  const bar = (x, y, w, h, r) => 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p); };
  const tipRow = (key, label, value) => '<div><span>' + (key ? '<i class="sw ' + key + '"></i>' : '') + esc(label) + '</span>' + value + '</div>';
  // ranked horizontal bars: label, bar, value (one direction's colour)
  function hbars(el, rows, key, valueOf, textOf) {
    const max = Math.max(1, ...rows.map(valueOf));
    el.innerHTML = rows.map(r => '<div class="hb"><span class="hb-l">' + esc(r.label) + '</span><span class="hb-t"><span class="hb-b ' + key + '" data-w="' + Math.max(1, valueOf(r) / max * 100).toFixed(1) + '"></span></span><span class="hb-v">' + textOf(r) + '</span></div>').join('') ||
      '<div class="muted small">Nothing yet.</div>';
  }
  // the page's security policy blocks style="" in HTML, so bar widths are set from script
  const applyWidths = root => root.querySelectorAll('.hb-b[data-w]').forEach(b => { b.style.width = b.dataset.w + '%'; });

  // --- overview: status board ---------------------------------------------------------------------
  function overview() {
    let sites = [], filter = '', view = 'cards';
    try { view = localStorage.getItem('iswm-dash-view') || 'cards'; } catch (e) {}
    const order = {offline: 0, attention: 1, ok: 2};
    function draw() {
      const q = ($('find').value || '').trim().toLowerCase();
      const rows = sites.filter(s => (!filter || s.health.state === filter) && (!q || (s.name + ' ' + s.company + ' ' + s.id).toLowerCase().includes(q)))
        .sort((a, b) => order[a.health.state] - order[b.health.state] || a.name.localeCompare(b.name));
      $('board').hidden = view !== 'cards'; $('table-card').hidden = view !== 'table';
      document.querySelectorAll('#view button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
      $('board').innerHTML = rows.map(card).join('') || '<div class="muted">No plant matches.</div>';
      $('sites').tBodies[0].innerHTML = rows.map(tableRow).join('') || '<tr><td colspan="11" class="muted">No plant matches.</td></tr>';
    }
    function wbText(hh) { return hh.wb == null ? '—' : hh.wb ? 'On' + (hh.kg ? ' · ' + num(hh.kg) + ' kg' : '') : 'Off'; }
    function card(s) {
      const h = s.health, t = s.today || {}, st = STATE[h.state];
      const cams = (s.cameras || []).length, probs = h.cam_problems.length;
      return '<a class="site-card ' + st[1] + '" href="/site/' + esc(s.id) + '">' +
        '<div class="sc-head"><div><b>' + esc(s.name) + '</b><small>' + esc(s.company) + '</small></div><span class="pill ' + st[1] + '"><span class="dot"></span>' + st[0] + '</span></div>' +
        (h.state !== 'ok' ? '<ul class="reasons">' + h.reasons.map(r => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') +
        '<dl class="sc-facts">' +
          '<dt>Last seen</dt><dd>' + esc(ago(h.seen)) + '</dd>' +
          '<dt>Weighbridge</dt><dd class="' + (h.wb === false ? 'bad' : '') + '">' + wbText(h) + '</dd>' +
          '<dt>Cameras</dt><dd class="' + (probs ? 'bad' : '') + '">' + (cams ? cams + (probs ? ' · ' + probs + ' not working' : ' · ok') : '—') + '</dd>' +
          '<dt>Waiting to sync</dt><dd>' + (h.queued == null ? '—' : num(h.queued)) + '</dd>' +
        '</dl>' +
        '<div class="sc-today"><span><i class="sw in"></i>' + tonnes(t.in_kg) + '<small>' + trips(t.in_trips) + '</small></span>' +
          '<span><i class="sw out"></i>' + tonnes(t.out_kg) + '<small>' + trips(t.out_trips) + '</small></span>' +
          '<span>' + num(t.pending) + '<small>pending</small></span></div>' +
        '<div class="sc-foot">' + (h.operator ? 'On duty: ' + esc(h.operator) : '&nbsp;') + '<span>' + (h.version ? 'v' + esc(h.version) : '') + '</span></div></a>';
    }
    function tableRow(s) {
      const t = s.today || {}, h = s.health, st = STATE[h.state];
      return '<tr class="click" data-href="/site/' + esc(s.id) + '">' +
        '<td class="name"><a href="/site/' + esc(s.id) + '">' + esc(s.name) + '</a><small>' + esc(s.company) + '</small></td>' +
        '<td><span class="pill ' + st[1] + '" title="' + esc(h.reasons.join(' · ')) + '"><span class="dot"></span>' + st[0] + '</span></td>' +
        '<td>' + esc(ago(h.seen)) + '</td><td>' + wbText(h) + '</td>' +
        '<td class="r">' + num(t.in_trips) + '</td><td class="r">' + tonnes(t.in_kg) + '</td>' +
        '<td class="r">' + num(t.out_trips) + '</td><td class="r">' + tonnes(t.out_kg) + '</td>' +
        '<td class="r">' + (t.pending ? '<span class="tag wait">' + t.pending + '</span>' : '0') + '</td>' +
        '<td class="r">' + (s.cameras || []).length + '</td>' +
        '<td class="r"><a class="btn" href="/site/' + esc(s.id) + '">Open</a></td></tr>';
    }
    const load = () => get('/api/sites').then(d => {
      sites = d.sites;
      const n = k => sites.filter(s => s.health.state === k).length, sum = k => sites.reduce((a, s) => a + ((s.today || {})[k] || 0), 0);
      $('t-online').textContent = (sites.length - n('offline')) + ' of ' + sites.length + ' online';
      $('t-online-s').textContent = n('attention') + ' need attention · ' + n('offline') + ' offline';
      $('t-in').textContent = tonnes(sum('in_kg')); $('t-in-s').textContent = trips(sum('in_trips'));
      $('t-out').textContent = tonnes(sum('out_kg')); $('t-out-s').textContent = trips(sum('out_trips'));
      $('t-pend').textContent = num(sum('pending'));
      $('n-all').textContent = sites.length; $('n-attention').textContent = n('attention'); $('n-offline').textContent = n('offline'); $('n-ok').textContent = n('ok');
      $('today-label').textContent = 'Today · ' + new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'long', day: 'numeric', month: 'long'});
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'});
      draw(); charts();
    }).catch(() => { $('updated').textContent = 'Could not load. Retrying…'; });
    function charts() {
      const add = k => Array.from({length: 24}, (_, hr) => sites.reduce((a, s) => a + (((s.today || {})[k] || [])[hr] || 0), 0));
      const hin = add('in_by_hour'), hout = add('out_by_hour'), hours = [...Array(24).keys()];
      bars($('hours-chart'), hours.map(hourLabel), [{key: 'in', values: hin}, {key: 'out', values: hout}],
        {yFmt: v => num(v), tip: i => '<b>' + hourLabel(i) + ' – ' + hourLabel((i + 1) % 24) + '</b>' + tipRow('in', 'Inward', trips(hin[i])) + tipRow('out', 'Outward', trips(hout[i]))});
      const ranked = sites.map(s => ({label: s.name.replace(/^ISWM /, ''), kg: (s.today || {}).in_kg || 0, n: (s.today || {}).in_trips || 0})).sort((a, b) => b.kg - a.kg);
      hbars($('rank'), ranked, 'in', r => r.kg, r => tonnes(r.kg) + ' <small>' + trips(r.n) + '</small>');
      applyWidths($('rank'));
    }
    $('find').addEventListener('input', draw);
    $('filter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; document.querySelectorAll('#filter button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    $('view').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; view = b.dataset.v; try { localStorage.setItem('iswm-dash-view', view); } catch (er) {} draw(); });
    $('sites').addEventListener('click', e => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.href = tr.dataset.href; });
    load(); setInterval(load, 30000);
  }

  // --- one plant ----------------------------------------------------------------------------------
  function site() {
    const sid = document.body.dataset.site;
    let cams = [], names = {}, picked = [], q = 'normal';

    // today's tiles and status
    const loadSite = () => get('/api/sites').then(d => {
      const s = d.sites.find(x => x.id === sid); if (!s) return;
      const t = s.today || {}, h = s.health, st = STATE[h.state];
      $('s-in').textContent = tonnes(t.in_kg); $('s-in-s').textContent = trips(t.in_trips || 0);
      $('s-out').textContent = tonnes(t.out_kg); $('s-out-s').textContent = trips(t.out_trips || 0);
      $('s-pend').textContent = num(t.pending);
      $('s-sync').textContent = ago(s.last_sync);
      $('s-sync-s').textContent = h.queued ? num(h.queued) + (h.queued === 1 ? ' record' : ' records') + ' waiting to send' : 'nothing waiting';
      const probs = h.cam_problems.length;
      $('status-strip').className = 'status-strip ' + st[1];
      $('status-strip').innerHTML = '<span class="pill ' + st[1] + '"><span class="dot"></span>' + st[0] + '</span>' +
        (h.state !== 'ok' ? '<span class="reasons-inline">' + h.reasons.map(esc).join(' · ') + '</span>' : '<span>Everything is working.</span>') +
        '<span class="spacer"></span>' +
        '<span>Last seen <b>' + esc(ago(h.seen)) + '</b></span>' +
        '<span>Cameras <b>' + (s.cameras || []).length + (probs ? ', ' + probs + ' not working' : '') + '</b></span>' +
        (h.operator ? '<span>On duty <b>' + esc(h.operator) + '</b></span>' : '') +
        (h.version ? '<span>App <b>v' + esc(h.version) + '</b></span>' : '');
      if (!cams.length && s.cameras && s.cameras.length) setCams(s.cameras);
    }).catch(() => {});

    // live weight, plant online, camera names (names come from the plant through the relay)
    const loadLive = () => get('/api/sites/' + sid + '/live').then(l => {
      const p = $('plant-pill');
      p.className = 'pill ' + (l.plant_online ? 'ok' : 'offline');
      p.innerHTML = '<span class="dot"></span>' + (l.plant_online ? 'Plant online' : 'Plant offline');
      const w = l.weight;
      $('weight').textContent = w && w.connected ? num(w.weight) : '—';
      $('weight-s').textContent = !l.plant_online ? 'plant not reachable' : w && w.connected ? (w.stable ? 'steady' : 'settling') : 'weighbridge off';
      if (l.cams && l.cams.length) setCams(l.cams);
    }).catch(() => {});

    function setCams(list) {
      if (JSON.stringify(list) === JSON.stringify(cams)) return;
      cams = list; names = {}; list.forEach(c => { names[c[0]] = c[1]; });
      const opts = list.map(c => [c[0], c[1]]);
      if (list.length > 1) opts.push([list.map(c => c[0]).join(','), 'All']);
      $('cam-pick').innerHTML = opts.map(o => '<button data-c="' + esc(o[0]) + '"' + (o[0] === picked.join(',') ? ' class="on"' : '') + '>' + esc(o[1]) + '</button>').join('');
      document.querySelectorAll('#cam-grid .cam b[data-c]').forEach(b => { b.textContent = names[b.dataset.c] || b.dataset.c; });
      const keep = picked.filter(c => names[c]);
      if (keep.length !== picked.length) { picked = keep; drawCams(); }
    }
    function drawCams() {
      const g = $('cam-grid');
      g.innerHTML = '';
      $('cam-stop').hidden = !picked.length;
      $('cam-note').hidden = !!picked.length;
      document.querySelectorAll('#cam-pick button').forEach(b => b.classList.toggle('on', b.dataset.c === picked.join(',')));
      picked.forEach(c => {
        const d = document.createElement('div');
        d.className = 'cam';
        d.innerHTML = '<b data-c="' + esc(c) + '">' + esc(names[c] || c) + '</b><span>Asking the plant for pictures… (up to 20 s)</span>';
        const img = new Image();
        img.alt = names[c] || c;
        img.onload = () => { const s = d.querySelector('span'); if (s) s.remove(); };
        img.onerror = () => { const s = d.querySelector('span'); if (s) s.textContent = 'No picture. The plant may be offline. Trying again…'; setTimeout(() => { if (picked.includes(c)) img.src = src(c); }, 8000); };
        img.src = src(c);
        d.appendChild(img);
        g.appendChild(d);
      });
    }
    const src = c => '/cam/' + encodeURIComponent(sid) + '/' + encodeURIComponent(c) + '.mjpg?q=' + q + '&t=' + Date.now();
    $('cam-pick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; picked = b.dataset.c.split(','); drawCams(); });
    $('cam-q').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; q = b.dataset.q; document.querySelectorAll('#cam-q button').forEach(x => x.classList.toggle('on', x === b)); if (picked.length) drawCams(); });
    $('cam-stop').addEventListener('click', () => { picked = []; drawCams(); });

    // one day: hourly trips, shifts, breakdowns, vehicles, pending, trips
    let tripRows = [], dir = '';
    $('day').value = isoToday(); $('day').max = isoToday();
    function setQuick() {
      const y = new Date(); y.setDate(y.getDate() - 1);
      document.querySelectorAll('#day-quick button').forEach(b => b.classList.toggle('on', $('day').value === (b.dataset.o === '0' ? isoToday() : isoDay(y))));
    }
    const loadDay = () => {
      const day = $('day').value;
      $('csv').href = '/api/sites/' + sid + '/trips.csv?date=' + day;
      setQuick();
      get('/api/sites/' + sid + '/day?date=' + day).then(drawDay).catch(() => {});
      get('/api/sites/' + sid + '/trips?date=' + day).then(d => { tripRows = d.trips; drawTrips(); }).catch(() => {});
    };
    function drawDay(r) {
      const hin = r.hours.map(x => x.in), hout = r.hours.map(x => x.out);
      bars($('hours-chart'), r.hours.map(x => hourLabel(x.hour)), [{key: 'in', values: hin}, {key: 'out', values: hout}],
        {yFmt: v => num(v), tip: i => { const x = r.hours[i]; return '<b>' + hourLabel(i) + ' – ' + hourLabel((i + 1) % 24) + '</b>' + tipRow('in', 'Inward', trips(x.in) + ' · ' + tonnes(x.in_kg)) + tipRow('out', 'Outward', trips(x.out) + ' · ' + tonnes(x.out_kg)); }});
      $('busiest').textContent = r.busiest ? 'Busiest hour: ' + hourLabel(r.busiest.hour) + ' – ' + hourLabel((r.busiest.hour + 1) % 24) + ' (' + trips(r.busiest.in + r.busiest.out) + ')' : 'No trips this day';
      $('day-sum').textContent = 'In ' + tonnes(r.in.kg) + ' (' + trips(r.in.done) + ') · Out ' + tonnes(r.out.kg) + ' (' + trips(r.out.done) + ')' + (r.pending.length ? ' · ' + r.pending.length + ' pending' : '');
      $('shifts').tBodies[0].innerHTML = r.shifts.map(s => '<tr><td><b>' + esc(s.label) + '</b></td><td>' + esc(s.time) + '</td><td class="r">' + s.in.trips + '</td><td class="r">' + tonnes(s.in.kg) + '</td><td class="r">' + s.out.trips + '</td><td class="r">' + tonnes(s.out.kg) + '</td></tr>').join('');
      $('pending-n').textContent = trips(r.pending.length);
      $('pending').tBodies[0].innerHTML = r.pending.map(t => '<tr><td>' + esc(t.time.slice(11, 16)) + '</td><td>' + esc(t.id) + '</td><td><b>' + esc(t.vno) + '</b></td><td class="r">' + kg(t.gross_kg) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">None. Every vehicle has its empty weight.</td></tr>';
      const val = x => x.kg, txt = x => tonnes(x.kg) + ' <small>' + trips(x.trips) + '</small>';
      hbars($('b-waste'), r.waste, 'in', val, txt); hbars($('b-source'), r.source, 'in', val, txt);
      hbars($('b-material'), r.material, 'out', val, txt); hbars($('b-dest'), r.dest, 'out', val, txt);
      ['b-waste', 'b-source', 'b-material', 'b-dest'].forEach(id => applyWidths($(id)));
      $('vehicles').tBodies[0].innerHTML = r.vehicles.map(v => '<tr><td><b>' + esc(v.vno) + '</b></td><td class="r">' + v.trips + '</td><td class="r">' + (v.in_kg ? tonnes(v.in_kg) : '—') + '</td><td class="r">' + (v.out_kg ? tonnes(v.out_kg) : '—') + '</td><td class="r">' + (v.pending ? '<span class="tag wait">' + v.pending + '</span>' : '0') + '</td></tr>').join('') || '<tr><td colspan="5" class="muted">No trips this day.</td></tr>';
    }
    function drawTrips() {
      const f = ($('trip-find').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const rows = tripRows.filter(r => (!dir || r.dir === dir) && (!f || (String(r.vno) + r.id).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(f)));
      $('trips').tBodies[0].innerHTML = rows.map(r => '<tr><td>' + esc((r.time || '').slice(11, 16)) + '</td><td><span class="dir ' + esc(r.dir) + '"></span>' + esc(r.id) + '</td><td><b>' + esc(r.vno) + '</b></td><td>' + esc(r.what) + '</td><td>' + esc(r.where) + '</td>' +
        '<td class="r">' + (kg(r.gross_kg) || '—') + '</td><td class="r">' + (kg(r.tare_kg) || '—') + '</td><td class="r">' + (r.net_kg == null ? '<span class="tag pending">Pending</span>' : '<b>' + kg(r.net_kg) + '</b>') + '</td><td>' + esc(r.operator) + '</td></tr>').join('') ||
        '<tr><td colspan="9" class="muted">No trips for this choice.</td></tr>';
      const done = rows.filter(r => r.net_kg != null);
      $('trip-count').textContent = trips(rows.length) + ' · net ' + tonnes(done.reduce((a, r) => a + r.net_kg, 0));
    }
    $('day').addEventListener('change', loadDay);
    $('day-quick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const d = new Date(); d.setDate(d.getDate() - Number(b.dataset.o)); $('day').value = isoDay(d); loadDay(); });
    $('trip-find').addEventListener('input', drawTrips);
    $('trip-dir').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; dir = b.dataset.d; document.querySelectorAll('#trip-dir button').forEach(x => x.classList.toggle('on', x === b)); drawTrips(); });

    // 14-day chart and its table
    let days = [];
    const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'});
    const loadDaily = () => get('/api/sites/' + sid + '/daily').then(d => {
      days = d.days;
      bars($('chart'), days.map((x, i) => { const dt = new Date(x.date + 'T00:00:00'); return dt.getDate() + (dt.getDate() === 1 || i === 0 ? ' ' + dt.toLocaleDateString('en-IN', {month: 'short'}) : ''); }),
        [{key: 'in', values: days.map(x => x.in_kg / 1000)}, {key: 'out', values: days.map(x => x.out_kg / 1000)}],
        {padL: 52, yFmt: v => num(v) + ' t', tip: i => { const x = days[i]; return '<b>' + fmtDay(x.date) + '</b>' + tipRow('in', 'Inward', tonnes(x.in_kg) + ' · ' + trips(x.in_trips)) + tipRow('out', 'Outward', tonnes(x.out_kg) + ' · ' + trips(x.out_trips)) + (x.pending ? tipRow('', 'Pending', x.pending) : ''); }});
      $('chart-table').innerHTML = '<table class="grid"><thead><tr><th>Day</th><th class="r">Inward trips</th><th class="r">Inward</th><th class="r">Outward trips</th><th class="r">Outward</th><th class="r">Pending</th></tr></thead><tbody>' +
        days.slice().reverse().map(x => '<tr><td>' + fmtDay(x.date) + '</td><td class="r">' + x.in_trips + '</td><td class="r">' + tonnes(x.in_kg) + '</td><td class="r">' + x.out_trips + '</td><td class="r">' + tonnes(x.out_kg) + '</td><td class="r">' + x.pending + '</td></tr>').join('') + '</tbody></table>';
    }).catch(() => {});
    $('chart-table-toggle').addEventListener('click', e => {
      const on = $('chart-table').hidden;
      $('chart-table').hidden = !on; $('chart').hidden = on;
      e.target.textContent = on ? 'Show as chart' : 'Show as table'; e.target.setAttribute('aria-pressed', String(on));
      if (!on) redraw($('chart'));
    });

    loadSite(); loadLive(); loadDay(); loadDaily();
    setInterval(loadLive, 3000);
    setInterval(() => { loadSite(); if ($('day').value === isoToday()) loadDay(); }, 60000);
  }

  if (document.body.dataset.page === 'overview') overview();
  if (document.body.dataset.page === 'site') site();
})();
