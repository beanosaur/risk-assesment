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
    const store = t.objectStore('assessments');
    const req = fn(store);
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

// ---------- Helpers ----------
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

let LIB = { activities: [], hazards: [] };
let current = null; // assessment being edited
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
function itemFor(a, id) {
  if (!a.items[id]) a.items[id] = { applies: true, L: 0, S: 0, extra: '', rL: 0, rS: 0 };
  return a.items[id];
}
function groupByArea(list) {
  const out = new Map();
  for (const h of list) {
    if (!out.has(h.area)) out.set(h.area, []);
    out.get(h.area).push(h);
  }
  return out;
}

// ---------- Views ----------
async function viewHome() {
  current = null;
  const list = (await store.all()).sort((x, y) => (y.updated || '').localeCompare(x.updated || ''));
  $app.innerHTML = `
    <h1>Assessments</h1>
    <p class="muted">Photograph the site, tick the hazards that apply, score them, and print or save the report as a PDF.</p>
    ${list.length ? list.map((a) => `
      <a class="card row" href="#/a/${a.id}" style="text-decoration:none;color:inherit">
        <div class="grow">
          <div class="hazard-title">${esc(a.event || 'Untitled event')}</div>
          <div class="muted">${esc(a.site)} ${a.date ? '· ' + fmtDate(a.date) : ''} · ${a.photos.length} photo${a.photos.length === 1 ? '' : 's'}</div>
        </div>
        <span aria-hidden="true">›</span>
      </a>`).join('') : '<div class="card muted">No assessments yet.</div>'}
    <div class="fab"><div class="row"><button class="btn grow" data-action="new">+ New assessment</button></div></div>`;
}

function viewEdit() {
  const a = current;
  const hz = hazardsFor(a);
  const groups = groupByArea(hz);
  $app.innerHTML = `
    <h1>${esc(a.event || 'New assessment')}</h1>

    <section class="card">
      <label for="f-event">Event</label>
      <input id="f-event" type="text" data-field="event" value="${esc(a.event)}" placeholder="e.g. Battle of Newbury muster">
      <label for="f-site">Site / location</label>
      <input id="f-site" type="text" data-field="site" value="${esc(a.site)}">
      <div class="row">
        <div class="grow"><label for="f-date">Date</label><input id="f-date" type="date" data-field="date" value="${esc(a.date)}"></div>
        <div class="grow"><label for="f-assessor">Assessed by</label><input id="f-assessor" type="text" data-field="assessor" value="${esc(a.assessor)}"></div>
      </div>
      <label>Activities on this site</label>
      <div class="chips">
        ${LIB.activities.map((act) => `
          <label class="chip"><input type="checkbox" data-activity="${act.id}" ${a.activities.includes(act.id) ? 'checked' : ''}> ${esc(act.name)}</label>`).join('')}
      </div>
    </section>

    <h2>Site photos</h2>
    <section class="card">
      <div class="row no-print" style="margin-bottom:10px">
        <label class="btn" style="margin:0">📷 Take photo<input type="file" accept="image/*" capture="environment" data-action="add-photo" hidden></label>
        <label class="btn secondary" style="margin:0">Upload<input type="file" accept="image/*" multiple data-action="add-photo" hidden></label>
      </div>
      <div class="photos">
        ${a.photos.map((p) => `
          <div class="photo">
            <img src="${p.dataUrl}" alt="Site photo">
            <textarea data-photo-note="${p.id}" placeholder="What does this show? Hazards?">${esc(p.note)}</textarea>
            <button class="btn small danger" data-action="del-photo" data-id="${p.id}">Remove</button>
          </div>`).join('') || '<p class="muted">No photos yet. Walk the site and photograph each area: battle ground, crowd line, camp, powder store, access routes.</p>'}
      </div>
    </section>

    <h2>Hazards</h2>
    ${hz.length ? '' : '<p class="muted">Choose at least one activity above to load the hazard checklist.</p>'}
    ${[...groups].map(([area, list]) => `
      <h3>${esc(area)}</h3>
      ${list.map((h) => hazardCard(a, h)).join('')}`).join('')}

    <section class="card no-print">
      <h3 style="margin-top:0">Add your own hazard</h3>
      <label for="c-hazard">Hazard</label><input id="c-hazard" type="text">
      <label for="c-who">Who could be harmed</label><input id="c-who" type="text">
      <label for="c-controls">Controls</label><textarea id="c-controls"></textarea>
      <button class="btn secondary" data-action="add-custom" style="margin-top:10px">Add hazard</button>
    </section>

    <h2>Other notes</h2>
    <section class="card"><textarea data-field="notes" placeholder="First aid location, emergency contacts, landowner instructions…">${esc(a.notes)}</textarea></section>

    <button class="btn danger small no-print" data-action="delete">Delete this assessment</button>

    <div class="fab"><div class="row">
      <a class="btn secondary" href="#/">Back</a>
      <a class="btn grow" href="#/r/${a.id}" style="text-align:center">View report</a>
    </div></div>`;
}

function hazardCard(a, h) {
  const it = itemFor(a, h.id);
  const s = it.L * it.S;
  const rs = it.rL * it.rS;
  const b = band(rs || s);
  const opts = (labels, v) => labels.map((l, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>${i ? l : '–'}</option>`).join('');
  return `
    <div class="card hazard ${it.applies ? (b ? 'r-' + b : '') : 'na'}" data-hazard="${h.id}">
      <div class="row">
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

function viewReport() {
  const a = current;
  const rows = hazardsFor(a).filter((h) => itemFor(a, h.id).applies);
  const counts = { low: 0, med: 0, high: 0, unscored: 0 };
  for (const h of rows) {
    const it = a.items[h.id];
    const b = band((it.rL * it.rS) || (it.L * it.S));
    counts[b || 'unscored']++;
  }
  const actNames = LIB.activities.filter((x) => a.activities.includes(x.id)).map((x) => x.name).join(', ');
  $app.innerHTML = `
    <div class="report">
      <h1>Risk assessment: ${esc(a.event || 'Untitled event')}</h1>
      <table>
        <tr><th>Site</th><td>${esc(a.site)}</td><th>Date</th><td>${fmtDate(a.date)}</td></tr>
        <tr><th>Assessed by</th><td>${esc(a.assessor)}</td><th>Activities</th><td>${esc(actNames)}</td></tr>
      </table>
      <h2>Summary</h2>
      <div class="summary">
        <span class="score high">${counts.high} High</span>
        <span class="score med">${counts.med} Medium</span>
        <span class="score low">${counts.low} Low</span>
        ${counts.unscored ? `<span class="score">${counts.unscored} not scored</span>` : ''}
      </div>
      <p class="muted">Risk = likelihood × severity (1–5 each). 1–4 Low, 5–12 Medium, 15–25 High.</p>

      <h2>Hazards</h2>
      <table>
        <thead><tr><th>Hazard</th><th>Who</th><th>Risk</th><th>Controls</th><th>Residual</th></tr></thead>
        <tbody>
        ${rows.map((h) => {
          const it = a.items[h.id];
          const s = it.L * it.S, rs = it.rL * it.rS;
          return `<tr>
            <td><strong>${esc(h.hazard)}</strong><div class="muted">${esc(h.area)}</div></td>
            <td>${esc(h.who)}</td>
            <td><span class="score ${band(s)}">${s || '–'}</span></td>
            <td>${esc(h.controls)}${it.extra ? `<br><strong>On this site:</strong> ${esc(it.extra)}` : ''}</td>
            <td><span class="score ${band(rs)}">${rs || '–'}</span></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>

      ${a.photos.length ? `<h2>Site photos</h2>
      <div class="photos">${a.photos.map((p) => `
        <div class="photo"><img src="${p.dataUrl}" alt="Site photo"><div style="padding:6px" class="muted">${esc(p.note)}</div></div>`).join('')}
      </div>` : ''}

      ${a.notes ? `<h2>Other notes</h2><p>${esc(a.notes).replace(/\n/g, '<br>')}</p>` : ''}

      <h2>Sign-off</h2>
      <table><tr><th>Name</th><td style="height:40px"></td><th>Signature</th><td></td><th>Date</th><td></td></tr></table>
    </div>
    <div class="fab"><div class="row">
      <a class="btn secondary" href="#/a/${a.id}">Edit</a>
      <button class="btn grow" data-action="print">Print / Save as PDF</button>
    </div></div>`;
}

// ---------- Events ----------
$app.addEventListener('input', (e) => {
  const t = e.target;
  if (!current) return;
  if (t.dataset.field) { current[t.dataset.field] = t.value; saveSoon(); return; }
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
  if (!current) return;
  if (t.dataset.activity) {
    const id = t.dataset.activity;
    current.activities = t.checked ? [...new Set([...current.activities, id])] : current.activities.filter((x) => x !== id);
    await saveNow(); rerender(); return;
  }
  if (t.dataset.action === 'add-photo' && t.files.length) {
    for (const f of t.files) {
      try { current.photos.push({ id: uid(), dataUrl: await resizeImage(f), note: '' }); }
      catch (err) { alert(err.message); }
    }
    t.value = '';
    await saveNow(); rerender(); return;
  }
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
  if (act === 'new') {
    const a = { id: uid(), event: '', site: '', date: today(), assessor: '', activities: ['battle', 'public'],
      photos: [], items: {}, custom: [], notes: '', created: new Date().toISOString() };
    await store.put(a);
    location.hash = '#/a/' + a.id;
  } else if (act === 'del-photo') {
    current.photos = current.photos.filter((p) => p.id !== t.dataset.id);
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
  const [, view, id] = location.hash.split('/');
  if (!view) return viewHome();
  if (!keepCurrent || !current || current.id !== id) {
    await saveNow();
    current = await store.get(id);
  }
  if (!current) { location.hash = '#/'; return; }
  current.custom ||= [];
  if (view === 'a') viewEdit();
  else if (view === 'r') viewReport();
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
