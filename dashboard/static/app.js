/* ISWM dashboard: fills the pages from /api and shows the cameras on demand. No libraries. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = n => Math.round(n || 0).toLocaleString('en-IN');
  const tonnes = kg => (kg || 0) >= 100000 ? Math.round(kg / 1000).toLocaleString('en-IN') + ' t' : ((kg || 0) / 1000).toLocaleString('en-IN', {maximumFractionDigits: 1}) + ' t';
  const kg = n => n == null ? null : num(n) + ' kg';
  const trips = n => n + (n === 1 ? ' trip' : ' trips');
  const ago = iso => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  };
  const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  async function get(url) {
    const r = await fetch(url, {headers: {'Accept': 'application/json'}, credentials: 'same-origin'});
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // --- overview ------------------------------------------------------------------------------
  function overview() {
    let sites = [];
    const draw = () => {
      const q = ($('find').value || '').trim().toLowerCase();
      const rows = sites.filter(s => !q || (s.name + ' ' + s.company + ' ' + s.id).toLowerCase().includes(q));
      $('sites').tBodies[0].innerHTML = rows.map(s => {
        const t = s.today || {};
        return '<tr class="click" data-href="/site/' + esc(s.id) + '">' +
          '<td class="name"><a href="/site/' + esc(s.id) + '">' + esc(s.name) + '</a><small>' + esc(s.company) + '</small></td>' +
          '<td>' + (s.online ? '<span class="pill on"><span class="dot"></span>Online</span>' : '<span class="pill off"><span class="dot"></span>Offline</span>') + '</td>' +
          '<td>' + esc(ago(s.last_sync)) + '</td>' +
          '<td class="r">' + num(t.in_trips) + '</td><td class="r">' + tonnes(t.in_kg) + '</td>' +
          '<td class="r">' + num(t.out_trips) + '</td><td class="r">' + tonnes(t.out_kg) + '</td>' +
          '<td class="r">' + (t.pending ? '<span class="tag wait">' + t.pending + '</span>' : '0') + '</td>' +
          '<td class="r">' + (s.cameras || []).length + '</td>' +
          '<td class="r"><a class="btn" href="/site/' + esc(s.id) + '">Open</a></td></tr>';
      }).join('') || '<tr><td colspan="10" class="muted">No plant matches.</td></tr>';
    };
    const load = () => get('/api/sites').then(d => {
      sites = d.sites;
      const on = sites.filter(s => s.online).length, sum = k => sites.reduce((a, s) => a + ((s.today || {})[k] || 0), 0);
      $('t-online').textContent = on + ' of ' + sites.length;
      $('t-online-s').textContent = sites.length - on ? (sites.length - on) + ' not synced in the last 2 hours' : 'all plants syncing';
      $('t-in').textContent = tonnes(sum('in_kg')); $('t-in-s').textContent = trips(sum('in_trips'));
      $('t-out').textContent = tonnes(sum('out_kg')); $('t-out-s').textContent = trips(sum('out_trips'));
      $('t-pend').textContent = num(sum('pending'));
      $('today-label').textContent = 'Today · ' + new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'long', day: 'numeric', month: 'long'});
      $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'});
      draw();
    }).catch(() => { $('updated').textContent = 'Could not load. Retrying…'; });
    $('find').addEventListener('input', draw);
    $('sites').addEventListener('click', e => { const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a')) location.href = tr.dataset.href; });
    load(); setInterval(load, 60000);
  }

  // --- one plant ----------------------------------------------------------------------------------
  function site() {
    const sid = document.body.dataset.site;
    let cams = [], names = {}, picked = [], q = 'normal';

    // today's tiles
    const loadSite = () => get('/api/sites').then(d => {
      const s = d.sites.find(x => x.id === sid); if (!s) return;
      const t = s.today || {};
      $('s-in').textContent = tonnes(t.in_kg); $('s-in-s').textContent = trips(t.in_trips || 0);
      $('s-out').textContent = tonnes(t.out_kg); $('s-out-s').textContent = trips(t.out_trips || 0);
      $('s-pend').textContent = num(t.pending);
      $('s-sync').textContent = ago(s.last_sync);
      $('s-sync-s').textContent = s.online ? 'syncing normally' : 'not synced in the last 2 hours';
      if (!cams.length && s.cameras && s.cameras.length) setCams(s.cameras);
    }).catch(() => {});

    // live weight, plant online, camera names (names come from the plant through the relay)
    const loadLive = () => get('/api/sites/' + sid + '/live').then(l => {
      const p = $('plant-pill');
      p.className = 'pill ' + (l.plant_online ? 'on' : 'off');
      p.innerHTML = '<span class="dot"></span>' + (l.plant_online ? 'Plant online' : 'Plant offline');
      const w = l.weight;
      $('weight').textContent = w && w.connected ? num(w.weight) : '—';
      $('weight-s').textContent = !l.plant_online ? 'plant not reachable' : w && w.connected ? (w.stable ? 'steady' : 'settling') : 'weighbridge off';
      if (l.cams && l.cams.length) setCams(l.cams);
    }).catch(() => {});

    function setCams(list) {
      const key = JSON.stringify(list);
      if (key === JSON.stringify(cams)) return;
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

    // 14-day chart: inward and outward tonnes per day, side by side
    let days = [];
    const loadDaily = () => get('/api/sites/' + sid + '/daily').then(d => { days = d.days; chart(); table(); }).catch(() => {});
    function chart() {
      const box = $('chart'), W = box.clientWidth || 800, H = box.clientHeight || 260;
      const pad = {l: 52, r: 8, t: 10, b: 28};
      const max = Math.max(1, ...days.map(x => Math.max(x.in_kg, x.out_kg))) / 1000;
      const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
      const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / top);
      const slot = (W - pad.l - pad.r) / days.length, bw = Math.max(3, Math.min(22, (slot - 10) / 2));
      let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">';
      for (let v = 0; v <= top + 1e-9; v += step) {
        s += '<line class="' + (v === 0 ? 'base' : 'gridline') + '" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
        s += '<text class="axis" x="' + (pad.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toLocaleString('en-IN') + ' t</text>';
      }
      const every = slot < 34 ? 2 : 1;
      days.forEach((d, i) => {
        const cx = pad.l + slot * i + slot / 2;
        [['in', d.in_kg, cx - bw - 1], ['out', d.out_kg, cx + 1]].forEach(([k, v, x]) => {
          const yy = y(v / 1000), h = y(0) - yy;
          if (h > 0.5) s += '<path fill="var(--' + k + ')" d="' + bar(x, yy, bw, h, Math.min(4, h, bw / 2)) + '"/>';
        });
        if (i % every === 0 || i === days.length - 1) {
          const dt = new Date(d.date + 'T00:00:00');
          s += '<text class="axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + dt.getDate() + (dt.getDate() === 1 || i === 0 ? ' ' + dt.toLocaleDateString('en-IN', {month: 'short'}) : '') + '</text>';
        }
        s += '<rect class="hit" data-i="' + i + '" x="' + (pad.l + slot * i) + '" y="' + pad.t + '" width="' + slot + '" height="' + (H - pad.t - pad.b) + '"/>';
      });
      box.innerHTML = s + '</svg>';
    }
    // a bar with 4px rounded top ends, flat on the baseline
    const bar = (x, y, w, h, r) => 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    const niceStep = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
    $('chart').addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit'), tip = $('tip');
      document.querySelectorAll('#chart .hit.on').forEach(x => { if (x !== hit) x.classList.remove('on'); });
      if (!hit) { tip.hidden = true; return; }
      hit.classList.add('on');
      const d = days[+hit.dataset.i];
      tip.innerHTML = '<b>' + new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'}) + '</b>' +
        '<div><span><i class="sw in"></i>Inward</span>' + tonnes(d.in_kg) + ' · ' + trips(d.in_trips) + '</div>' +
        '<div><span><i class="sw out"></i>Outward</span>' + tonnes(d.out_kg) + ' · ' + trips(d.out_trips) + '</div>' +
        (d.pending ? '<div><span>Pending</span>' + d.pending + '</div>' : '');
      const card = $('chart').closest('.card').getBoundingClientRect();
      tip.hidden = false;
      let left = e.clientX - card.left + 14;
      if (left + tip.offsetWidth > card.width - 8) left = e.clientX - card.left - tip.offsetWidth - 14;
      tip.style.left = left + 'px'; tip.style.top = (e.clientY - card.top + 10) + 'px';
    });
    $('chart').addEventListener('mouseleave', () => { $('tip').hidden = true; document.querySelectorAll('#chart .hit.on').forEach(x => x.classList.remove('on')); });
    function table() {
      $('chart-table').innerHTML = '<table class="grid"><thead><tr><th>Day</th><th class="r">Inward trips</th><th class="r">Inward</th><th class="r">Outward trips</th><th class="r">Outward</th><th class="r">Pending</th></tr></thead><tbody>' +
        days.slice().reverse().map(d => '<tr><td>' + new Date(d.date + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'}) + '</td><td class="r">' + d.in_trips + '</td><td class="r">' + tonnes(d.in_kg) + '</td><td class="r">' + d.out_trips + '</td><td class="r">' + tonnes(d.out_kg) + '</td><td class="r">' + d.pending + '</td></tr>').join('') + '</tbody></table>';
    }
    $('chart-table-toggle').addEventListener('click', e => {
      const on = $('chart-table').hidden;
      $('chart-table').hidden = !on; $('chart').hidden = on;
      e.target.textContent = on ? 'Show as chart' : 'Show as table'; e.target.setAttribute('aria-pressed', String(on));
      if (!on) chart();
    });
    window.addEventListener('resize', () => { if (!$('chart').hidden) chart(); });

    // trips of one day
    let tripRows = [], dir = '';
    $('trip-date').value = isoToday(); $('trip-date').max = isoToday();
    const loadTrips = () => get('/api/sites/' + sid + '/trips?date=' + $('trip-date').value).then(d => { tripRows = d.trips; drawTrips(); }).catch(() => {});
    function drawTrips() {
      const f = ($('trip-find').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const rows = tripRows.filter(r => (!dir || r.dir === dir) && (!f || (String(r.vno) + r.id).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(f)));
      $('trips').tBodies[0].innerHTML = rows.map(r => '<tr><td>' + esc((r.time || '').slice(11, 16)) + '</td><td><span class="dir ' + esc(r.dir) + '"></span>' + esc(r.id) + '</td><td><b>' + esc(r.vno) + '</b></td><td>' + esc(r.what) + '</td><td>' + esc(r.where) + '</td>' +
        '<td class="r">' + (kg(r.gross_kg) || '—') + '</td><td class="r">' + (kg(r.tare_kg) || '—') + '</td><td class="r">' + (r.net_kg == null ? '<span class="tag pending">Pending</span>' : '<b>' + kg(r.net_kg) + '</b>') + '</td><td>' + esc(r.operator) + '</td></tr>').join('') ||
        '<tr><td colspan="9" class="muted">No trips for this choice.</td></tr>';
      const done = rows.filter(r => r.net_kg != null);
      $('trip-count').textContent = trips(rows.length) + ' · net ' + tonnes(done.reduce((a, r) => a + r.net_kg, 0));
    }
    $('trip-date').addEventListener('change', loadTrips);
    $('trip-find').addEventListener('input', drawTrips);
    $('trip-dir').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; dir = b.dataset.d; document.querySelectorAll('#trip-dir button').forEach(x => x.classList.toggle('on', x === b)); drawTrips(); });

    loadSite(); loadLive(); loadDaily(); loadTrips();
    setInterval(loadLive, 3000);
    setInterval(() => { loadSite(); if ($('trip-date').value === isoToday()) loadTrips(); }, 60000);
  }

  if (document.body.dataset.page === 'overview') overview();
  if (document.body.dataset.page === 'site') site();
})();
