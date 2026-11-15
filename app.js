/* Site Risk Assessment — English Civil War reenactment sites.
 * Plain JavaScript, no build step. Data is kept on the phone in IndexedDB.
 */
'use strict';

// ---------- Risk scoring (5 x 5 matrix) ----------
const LIKELIHOOD = ['', '1 Rare', '2 Unlikely', '3 Possible', '4 Likely', '5 Almost certain'];
const SEVERITY = ['', '1 Negligible', '2 Minor', '3 Moderate', '4 Major', '5 Catastrophic'];
function band(score) {
  if (!score) return '';
  if (score <= 4) return 'low';
  if (score <= 12) return 'med';
  return 'high';
}
const BAND_LABEL = { low: 'Low', med: 'Medium', high: 'High' };

// ---------- Fixed lists ----------
const FEATURES = [
  { id: 'battle', icon: '⚔️', name: 'Battle area' },
  { id: 'crowd', icon: '🚧', name: 'Crowd line' },
  { id: 'camp', icon: '⛺', name: 'Camp' },
  { id: 'lh', icon: '🧺', name: 'Living history' },
  { id: 'powder', icon: '💥', name: 'Powder store' },
  { id: 'horses', icon: '🐎', name: 'Horse lines' },
  { id: 'fire', icon: '🧯', name: 'Fire point' },
  { id: 'firstaid', icon: '⛑️', name: 'First aid' },
  { id: 'rv', icon: '📍', name: 'Emergency RV point' },
  { id: 'access', icon: '🚑', name: 'Emergency access' },
  { id: 'parking', icon: '🅿️', name: 'Car park' },
  { id: 'toilets', icon: '🚻', name: 'Toilets / water' },
  { id: 'water', icon: '💧', name: 'Open water / ditch' },
  { id: 'power', icon: '⚡', name: 'Overhead lines' },
];
const LOG_TAGS = ['Rain', 'High wind', 'Lightning', 'Heat', 'Cold', 'Bigger crowd', 'Ground changed', 'Incident', 'Other'];
const ROLES = [['assessor', 'Assessor'], ['commander', 'Event commander / organiser']];
const INFO_FIELDS = [
  ['firstAid', 'First aid point', 'e.g. St John tent by the main gate'],
  ['hospital', 'Nearest A&E', 'Hospital name and distance'],
  ['rv', 'Emergency rendezvous point', 'Where ambulances are met and guided in'],
  ['casualtySignal', 'Real-casualty signal', 'How a real injury is signalled on the field'],
  ['stopSignal', 'Stop / cease-fire signal', ''],
  ['safetyOfficer', 'Safety officer and phone', ''],
  ['landowner', 'Landowner contact and rules', ''],
];

// ---------- Storage (IndexedDB) ----------
const DB_NAME = 'risk-assess';
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('assessments', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('assessments', mode);
    const req = fn(t.objectStore('assessments'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}
const store = {
  all: () => tx('readonly', (s) => s.getAll()),
  get: (id) => tx('readonly', (s) => s.get(id)),
  put: (a) => tx('readwrite', (s) => s.put(a)),
  del: (id) => tx('readwrite', (s) => s.delete(id)),
};
const settings = {
  get() { try { return JSON.parse(localStorage.getItem('ra-settings')) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem('ra-settings', JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- Helpers ----------
const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}
function fmtDateTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}
const slug = (s) => String(s || 'assessment').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'assessment';

let LIB = { activities: [], hazards: [] };
let current = null; // assessment being edited
let editor = null;  // open pin editor
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!current) return;
  current.updated = new Date().toISOString();
  try { await store.put(current); }
  catch (e) { alert('Could not save — the phone may be out of storage. ' + e.message); }
}

function normalize(a) {
  a.custom ||= []; a.photos ||= []; a.items ||= {}; a.activities ||= [];
  a.log ||= []; a.info ||= {}; a.signoff ||= {};
  for (const p of a.photos) p.pins ||= [];
  if (a.plan) a.plan.pins ||= [];
  return a;
}

// Downscale photos so dozens fit comfortably on the phone.
function resizeImage(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

function hazardsFor(a) {
  const lib = LIB.hazards.filter((h) => h.activities.some((x) => a.activities.includes(x)));
  return lib.concat(a.custom.map((h) => ({ ...h, custom: true })));
}
function hazardById(a, id) {
  return LIB.hazards.find((h) => h.id === id) || a.custom.find((h) => h.id === id);
}
function itemFor(a, id) {
  if (!a.items[id]) a.items[id] = { applies: true, L: 0, S: 0, extra: '', rL: 0, rS: 0 };
  return a.items[id];
}
const scoreOf = (it) => (it.rL * it.rS) || (it.L * it.S);
function applied(a) { return hazardsFor(a).filter((h) => itemFor(a, h.id).applies); }
function numbering(a) {
  const m = new Map();
  applied(a).forEach((h, i) => m.set(h.id, i + 1));
  return m;
}
function groupByArea(list) {
  const out = new Map();
  for (const h of list) {
    if (!out.has(h.area)) out.set(h.area, []);
    out.get(h.area).push(h);
  }
  return out;
}
function pinLabel(p, nums) {
  if (p.kind) return (FEATURES.find((f) => f.id === p.kind) || {}).icon || '•';
  return nums.get(p.ref) || '?';
}
function pinName(a, p) {
  if (p.kind) return (FEATURES.find((f) => f.id === p.kind) || {}).name || 'Marker';
  return (hazardById(a, p.ref) || {}).hazard || 'Hazard no longer in the list';
}
function pinnedImage(src, pins, nums, extra = '') {
  return `<div class="pinwrap">
    <img src="${src}" alt="">
    ${pins.map((p) => `<span class="pin ${p.kind ? 'feat' : ''}" style="left:${p.x}%;top:${p.y}%">${esc(pinLabel(p, nums))}</span>`).join('')}
    ${extra}
  </div>`;
}

// ---------- Weather (Open-Meteo, no key needed) ----------
function wmo(c) {
  if (c === 0) return 'Clear';
  if (c <= 3) return 'Partly cloudy';
  if (c <= 48) return 'Fog';
  if (c <= 57) return 'Drizzle';
  if (c <= 67) return 'Rain';
  if (c <= 77) return 'Snow';
  if (c <= 82) return 'Showers';
  if (c <= 86) return 'Snow showers';
  return 'Thunderstorms';
}
function weatherFlags(w) {
  const f = [];
  if (w.tmax >= 24) f.push(`Hot (${Math.round(w.tmax)}°C): check heat exhaustion controls — water on the field, shorter battle, shade.`);
  if (w.tmin <= 5) f.push(`Cold (${Math.round(w.tmin)}°C overnight): check cold and wet weather controls for campers.`);
  if (w.rain >= 5) f.push(`Wet (${w.rain} mm rain): re-walk the field for mud, slopes and waterlogged entrances.`);
  if (w.gust >= 35) f.push(`Windy (gusts ${Math.round(w.gust)} mph): secure tents and gazebos; lower pikes and colours.`);
  if (w.code >= 95) f.push('Thunderstorms forecast: agree the lightning stop procedure before the battle.');
  return f;
}
function weatherHtml(a) {
  const w = a.weather;
  if (!w) return '<p class="muted">Record the site location and set the date, then get the forecast.</p>';
  if (w.error) return `<p class="err">${esc(w.error)}</p>`;
  const flags = weatherFlags(w);
  return `<div class="wx">
    <strong>${fmtDate(w.date)}: ${wmo(w.code)}</strong>
    <div>${Math.round(w.tmin)}–${Math.round(w.tmax)}°C · rain ${w.rain} mm · gusts ${Math.round(w.gust)} mph</div>
    <div class="muted">Open-Meteo forecast, fetched ${fmtDateTime(w.at)}</div>
    ${flags.length ? `<ul class="flags">${flags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
async function fetchWeather() {
  const a = current;
  if (!a.geo) return alert('Record the site location first (📍 in Event details).');
  if (!a.date) return alert('Set the event date first.');
  const days = Math.round((new Date(a.date + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5);
  if (days < 0 || days > 15) {
    a.weather = { error: 'A forecast is only available from today up to 15 days before the event.' };
  } else {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.geo.lat}&longitude=${a.geo.lon}` +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max' +
      `&wind_speed_unit=mph&timezone=Europe%2FLondon&start_date=${a.date}&end_date=${a.date}`;
    try {
      const j = await (await fetch(url)).json();
      const d = j.daily;
      if (!d) throw new Error(j.reason || 'no data');
      a.weather = { date: a.date, at: new Date().toISOString(), code: d.weather_code[0],
        tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0], rain: d.precipitation_sum[0], gust: d.wind_gusts_10m_max[0] };
    } catch (e) {
      a.weather = { error: 'Could not get the forecast (' + e.message + '). Check you have signal.' };
    }
  }
  await store.put(a);
  if (current === a) rerender();
}

// ---------- Photo hazard spotting ----------
async function spotHazards(photoId) {
  const st = settings.get();
  if (!st.aiUrl) {
    alert('Photo hazard spotting needs setting up once. Opening Settings.');
    location.hash = '#/settings';
    return;
  }
  const a = current;
  const p = a.photos.find((x) => x.id === photoId);
  if (!p) return;
  p.ai = { status: 'working' };
  rerender();
  try {
    const hazards = hazardsFor(a).map((h) => ({ id: h.id, area: h.area, hazard: h.hazard }));
    const activities = LIB.activities.filter((x) => a.activities.includes(x.id)).map((x) => x.name);
    const res = await fetch(st.aiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: st.aiCode || '', image: p.dataUrl.split(',')[1], note: p.note, activities, hazards }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'error ' + res.status);
    p.ai = { status: 'done', at: new Date().toISOString(),
      suggestions: (data.suggestions || []).map((s) => ({ ...s, sid: uid(), state: 'new' })) };
  } catch (e) {
    p.ai = { status: 'error', error: e.message === 'Failed to fetch' ? 'no connection to the relay' : e.message };
  }
  a.updated = new Date().toISOString();
  await store.put(a);
  if (current === a) rerender();
}
function suggTitle(a, s) {
  const h = s.hazardId && hazardById(a, s.hazardId);
  return h ? h.hazard : (s.title || 'Hazard');
}
function acceptSuggestion(a, p, s) {
  let id = s.hazardId && hazardById(a, s.hazardId) ? s.hazardId : null;
  if (!id) {
    id = 'c-' + uid();
    a.custom.push({ id, area: 'Spotted in photos', hazard: s.title || 'Hazard', who: s.who || '', controls: s.controls || '', activities: [] });
  }
  const it = itemFor(a, id);
  it.applies = true;
  const line = `Photo ${a.photos.indexOf(p) + 1}: ${s.reason || 'seen on site'}`;
  if (!it.extra.includes(line)) it.extra = (it.extra ? it.extra + '\n' : '') + line;
  if (typeof s.x === 'number' && typeof s.y === 'number') p.pins.push({ id: uid(), x: clamp(s.x), y: clamp(s.y), ref: id });
  s.state = 'accepted';
}
function aiBlock(a, p) {
  if (!p.ai) return '';
  if (p.ai.status === 'working') return '<div class="ai muted">✨ Looking for hazards…</div>';
  if (p.ai.status === 'error') return `<div class="ai err">Couldn't check this photo: ${esc(p.ai.error)}</div>`;
  const all = p.ai.suggestions || [];
  if (!all.length) return '<div class="ai muted">No hazards spotted in this photo.</div>';
  const open = all.filter((s) => s.state === 'new');
  const added = all.filter((s) => s.state === 'accepted').length;
  return `<div class="ai">
    ${open.map((s) => `
      <div class="sugg">
        <div><strong>${esc(suggTitle(a, s))}</strong>${s.hazardId && hazardById(a, s.hazardId) ? '' : ' <span class="tag">new hazard</span>'}</div>
        <div class="muted">${esc(s.reason)}</div>
        <div class="row">
          <button class="btn small" data-action="ai-accept" data-id="${p.id}" data-sid="${s.sid}">✓ Add</button>
          <button class="btn small secondary" data-action="ai-dismiss" data-id="${p.id}" data-sid="${s.sid}">✕ Not relevant</button>
        </div>
      </div>`).join('')}
    <div class="muted">✨ ${all.length} suggested · ${added} added${open.length ? '' : ' · all reviewed'}</div>
  </div>`;
}

// ---------- Views ----------
async function viewHome() {
  current = null;
  const list = (await store.all()).map(normalize).sort((x, y) => (y.updated || '').localeCompare(x.updated || ''));
  $app.innerHTML = `
    <h1>Assessments</h1>
    <p class="muted">Walk the site, photograph each area, score the hazards, then print the report and share the briefing.</p>
    ${list.length ? list.map((a) => {
      const signed = ROLES.filter(([r]) => a.signoff[r]).length;
      return `
      <a class="card row listitem" href="#/a/${a.id}">
        <div class="grow">
          <div class="hazard-title">${esc(a.event || 'Untitled event')}</div>
          <div class="muted">${esc(a.site)} ${a.date ? '· ' + fmtDate(a.date) : ''} · ${a.photos.length} photo${a.photos.length === 1 ? '' : 's'}${signed ? ` · ✍️ ${signed}/${ROLES.length} signed` : ''}</div>
        </div>
        <span aria-hidden="true">›</span>
      </a>`; }).join('') : '<div class="card muted">No assessments yet.</div>'}
    <label class="btn secondary">⬆️ Import an assessment<input type="file" accept=".json,application/json" data-action="import" hidden></label>
    <div class="fab"><div class="row"><button class="btn grow" data-action="new">+ New assessment</button></div></div>`;
}

function viewSettings() {
  current = null;
  const st = settings.get();
  $app.innerHTML = `
    <h1>Settings</h1>
    <section class="card">
      <h3 style="margin-top:0">✨ Photo hazard spotting</h3>
      <p class="muted">An AI vision model looks at each photo and suggests hazards from your checklist. It needs a small relay service set up once (free on Cloudflare) — the steps are in <strong>worker/README.md</strong> in the GitHub repository.</p>
      <label for="s-url">Relay address</label>
      <input id="s-url" type="url" data-setting="aiUrl" value="${esc(st.aiUrl)}" placeholder="https://risk-ai.yourname.workers.dev">
      <label for="s-code">Access code</label>
      <input id="s-code" type="text" data-setting="aiCode" value="${esc(st.aiCode)}" autocomplete="off">
      <div class="row" style="margin-top:10px"><button class="btn secondary" data-action="test-ai">Test connection</button><span id="ai-test" class="muted"></span></div>
    </section>
    <section class="card">
      <h3 style="margin-top:0">Defaults</h3>
      <label for="s-name">Your name (filled in as assessor)</label>
      <input id="s-name" type="text" data-setting="assessor" value="${esc(st.assessor)}">
    </section>
    <section class="card">
      <h3 style="margin-top:0">Hazard library</h3>
      <p class="muted">${LIB.hazards.length} hazards across ${LIB.activities.length} activities. ${esc(LIB.note || '')}</p>
    </section>
    <div class="fab"><div class="row"><a class="btn grow" href="#/">Done</a></div></div>`;
}

function viewEdit() {
  const a = current;
  const hz = hazardsFor(a);
  const groups = groupByArea(hz);
  const nums = numbering(a);
  const ap = applied(a);
  const scored = ap.filter((h) => a.items[h.id].L && a.items[h.id].S).length;
  const pct = ap.length ? Math.round((scored / ap.length) * 100) : 0;
  const opts = (labels) => labels.map((l, i) => `<option value="${i}">${i ? l : '–'}</option>`).join('');
  $app.innerHTML = `
    <h1>${esc(a.event || 'New assessment')}</h1>
    ${a.copiedFrom ? `<div class="card banner">Copied from <strong>${esc(a.copiedFrom.event || 'an earlier event')}</strong>${a.copiedFrom.date ? ' (' + fmtDate(a.copiedFrom.date) + ')' : ''}. Re-walk the site and check every score before signing.
      <button class="btn small secondary" data-action="dismiss-copy">Got it</button></div>` : ''}
    <div class="progress" aria-label="${pct}% scored"><div style="width:${pct}%"></div></div>
    <p class="muted">${scored} of ${ap.length} hazards scored · ${a.photos.length} photo${a.photos.length === 1 ? '' : 's'} · ${ROLES.filter(([r]) => a.signoff[r]).length}/${ROLES.length} signed</p>
    <nav class="jump no-print">
      ${[['sec-details', 'Details'], ['sec-photos', 'Photos'], ['sec-plan', 'Site plan'], ['sec-hazards', 'Hazards'], ['sec-info', 'Key info'], ['sec-day', 'On the day'], ['sec-sign', 'Sign-off']]
        .map(([id, l]) => `<button class="chip" data-action="jump" data-to="${id}">${l}</button>`).join('')}
    </nav>

    <h2 id="sec-details">Event details</h2>
    <section class="card">
      <label for="f-event">Event</label>
      <input id="f-event" type="text" data-field="event" value="${esc(a.event)}" placeholder="e.g. Battle of Newbury muster">
      <label for="f-site">Site / location</label>
      <input id="f-site" type="text" data-field="site" value="${esc(a.site)}">
      <div class="row">
        <div class="grow"><label for="f-date">Date</label><input id="f-date" type="date" data-field="date" value="${esc(a.date)}"></div>
        <div class="grow"><label for="f-assessor">Assessed by</label><input id="f-assessor" type="text" data-field="assessor" value="${esc(a.assessor)}"></div>
      </div>
      <label>Site position</label>
      <div class="row">
        <span class="grow ${a.geo ? '' : 'muted'}">${a.geo ? `${a.geo.lat}, ${a.geo.lon} · <a href="https://www.google.com/maps?q=${a.geo.lat},${a.geo.lon}" target="_blank" rel="noopener">map</a>` : 'Not recorded'}</span>
        <button class="btn small secondary" data-action="geo">📍 ${a.geo ? 'Update' : 'Use my location'}</button>
      </div>
      <label>Activities on this site</label>
      <div class="chips">
        ${LIB.activities.map((act) => `
          <label class="chip"><input type="checkbox" data-activity="${act.id}" ${a.activities.includes(act.id) ? 'checked' : ''}> ${esc(act.name)}</label>`).join('')}
      </div>
    </section>

    <h2 id="sec-photos">Site photos</h2>
    <section class="card">
      <div class="row no-print" style="margin-bottom:10px">
        <label class="btn" style="margin:0">📷 Take photo<input type="file" accept="image/*" capture="environment" data-action="add-photo" hidden></label>
        <label class="btn secondary" style="margin:0">Upload<input type="file" accept="image/*" multiple data-action="add-photo" hidden></label>
      </div>
      <div class="photos">
        ${a.photos.map((p, i) => `
          <div class="photo">
            ${pinnedImage(p.dataUrl, p.pins, nums, `<span class="photo-no">Photo ${i + 1}</span>`)}
            <div class="photo-tools">
              <button class="btn small secondary" data-action="pins" data-id="${p.id}">📌 Mark hazards</button>
              <button class="btn small" data-action="ai" data-id="${p.id}" ${p.ai && p.ai.status === 'working' ? 'disabled' : ''}>✨ Spot hazards</button>
            </div>
            <textarea data-photo-note="${p.id}" placeholder="What does this show?">${esc(p.note)}</textarea>
            ${aiBlock(a, p)}
            <button class="btn small danger" data-action="del-photo" data-id="${p.id}">Remove photo</button>
          </div>`).join('') || '<p class="muted">No photos yet. Walk the site and photograph each area: battle ground, crowd line, camp, powder store, access routes.</p>'}
      </div>
    </section>

    <h2 id="sec-plan">Site plan</h2>
    <section class="card">
      ${a.plan ? `
        ${pinnedImage(a.plan.dataUrl, a.plan.pins, nums)}
        <div class="row" style="margin-top:10px">
          <button class="btn small" data-action="pins" data-id="plan">📌 Add markers</button>
          <label class="btn small secondary" style="margin:0">Replace image<input type="file" accept="image/*" data-action="plan-image" hidden></label>
          <button class="btn small danger" data-action="del-plan">Remove</button>
        </div>
        ${legend(a, a.plan.pins, nums)}` : `
        <p class="muted">Add a satellite screenshot of the field (from Google Maps), a sketch, or the organiser's plan. Then mark the battle area, crowd line, camp, powder store, fire points, first aid and emergency access.</p>
        <label class="btn">🗺️ Add site plan image<input type="file" accept="image/*" data-action="plan-image" hidden></label>`}
    </section>

    <h2 id="sec-hazards">Hazards</h2>
    ${hz.length ? '' : '<p class="muted">Choose at least one activity above to load the hazard checklist.</p>'}
    ${[...groups].map(([area, list]) => `
      <h3>${esc(area)}</h3>
      ${list.map((h) => hazardCard(a, h, nums)).join('')}`).join('')}

    <section class="card no-print">
      <h3 style="margin-top:0">Add your own hazard</h3>
      <label for="c-hazard">Hazard</label><input id="c-hazard" type="text">
      <label for="c-who">Who could be harmed</label><input id="c-who" type="text">
      <label for="c-controls">Controls</label><textarea id="c-controls"></textarea>
      <button class="btn secondary" data-action="add-custom" style="margin-top:10px">Add hazard</button>
    </section>

    <h2 id="sec-info">Emergency and key information</h2>
    <section class="card">
      ${INFO_FIELDS.map(([k, l, ph]) => `<label for="i-${k}">${l}</label><input id="i-${k}" type="text" data-info="${k}" value="${esc(a.info[k])}" placeholder="${esc(ph)}">`).join('')}
      <label for="f-notes">Other notes</label>
      <textarea id="f-notes" data-field="notes" placeholder="Anything else people need to know">${esc(a.notes)}</textarea>
    </section>

    <h2 id="sec-day">On the day</h2>
    <section class="card">
      <h3 style="margin-top:0">⛅ Weather</h3>
      ${weatherHtml(a)}
      <button class="btn small secondary" data-action="weather" style="margin-top:8px">${a.weather && !a.weather.error ? 'Refresh' : 'Get'} forecast</button>
    </section>
    <section class="card">
      <h3 style="margin-top:0">Conditions log</h3>
      <p class="muted">Record anything that changes during the event and what you did about it.</p>
      ${a.log.map((e) => logEntry(a, e, nums, true)).join('')}
      <div class="logform">
        <div class="row">
          <div><label for="l-time">Time</label><input id="l-time" type="time" value="${nowTime()}"></div>
        </div>
        <label>What changed</label>
        <div class="chips">${LOG_TAGS.map((t) => `<label class="chip"><input type="checkbox" data-logtag value="${esc(t)}"> ${esc(t)}</label>`).join('')}</div>
        <label for="l-note">Details</label><textarea id="l-note"></textarea>
        <label for="l-action">Action taken</label><textarea id="l-action"></textarea>
        <label for="l-hazard">Re-score a hazard (optional)</label>
        <select id="l-hazard"><option value="">–</option>${ap.map((h) => `<option value="${h.id}">${nums.get(h.id)}. ${esc(h.hazard)}</option>`).join('')}</select>
        <div class="grid2">
          <div><label for="l-L">New likelihood</label><select id="l-L">${opts(LIKELIHOOD)}</select></div>
          <div><label for="l-S">New severity</label><select id="l-S">${opts(SEVERITY)}</select></div>
        </div>
        <button class="btn" data-action="add-log" style="margin-top:10px">Add to log</button>
      </div>
    </section>

    <h2 id="sec-sign">Sign-off</h2>
    ${ROLES.map(([role, label]) => {
      const s = a.signoff[role];
      return `<section class="card">
        <h3 style="margin-top:0">${label}</h3>
        ${s ? `<img class="sig" src="${s.sig}" alt="Signature of ${esc(s.name)}">
          <div>${esc(s.name)} · ${fmtDateTime(s.at)}</div>
          <button class="btn small secondary" data-action="sig-clear" data-role="${role}" style="margin-top:8px">Remove and re-sign</button>` : `
          <label for="sig-name-${role}">Name</label>
          <input id="sig-name-${role}" type="text" value="${esc(role === 'assessor' ? a.assessor : '')}">
          <label>Sign with your finger</label>
          <canvas class="sigpad" data-sig="${role}"></canvas>
          <div class="row" style="margin-top:8px">
            <button class="btn small secondary" data-action="sig-reset" data-role="${role}">Clear</button>
            <button class="btn small" data-action="sig-save" data-role="${role}">Save signature</button>
          </div>`}
      </section>`; }).join('')}

    <h2>This assessment</h2>
    <section class="card row">
      <button class="btn secondary" data-action="copy">📋 Copy for a new event</button>
      <button class="btn secondary" data-action="export">⬇️ Export / send</button>
      <button class="btn danger" data-action="delete">Delete</button>
    </section>

    <div class="fab"><div class="row">
      <a class="btn secondary" href="#/">Back</a>
      <a class="btn secondary grow" href="#/b/${a.id}">Briefing</a>
      <a class="btn grow" href="#/r/${a.id}">Report</a>
    </div></div>`;
  initSigPads();
}

function legend(a, pins, nums) {
  if (!pins.length) return '';
  return `<ul class="legend">${pins.map((p) => `<li><span class="pin static ${p.kind ? 'feat' : ''}">${esc(pinLabel(p, nums))}</span> ${esc(pinName(a, p))}</li>`).join('')}</ul>`;
}

function logEntry(a, e, nums, editable) {
  const h = e.hazardId && hazardById(a, e.hazardId);
  return `<div class="logentry">
    <div><strong>${esc(e.time)}</strong> ${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
    ${e.note ? `<div>${esc(e.note)}</div>` : ''}
    ${e.action ? `<div><em>Action:</em> ${esc(e.action)}</div>` : ''}
    ${h ? `<div class="muted">Re-scored ${nums.get(e.hazardId) ? nums.get(e.hazardId) + '. ' : ''}${esc(h.hazard)}: <span class="score ${band(e.from)}">${e.from || '–'}</span> → <span class="score ${band(e.to)}">${e.to}</span></div>` : ''}
    ${editable ? `<button class="btn small secondary no-print" data-action="del-log" data-id="${e.id}">Remove</button>` : ''}
  </div>`;
}

function hazardCard(a, h, nums) {
  const it = itemFor(a, h.id);
  const s = it.L * it.S;
  const rs = it.rL * it.rS;
  const b = band(rs || s);
  const opts = (labels, v) => labels.map((l, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${i ? l : '–'}</option>`).join('');
  return `
    <div class="card hazard ${it.applies ? (b ? 'r-' + b : '') : 'na'}" data-hazard="${h.id}">
      <div class="row">
        ${it.applies ? `<span class="num">${nums.get(h.id)}</span>` : ''}
        <div class="grow hazard-title">${esc(h.hazard)}</div>
        <label class="chip" style="padding:4px 10px"><input type="checkbox" data-applies ${it.applies ? 'checked' : ''}> Applies</label>
      </div>
      ${it.applies ? `
        ${h.who ? `<div class="muted">Who: ${esc(h.who)}</div>` : ''}
        ${h.controls ? `<div class="muted">Standard controls: ${esc(h.controls)}</div>` : ''}
        <div class="grid3">
          <div><label>Likelihood</label><select data-k="L">${opts(LIKELIHOOD, it.L)}</select></div>
          <div><label>Severity</label><select data-k="S">${opts(SEVERITY, it.S)}</select></div>
          <div><span class="score ${band(s)}">${s || '–'}</span></div>
        </div>
        <label>Extra controls for this site</label>
        <textarea data-k="extra" placeholder="Anything specific you saw on site">${esc(it.extra)}</textarea>
        <div class="grid3">
          <div><label>Residual likelihood</label><select data-k="rL">${opts(LIKELIHOOD, it.rL)}</select></div>
          <div><label>Residual severity</label><select data-k="rS">${opts(SEVERITY, it.rS)}</select></div>
          <div><span class="score ${band(rs)}">${rs || '–'}</span></div>
        </div>
        ${h.custom ? `<button class="btn small danger no-print" data-action="del-custom" data-id="${h.id}" style="margin-top:8px">Remove</button>` : ''}
      ` : ''}
    </div>`;
}

function infoRows(a) {
  return INFO_FIELDS.filter(([k]) => a.info[k]).map(([k, l]) => `<tr><th>${l}</th><td>${esc(a.info[k])}</td></tr>`).join('');
}

function viewReport() {
  const a = current;
  const rows = applied(a);
  const nums = numbering(a);
  const counts = { low: 0, med: 0, high: 0, unscored: 0 };
  for (const h of rows) counts[band(scoreOf(a.items[h.id])) || 'unscored']++;
  const actNames = LIB.activities.filter((x) => a.activities.includes(x.id)).map((x) => x.name).join(', ');
  const info = infoRows(a);
  $app.innerHTML = `
    <div class="report">
      <h1>Risk assessment: ${esc(a.event || 'Untitled event')}</h1>
      <table>
        <tr><th>Site</th><td>${esc(a.site)}</td><th>Date</th><td>${fmtDate(a.date)}</td></tr>
        <tr><th>Assessed by</th><td>${esc(a.assessor)}</td><th>Activities</th><td>${esc(actNames)}</td></tr>
        ${a.geo ? `<tr><th>Position</th><td colspan="3">${a.geo.lat}, ${a.geo.lon}</td></tr>` : ''}
      </table>
      <h2>Summary</h2>
      <div class="summary">
        <span class="score high">${counts.high} High</span>
        <span class="score med">${counts.med} Medium</span>
        <span class="score low">${counts.low} Low</span>
        ${counts.unscored ? `<span class="score">${counts.unscored} not scored</span>` : ''}
      </div>
      <p class="muted">Risk = likelihood × severity (1–5 each). 1–4 Low, 5–12 Medium, 15–25 High. Summary uses the residual score where given.</p>

      ${info ? `<h2>Emergency and key information</h2><table>${info}</table>` : ''}
      ${a.weather && !a.weather.error ? `<h2>Weather</h2>${weatherHtml(a)}` : ''}

      <h2>Hazards</h2>
      <table>
        <thead><tr><th>#</th><th>Hazard</th><th>Who</th><th>Risk</th><th>Controls</th><th>Residual</th></tr></thead>
        <tbody>
        ${rows.map((h) => {
          const it = a.items[h.id];
          const s = it.L * it.S, rs = it.rL * it.rS;
          return `<tr>
            <td>${nums.get(h.id)}</td>
            <td><strong>${esc(h.hazard)}</strong><div class="muted">${esc(h.area)}</div></td>
            <td>${esc(h.who)}</td>
            <td><span class="score ${band(s)}">${s || '–'}</span></td>
            <td>${esc(h.controls)}${it.extra ? `<br><strong>On this site:</strong> ${esc(it.extra).replace(/\n/g, '<br>')}` : ''}</td>
            <td><span class="score ${band(rs)}">${rs || '–'}</span></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>

      ${a.plan ? `<h2>Site plan</h2><div class="plan">${pinnedImage(a.plan.dataUrl, a.plan.pins, nums)}</div>${legend(a, a.plan.pins, nums)}` : ''}

      ${a.photos.length ? `<h2>Site photos</h2>
      <p class="muted">Numbered markers refer to the hazard numbers above.</p>
      <div class="photos">${a.photos.map((p, i) => `
        <div class="photo">${pinnedImage(p.dataUrl, p.pins, nums)}<div style="padding:6px"><strong>Photo ${i + 1}.</strong> <span class="muted">${esc(p.note)}</span></div></div>`).join('')}
      </div>` : ''}

      ${a.notes ? `<h2>Other notes</h2><p>${esc(a.notes).replace(/\n/g, '<br>')}</p>` : ''}

      ${a.log.length ? `<h2>On-the-day log</h2>${a.log.map((e) => logEntry(a, e, nums, false)).join('')}` : ''}

      <h2>Sign-off</h2>
      <table>
        ${ROLES.map(([role, label]) => {
          const s = a.signoff[role];
          return `<tr><th>${label}</th><td>${s ? esc(s.name) : ''}</td><td style="height:56px">${s ? `<img class="sig small" src="${s.sig}" alt="Signature">` : ''}</td><td>${s ? fmtDateTime(s.at) : ''}</td></tr>`;
        }).join('')}
      </table>
    </div>
    <div class="fab"><div class="row">
      <a class="btn secondary" href="#/a/${a.id}">Edit</a>
      <button class="btn grow" data-action="print">Print / Save as PDF</button>
    </div></div>`;
}

function briefingRisks(a) {
  return applied(a)
    .map((h) => ({ h, it: a.items[h.id], sc: scoreOf(a.items[h.id]), first: a.items[h.id].L * a.items[h.id].S }))
    .filter((r) => r.first >= 5 || r.sc >= 5)
    .sort((x, y) => (y.first - x.first) || (y.sc - x.sc))
    .slice(0, 12);
}
function viewBriefing() {
  const a = current;
  const nums = numbering(a);
  const risks = briefingRisks(a);
  const info = infoRows(a);
  $app.innerHTML = `
    <div class="report briefing">
      <h1>Safety briefing</h1>
      <p><strong>${esc(a.event || 'Untitled event')}</strong><br>${esc(a.site)}${a.date ? ' · ' + fmtDate(a.date) : ''}</p>
      ${info ? `<h2>Key information</h2><table>${info}</table>` : '<p class="muted">Add first aid, A&E, signals and contacts under Key info to show them here.</p>'}
      ${a.weather && !a.weather.error ? `<h2>Weather</h2>${weatherHtml(a)}` : ''}
      <h2>Main risks and what we're doing about them</h2>
      ${risks.length ? `<ol class="risks">${risks.map(({ h, it, first }) => `
        <li><span class="score ${band(first)}">${BAND_LABEL[band(first)]}</span> <strong>${esc(h.hazard)}</strong>
          <div>${esc(h.controls)}</div>
          ${it.extra ? `<div><em>On this site:</em> ${esc(it.extra).replace(/\n/g, '<br>')}</div>` : ''}</li>`).join('')}</ol>`
        : '<p class="muted">Score the hazards to list the main risks here (medium and high).</p>'}
      ${a.plan ? `<h2>Site plan</h2><div class="plan">${pinnedImage(a.plan.dataUrl, a.plan.pins, nums)}</div>${legend(a, a.plan.pins, nums)}` : ''}
      ${a.log.length ? `<h2>Changes today</h2>${a.log.map((e) => logEntry(a, e, nums, false)).join('')}` : ''}
    </div>
    <div class="fab"><div class="row">
      <a class="btn secondary" href="#/a/${a.id}">Edit</a>
      <button class="btn secondary grow" data-action="print">Print</button>
      <button class="btn grow" data-action="share-brief">Share</button>
    </div></div>`;
}
function briefingText(a) {
  const L = [];
  L.push(`SAFETY BRIEFING: ${a.event || 'Untitled event'}`);
  L.push([a.site, fmtDate(a.date)].filter(Boolean).join(' · '));
  const w = a.weather;
  if (w && !w.error) L.push('', `Weather: ${wmo(w.code)}, ${Math.round(w.tmin)}–${Math.round(w.tmax)}°C, rain ${w.rain} mm, gusts ${Math.round(w.gust)} mph`);
  const info = INFO_FIELDS.filter(([k]) => a.info[k]);
  if (info.length) { L.push('', 'KEY INFORMATION'); for (const [k, l] of info) L.push(`${l}: ${a.info[k]}`); }
  const risks = briefingRisks(a);
  if (risks.length) {
    L.push('', 'MAIN RISKS');
    risks.forEach(({ h, it, first }, i) => {
      L.push(`${i + 1}. ${h.hazard} (${BAND_LABEL[band(first)]})`, `   ${h.controls}`);
      if (it.extra) L.push(`   On this site: ${it.extra.replace(/\n/g, '; ')}`);
    });
  }
  if (a.log.length) {
    L.push('', 'CHANGES TODAY');
    for (const e of a.log) L.push(`${e.time} ${e.tags.join(', ')}${e.note ? ': ' + e.note : ''}${e.action ? ' Action: ' + e.action : ''}`);
  }
  return L.join('\n');
}

// ---------- Pin editor (photos and site plan) ----------
function editorSubject() {
  if (!editor || !current) return null;
  return editor.target === 'plan' ? current.plan : current.photos.find((p) => p.id === editor.id);
}
function openEditor(id) {
  editor = { target: id === 'plan' ? 'plan' : 'photo', id, pending: null };
  renderEditor();
}
function closeEditor(redraw = true) {
  editor = null;
  $modal.hidden = true;
  $modal.innerHTML = '';
  document.body.classList.remove('modal-open');
  if (redraw && current) rerender();
}
function renderEditor() {
  const s = editorSubject();
  if (!s) return closeEditor();
  const a = current;
  const nums = numbering(a);
  const ap = applied(a);
  const pend = editor.pending;
  const ghost = pend ? `<span class="pin ghost" style="left:${pend.x}%;top:${pend.y}%">+</span>` : '';
  $modal.innerHTML = `
    <div class="sheet">
      <div class="row">
        <strong class="grow">${editor.target === 'plan' ? 'Site plan' : 'Photo ' + (a.photos.indexOf(s) + 1)}: tap where the marker goes</strong>
        <button class="btn small" data-m="close">Done</button>
      </div>
      <div class="tapzone" data-m="tap">${pinnedImage(s.dataUrl, s.pins, nums, ghost)}</div>
      ${pend ? `
        <label for="pin-pick">What is here?</label>
        <select id="pin-pick">
          <option value="">Choose…</option>
          ${editor.target === 'plan' ? `<optgroup label="Site features">${FEATURES.map((f) => `<option value="f:${f.id}">${f.icon} ${esc(f.name)}</option>`).join('')}</optgroup>` : ''}
          <optgroup label="Hazards">${ap.map((h) => `<option value="h:${h.id}">${nums.get(h.id)}. ${esc(h.hazard)}</option>`).join('')}</optgroup>
        </select>
        <div class="row" style="margin-top:8px">
          <button class="btn grow" data-m="add">Add marker</button>
          <button class="btn secondary" data-m="cancel">Cancel</button>
        </div>` : ''}
      ${s.pins.length ? `<ul class="legend">${s.pins.map((p) => `
        <li><span class="pin static ${p.kind ? 'feat' : ''}">${esc(pinLabel(p, nums))}</span> <span class="grow">${esc(pinName(a, p))}</span>
          <button class="btn small secondary" data-m="rm" data-id="${p.id}">Remove</button></li>`).join('')}</ul>`
        : '<p class="muted">No markers yet.</p>'}
    </div>`;
  $modal.hidden = false;
  document.body.classList.add('modal-open');
}
$modal.addEventListener('click', async (e) => {
  const s = editorSubject();
  if (!s) return closeEditor();
  if (e.target === $modal) return closeEditor();
  const b = e.target.closest('[data-m]');
  if (!b) return;
  const m = b.dataset.m;
  if (m === 'close') closeEditor();
  else if (m === 'tap') {
    const img = b.querySelector('img');
    const r = img.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    editor.pending = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    renderEditor();
  } else if (m === 'add') {
    const v = document.getElementById('pin-pick').value;
    if (!v) return alert('Choose what the marker shows.');
    const [kind, id] = [v.slice(0, 1), v.slice(2)];
    s.pins.push({ id: uid(), x: editor.pending.x, y: editor.pending.y, ...(kind === 'f' ? { kind: id } : { ref: id }) });
    editor.pending = null;
    await saveNow(); renderEditor();
  } else if (m === 'cancel') {
    editor.pending = null; renderEditor();
  } else if (m === 'rm') {
    s.pins = s.pins.filter((p) => p.id !== b.dataset.id);
    await saveNow(); renderEditor();
  }
});

// ---------- Signature pads ----------
function initSigPads() {
  document.querySelectorAll('canvas.sigpad').forEach((c) => {
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1b1410';
    let drawing = false;
    const pos = (e) => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    c.addEventListener('pointerdown', (e) => {
      drawing = true; c.setPointerCapture(e.pointerId);
      const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.1, p.y + 0.1); g.stroke();
      c.dataset.dirty = '1';
    });
    c.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); });
    const end = () => { drawing = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  });
}

// ---------- Export / import ----------
async function exportAssessment(a) {
  const name = `${slug(a.event)}${a.date ? '-' + a.date : ''}.json`;
  const blob = new Blob([JSON.stringify({ type: 'site-risk-assessment', version: 2, assessment: a })], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: a.event || 'Risk assessment' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function importAssessment(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('That file is not an assessment export.'); }
  const a = data && data.type === 'site-risk-assessment' && data.assessment;
  if (!a || !a.id) return alert('That file is not an assessment export.');
  normalize(a);
  if (await store.get(a.id)) {
    if (!confirm('You already have this assessment. Import it as a separate copy?')) return;
    a.id = uid();
  }
  a.updated = new Date().toISOString();
  await store.put(a);
  location.hash = '#/a/' + a.id;
}

// ---------- Events ----------
$app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.setting) { const st = settings.get(); st[t.dataset.setting] = t.value.trim(); settings.set(st); return; }
  if (!current) return;
  if (t.dataset.field) { current[t.dataset.field] = t.value; saveSoon(); return; }
  if (t.dataset.info) { current.info[t.dataset.info] = t.value; saveSoon(); return; }
  if (t.dataset.photoNote) {
    const p = current.photos.find((x) => x.id === t.dataset.photoNote);
    if (p) { p.note = t.value; saveSoon(); }
    return;
  }
  const card = t.closest('[data-hazard]');
  if (card && t.dataset.k === 'extra') { itemFor(current, card.dataset.hazard).extra = t.value; saveSoon(); }
});

$app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.action === 'import' && t.files.length) { await importAssessment(t.files[0]); t.value = ''; return; }
  if (!current) return;
  if (t.dataset.activity) {
    const id = t.dataset.activity;
    current.activities = t.checked ? [...new Set([...current.activities, id])] : current.activities.filter((x) => x !== id);
    await saveNow(); rerender(); return;
  }
  if (t.dataset.action === 'add-photo' && t.files.length) {
    for (const f of t.files) {
      try { current.photos.push({ id: uid(), dataUrl: await resizeImage(f), note: '', pins: [] }); }
      catch (err) { alert(err.message); }
    }
    t.value = '';
    await saveNow(); rerender(); return;
  }
  if (t.dataset.action === 'plan-image' && t.files.length) {
    try {
      const dataUrl = await resizeImage(t.files[0], 1800, 0.82);
      current.plan = { dataUrl, pins: current.plan ? current.plan.pins : [] };
    } catch (err) { alert(err.message); }
    t.value = '';
    await saveNow(); rerender(); return;
  }
  if (t.dataset.field === 'date' && current.weather) { current.weather = null; await saveNow(); rerender(); return; }
  const card = t.closest('[data-hazard]');
  if (!card) return;
  const it = itemFor(current, card.dataset.hazard);
  if ('applies' in t.dataset) it.applies = t.checked;
  else if (['L', 'S', 'rL', 'rS'].includes(t.dataset.k)) it[t.dataset.k] = Number(t.value);
  else return;
  await saveNow(); rerender();
});

$app.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-action]');
  if (!t || t.tagName === 'INPUT') return;
  const act = t.dataset.action;
  const photo = () => current.photos.find((p) => p.id === t.dataset.id);

  if (act === 'new') {
    const a = normalize({ id: uid(), event: '', site: '', date: today(), assessor: settings.get().assessor || '',
      activities: ['battle', 'public'], notes: '', created: new Date().toISOString() });
    await store.put(a);
    location.hash = '#/a/' + a.id;
  } else if (act === 'test-ai') {
    const out = document.getElementById('ai-test');
    const st = settings.get();
    if (!st.aiUrl) { out.textContent = 'Enter the relay address first.'; return; }
    out.textContent = 'Checking…';
    try {
      const res = await fetch(st.aiUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ping: true, code: st.aiCode || '' }) });
      const data = await res.json().catch(() => ({}));
      out.textContent = res.ok ? '✅ Connected' : '❌ ' + (data.error || 'error ' + res.status);
    } catch { out.textContent = '❌ Could not reach the relay. Check the address.'; }
  } else if (!current) {
    return;
  } else if (act === 'jump') {
    document.getElementById(t.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (act === 'del-photo') {
    if (!confirm('Remove this photo and its markers?')) return;
    current.photos = current.photos.filter((p) => p.id !== t.dataset.id);
    await saveNow(); rerender();
  } else if (act === 'pins') {
    openEditor(t.dataset.id);
  } else if (act === 'ai') {
    spotHazards(t.dataset.id);
  } else if (act === 'ai-accept' || act === 'ai-dismiss') {
    const p = photo();
    const s = p && p.ai && p.ai.suggestions.find((x) => x.sid === t.dataset.sid);
    if (!s) return;
    if (act === 'ai-accept') acceptSuggestion(current, p, s); else s.state = 'dismissed';
    await saveNow(); rerender();
  } else if (act === 'del-plan') {
    if (!confirm('Remove the site plan and its markers?')) return;
    current.plan = null;
    await saveNow(); rerender();
  } else if (act === 'add-custom') {
    const hazard = document.getElementById('c-hazard').value.trim();
    if (!hazard) return alert('Describe the hazard first.');
    current.custom.push({ id: 'c-' + uid(), area: 'Site-specific', hazard,
      who: document.getElementById('c-who').value.trim(),
      controls: document.getElementById('c-controls').value.trim(),
      activities: [] });
    await saveNow(); rerender();
  } else if (act === 'del-custom') {
    current.custom = current.custom.filter((h) => h.id !== t.dataset.id);
    delete current.items[t.dataset.id];
    await saveNow(); rerender();
  } else if (act === 'geo') {
    if (!navigator.geolocation) return alert('This phone cannot share its location.');
    t.disabled = true; t.textContent = '📍 Finding…';
    const a = current;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      a.geo = { lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) };
      await store.put(a); if (current === a) rerender();
    }, (err) => { alert('Could not get your location: ' + err.message); if (current === a) rerender(); },
    { enableHighAccuracy: true, timeout: 20000 });
  } else if (act === 'weather') {
    t.disabled = true; t.textContent = 'Getting forecast…';
    fetchWeather();
  } else if (act === 'add-log') {
    const tags = [...document.querySelectorAll('[data-logtag]:checked')].map((x) => x.value);
    const note = document.getElementById('l-note').value.trim();
    const action = document.getElementById('l-action').value.trim();
    const hazardId = document.getElementById('l-hazard').value;
    const L = Number(document.getElementById('l-L').value), S = Number(document.getElementById('l-S').value);
    if (!tags.length && !note && !action) return alert('Say what changed first.');
    const entry = { id: uid(), time: document.getElementById('l-time').value || nowTime(), at: new Date().toISOString(), tags, note, action };
    if (hazardId && L && S) {
      const it = itemFor(current, hazardId);
      Object.assign(entry, { hazardId, from: scoreOf(it), to: L * S });
      it.rL = L; it.rS = S; it.applies = true;
    } else if (hazardId) {
      return alert('Choose both a new likelihood and severity, or clear the hazard.');
    }
    current.log.push(entry);
    current.log.sort((x, y) => x.time.localeCompare(y.time));
    await saveNow(); rerender();
  } else if (act === 'del-log') {
    if (!confirm('Remove this log entry? Any re-score it made stays in place.')) return;
    current.log = current.log.filter((x) => x.id !== t.dataset.id);
    await saveNow(); rerender();
  } else if (act === 'sig-reset') {
    const c = document.querySelector(`canvas[data-sig="${t.dataset.role}"]`);
    c.getContext('2d').clearRect(0, 0, c.width, c.height); delete c.dataset.dirty;
  } else if (act === 'sig-save') {
    const role = t.dataset.role;
    const c = document.querySelector(`canvas[data-sig="${role}"]`);
    const name = document.getElementById('sig-name-' + role).value.trim();
    if (!name) return alert('Enter the name of the person signing.');
    if (!c.dataset.dirty) return alert('Sign in the box first.');
    current.signoff[role] = { name, sig: c.toDataURL('image/png'), at: new Date().toISOString() };
    await saveNow(); rerender();
  } else if (act === 'sig-clear') {
    if (!confirm('Remove this signature?')) return;
    delete current.signoff[t.dataset.role];
    await saveNow(); rerender();
  } else if (act === 'dismiss-copy') {
    current.copiedFrom = null;
    await saveNow(); rerender();
  } else if (act === 'copy') {
    await saveNow();
    const keepPhotos = current.photos.length && confirm('Keep the site photos in the copy?\n\nOK = keep photos, Cancel = start without photos.');
    const b = JSON.parse(JSON.stringify(current));
    Object.assign(b, { id: uid(), date: '', created: new Date().toISOString(), signoff: {}, log: [], weather: null,
      copiedFrom: { event: current.event, date: current.date } });
    if (!keepPhotos) b.photos = [];
    else for (const p of b.photos) delete p.ai;
    await store.put(b);
    location.hash = '#/a/' + b.id;
  } else if (act === 'export') {
    await saveNow();
    exportAssessment(current);
  } else if (act === 'share-brief') {
    const text = briefingText(current);
    if (navigator.share) {
      try { await navigator.share({ title: 'Safety briefing', text }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); alert('Briefing copied — paste it into WhatsApp, email or a message.'); }
    catch { alert('Sharing is not available on this browser.'); }
  } else if (act === 'delete') {
    if (!confirm('Delete this assessment and its photos? This cannot be undone.')) return;
    await store.del(current.id);
    location.hash = '#/';
  } else if (act === 'print') {
    window.print();
  }
});

// ---------- Routing ----------
function rerender() {
  const y = window.scrollY;
  route(true).then(() => window.scrollTo(0, y));
}
async function route(keepCurrent) {
  if (editor && !keepCurrent) closeEditor(false);
  const [, view, id] = location.hash.split('/');
  if (!view) return viewHome();
  if (view === 'settings') { await saveNow(); return viewSettings(); }
  if (!keepCurrent || !current || current.id !== id) {
    await saveNow();
    current = await store.get(id);
  }
  if (!current) { location.hash = '#/'; return; }
  normalize(current);
  if (view === 'a') viewEdit();
  else if (view === 'r') viewReport();
  else if (view === 'b') viewBriefing();
  else viewHome();
  if (!keepCurrent) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => route(false));
window.addEventListener('pagehide', saveNow);

(async function init() {
  try {
    LIB = await (await fetch('data/hazards.json')).json();
  } catch (e) {
    $app.innerHTML = '<p>Could not load the hazard list. Open the app through a web address (not as a local file).</p>';
    return;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route(false);
})();
