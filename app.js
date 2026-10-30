// Safkatrack – Turun opiskelijaravintoloiden ruokalistat.
// Data tulee tiedostosta data/menus.json, jonka GitHub Actions päivittää.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Tallennus (vain tässä selaimessa) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('safkatrack.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('safkatrack.' + key, JSON.stringify(value)); } catch { /* yksityinen tila tms. */ }
  },
};

const normName = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

const state = {
  data: null,
  date: null,
  tab: store.get('tab', 'list'),
  pos: null,
  favs: new Set(store.get('favs', [])),
  hidden: new Set(store.get('hidden', [])),
  collapsed: new Set(store.get('collapsed', [])),
  metric: store.get('metric', 'protein'),
  rankMode: store.get('rankMode', 'dishes'),
  cheapOnly: store.get('cheapOnly', false),
  diet: store.get('diet', 'all'),
  showHidden: false,
};
const CHAINS = { unica: 'Unica', sodexo: 'Sodexo', karka: 'Kårkaféerna', jamix: 'Juvenes' };

// ---------- Hinta ----------
// Opiskelijahinta = hintarivin ensimmäinen luku ("3,10 / 7,90 / 9,90").
// Kilohintaiset ("2,50€/100g") eivät ole kiinteähintaisia annoksia.
const STUDENT_PRICE = 3.1;
function studentPrice(price) {
  if (!price || /\/\s*100\s*g|kg/i.test(price)) return null;
  const m = price.match(/\d+[.,]\d+/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}
const isCheap = (d) => { const p = studentPrice(d.price); return p != null && p <= STUDENT_PRICE + 0.001; };

// ---------- Ruokavaliot ----------
// Ruokavaliomerkinnät katsotaan pääruoasta (annoksen ensimmäinen komponentti).
const VEG_CODES = new Set(['VEG', 'VGN', 'V', 'VE', 'VEGAN']);
const MEAT_RE = /(broiler|kana(?!muna)|kanan(?!muna)|chicken|nauta|naudan|härkä(?!papu)|härän|possu|porsa|porsaan|sian|sika|pork|liha(?!ton)|kinkku|pekoni|bacon|makkara|nakki|lammas|lampaan|kalkkuna|riista|poro|poron|hirvi|ankka|chorizo|salami|kebab|pihvi|wings|siipi|beef)/i;
const NOT_MEAT_RE = /(vega|kasvis|soija|härkis|nyhtö|tofu|quorn|seitan|beyond|kasvi)/i;
const mainItem = (d) => d.items[0];
const codes = (it) => (it?.diets ?? []).map((c) => c.toUpperCase());
const isVeg = (d) => codes(mainItem(d)).some((c) => VEG_CODES.has(c)) || /vegaan|kasvis|vege/i.test(d.line ?? '');
const isMeat = (d) => !isVeg(d) && d.items.some((it) => MEAT_RE.test(it.name) && !NOT_MEAT_RE.test(it.name));

const DIETS = {
  all: { label: 'Kaikki ruoat', test: () => true },
  meat: { label: '🥩 Liharuoat', test: isMeat },
  veg: { label: '🌱 Kasvisruoat', test: isVeg },
  G: { label: 'Gluteeniton', test: (d) => codes(mainItem(d)).includes('G') },
  L: { label: 'Laktoositon', test: (d) => codes(mainItem(d)).some((c) => c === 'L' || c === 'M') },
  M: { label: 'Maidoton', test: (d) => codes(mainItem(d)).includes('M') },
};
const passes = (d) => (!state.cheapOnly || isCheap(d)) && (DIETS[state.diet] ?? DIETS.all).test(d);
const filtersOn = () => state.cheapOnly || state.diet !== 'all';

// ---------- Päivämäärät ja aukioloajat ----------
const todayIso = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(/[.:]/).map(Number);
  return h * 60 + m;
};
const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (iso === todayIso()) return 'Tänään';
  return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}
const toMin = (t) => { const [h, m] = t.split(/[:.]/).map(Number); return h * 60 + (m || 0); };
const fmtTime = (t) => t.replace(':', '.');

// { text, closed } valitulle päivälle
function openStatus(r, date, hasMenu) {
  const h = r.hoursByDate?.[date];
  if (!hasMenu) return { text: h ? `Lounas ${h.replace(/:/g, '.')}` : '', closed: true };
  if (!h) return { text: '', closed: false };
  const [a, b] = h.split('–');
  if (date !== todayIso() || !a || !b) return { text: `Lounas ${fmtTime(a)}–${fmtTime(b ?? '')}`, closed: false };
  const now = nowMinutes();
  if (now < toMin(a)) return { text: `Avautuu klo ${fmtTime(a)} (–${fmtTime(b)})`, closed: false };
  if (now < toMin(b)) return { text: `Auki klo ${fmtTime(b)} asti`, closed: false, open: true };
  return { text: `Suljettu tältä päivältä (klo ${fmtTime(b)})`, closed: true };
}

// ---------- Etäisyys ----------
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', ',')} km`);
const distOf = (r) => (state.pos ? distanceKm(state.pos, r) : null);

// ---------- Ravintoarvot ----------
// Annoksen arvot = ensimmäinen komponentti, jolla on ravintotiedot (yleensä pääruoka).
const mainNutrition = (dish) => dish.items.find((i) => i.nutrition)?.nutrition ?? null;

const fmt1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const METRICS = {
  protein: { label: 'Eniten proteiinia', unit: 'g / 100 g', value: (n) => n.protein, dir: -1, fmt: (v) => `${fmt1(v)} g` },
  density: { label: 'Paras proteiini/energia', unit: 'g / 100 kcal', value: (n) => (n.protein != null && n.kcal ? (n.protein / n.kcal) * 100 : null), dir: -1, fmt: (v) => `${fmt1(v)} g` },
  kcal: { label: 'Vähiten kaloreita', unit: 'kcal / 100 g', value: (n) => n.kcal, dir: 1, fmt: (v) => `${Math.round(v)}` },
};

function macrosHtml(n) {
  if (!n) return '<div class="nodata">Ei ravintotietoja</div>';
  const parts = [];
  if (n.protein != null) parts.push(`<span class="macro p">P ${fmt1(n.protein)} g</span>`);
  if (n.kcal != null) parts.push(`<span class="macro">${Math.round(n.kcal)} kcal</span>`);
  if (n.carbs != null) parts.push(`<span class="macro">HH ${fmt1(n.carbs)} g</span>`);
  if (n.fat != null) parts.push(`<span class="macro">R ${fmt1(n.fat)} g</span>`);
  return `<div class="macros" title="Pääkomponentin ravintoarvot 100 grammassa">${parts.join('')}<span class="meta">/ 100 g</span></div>`;
}

// ---------- Suosikit, piilotus, avaus/sulku ----------
function toggleIn(setName, key) {
  const s = state[setName];
  s.has(key) ? s.delete(key) : s.add(key);
  store.set(setName, [...s]);
}
const isFav = (name) => state.favs.has(normName(name));
const visibleRestaurants = () => state.data.restaurants.filter((r) => !state.hidden.has(r.id));
const dishesOf = (r, date = state.date) => state.data.menus[r.id]?.[date] ?? [];

// ---------- Näkymät ----------
function itemHtml(it) {
  const on = isFav(it.name);
  return `<div class="item">
    <span class="name">${esc(it.name)}${it.diets?.length ? ` <span class="diets">${esc(it.diets.join(', '))}</span>` : ''}</span>
    <button class="star ${on ? 'on' : ''}" data-fav="${esc(it.name)}" aria-pressed="${on}" aria-label="${on ? 'Poista suosikeista' : 'Lisää suosikkeihin'}">${on ? '★' : '☆'}</button>
  </div>`;
}

function dishHtml(d) {
  const fav = d.items.some((i) => isFav(i.name));
  return `<div class="dish ${fav ? 'has-fav' : ''}">
    ${d.line || d.price ? `<div class="line"><span>${esc(d.line)}</span><span>${esc(d.price)}</span></div>` : ''}
    ${d.items.map(itemHtml).join('')}
    ${macrosHtml(mainNutrition(d))}
  </div>`;
}

const mapsUrl = (r) => `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;

function restaurantCard(r) {
  const all = dishesOf(r);
  const shown = all.filter(passes);
  const st = openStatus(r, state.date, all.length > 0);
  const collapsed = state.collapsed.has(r.id);
  const km = distOf(r);
  let body = '';
  if (!collapsed) {
    if (!all.length) body = `<p class="empty">${state.data.errors?.[r.id] ? 'Ruokalistan haku epäonnistui.' : 'Ei ruokalistaa tälle päivälle.'}</p>`;
    else if (!shown.length) body = '<p class="empty">Ei suodatinta vastaavia annoksia.</p>';
    else body = shown.map(dishHtml).join('') + (shown.length < all.length ? `<p class="empty">${all.length - shown.length} muuta annosta piilotettu suodattimella.</p>` : '');
  }
  return {
    rank: !all.length ? 2 : st.closed ? 1 : 0,
    html: `<section class="card ${st.closed ? 'closed' : ''}" id="r-${r.id}">
      <div class="card-head">
        <button class="rname" data-collapse="${r.id}" aria-expanded="${!collapsed}">
          <span class="chev">${collapsed ? '▸' : '▾'}</span><h2>${esc(r.name)}</h2>
        </button>
        ${km != null ? `<span class="dist">${fmtDist(km)}</span>` : ''}
      </div>
      <div class="meta">${esc(r.campus)} · ${esc(CHAINS[r.chain] ?? r.chain)}${st.text ? ` · <span class="${st.open ? 'open' : ''}">${esc(st.text)}</span>` : ''}${collapsed && shown.length ? ` · ${shown.length} annosta` : ''}</div>
      ${body}
      ${collapsed ? '' : `<div class="card-actions">
        <a href="${mapsUrl(r)}" target="_blank" rel="noopener">🧭 Reitti</a>
        <button data-hide="${r.id}">🙈 Piilota ravintola</button>
      </div>`}
    </section>`,
    r,
  };
}

function renderList() {
  const cards = visibleRestaurants().map(restaurantCard);
  cards.sort((a, b) => a.rank - b.rank || (state.pos ? distOf(a.r) - distOf(b.r) : 0));
  const hidden = state.data.restaurants.filter((r) => state.hidden.has(r.id));
  let footer = '';
  if (hidden.length) {
    footer = `<div class="hidden-box">
      <button class="linklike" data-showhidden>${state.showHidden ? '▾' : '▸'} Piilotetut ravintolat (${hidden.length})</button>
      ${state.showHidden ? hidden.map((r) => `<div class="hidden-row"><span>${esc(r.name)}</span><button class="chip" data-unhide="${r.id}">Näytä</button></div>`).join('') : ''}
    </div>`;
  }
  return cards.map((c) => c.html).join('') + footer;
}

function renderRank() {
  const m = METRICS[state.metric];
  const rows = [];
  let missing = 0, hidden = 0;
  for (const r of visibleRestaurants()) {
    for (const d of dishesOf(r)) {
      if (!passes(d)) { hidden++; continue; }
      const n = mainNutrition(d);
      const v = n ? m.value(n) : null;
      if (v == null) { missing++; continue; }
      rows.push({ r, d, n, v });
    }
  }
  rows.sort((a, b) => m.dir * (a.v - b.v));

  let list = rows;
  if (state.rankMode === 'restaurants') {
    const seen = new Set();
    list = rows.filter((x) => (seen.has(x.r.id) ? false : seen.add(x.r.id)));
  }

  const toolbar = `<div class="toolbar">
    <select id="metric" aria-label="Järjestys">
      ${Object.entries(METRICS).map(([k, v]) => `<option value="${k}" ${k === state.metric ? 'selected' : ''}>${v.label}</option>`).join('')}
    </select>
    <div class="seg" role="group" aria-label="Rankattavat">
      <button data-mode="dishes" class="${state.rankMode === 'dishes' ? 'active' : ''}">Annokset</button>
      <button data-mode="restaurants" class="${state.rankMode === 'restaurants' ? 'active' : ''}">Ravintolat</button>
    </div>
  </div>
  <p class="note">Arvot ovat annoksen pääkomponentin ravintoarvot 100 grammaa kohden ravintolan omista tiedoista. Lisukkeet ja kastikkeet eivät ole mukana.${state.rankMode === 'restaurants' ? ' Ravintola rankataan sen parhaan annoksen mukaan.' : ''}${missing ? ` <strong>${missing} annosta ilman ravintotietoja</strong> puuttuu listasta.` : ''}${filtersOn() ? ` Suodatin piilottaa ${hidden} annosta.` : ''}</p>`;

  if (!list.length) return toolbar + '<p class="muted center">Tälle päivälle ei ole ravintotietoja.</p>';

  return toolbar + list.map((x, i) => {
    const km = distOf(x.r);
    const main = x.d.items.find((it) => it.nutrition) ?? x.d.items[0];
    const others = x.d.items.filter((it) => it !== main).map((it) => it.name);
    return `<section class="card rank">
      <div class="pos">${i + 1}</div>
      <div class="body">
        <div class="item"><span class="name"><strong>${esc(main.name)}</strong></span>
          <button class="star ${isFav(main.name) ? 'on' : ''}" data-fav="${esc(main.name)}" aria-label="Suosikki">${isFav(main.name) ? '★' : '☆'}</button></div>
        ${others.length ? `<div class="meta">+ ${esc(others.join(', '))}</div>` : ''}
        <div class="meta">${esc(x.r.name)}${km != null ? ` · <span class="dist">${fmtDist(km)}</span>` : ''}${x.d.price ? ` · ${esc(x.d.price)}` : ''}</div>
        ${macrosHtml(x.n)}
      </div>
      <div class="value">${m.fmt(x.v)}<small>${m.unit}</small></div>
    </section>`;
  }).join('');
}

function renderFavs() {
  if (!state.favs.size) {
    return '<p class="muted center">Ei vielä suosikkeja.<br>Lisää ruoka suosikiksi tähdellä ☆, niin näet täältä missä ja milloin sitä on tarjolla.</p>';
  }
  const today = todayIso();
  const found = new Map([...state.favs].map((k) => [k, { name: null, hits: [] }]));
  for (const r of state.data.restaurants) {
    for (const [date, dishes] of Object.entries(state.data.menus[r.id] ?? {})) {
      if (date < today) continue;
      for (const d of dishes) for (const it of d.items) {
        const f = found.get(normName(it.name));
        if (f) { f.name = it.name; f.hits.push({ r, date }); }
      }
    }
  }
  return [...found.entries()].map(([k, f]) => {
    f.hits.sort((a, b) => a.date.localeCompare(b.date) || (distOf(a.r) ?? 0) - (distOf(b.r) ?? 0));
    return `<section class="card">
      <div class="item"><span class="name"><strong>${esc(f.name ?? k)}</strong></span>
        <button class="star on" data-fav="${esc(f.name ?? k)}" aria-label="Poista suosikeista">★</button></div>
      ${f.hits.length
        ? f.hits.map((h) => `<div class="meta">${dayLabel(h.date)} · ${esc(h.r.name)}${distOf(h.r) != null ? ` · ${fmtDist(distOf(h.r))}` : ''}</div>`).join('')
        : '<p class="empty">Ei tarjolla lähipäivinä.</p>'}
    </section>`;
  }).join('');
}

// ---------- Kartta (Leaflet + OpenStreetMap) ----------
let map = null, markerLayer = null, leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'vendor/leaflet/leaflet.css';
  document.head.appendChild(css);
  leafletLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
  return leafletLoading;
}

function bestDish(r) {
  let best = null;
  for (const d of dishesOf(r).filter(passes)) {
    const p = mainNutrition(d)?.protein;
    if (p != null && (!best || p > best.p)) best = { d, p };
  }
  return best;
}

function popupHtml(r) {
  const all = dishesOf(r);
  const st = openStatus(r, state.date, all.length > 0);
  const best = bestDish(r);
  const km = distOf(r);
  return `<div class="pop">
    <strong>${esc(r.name)}</strong>${km != null ? ` · ${fmtDist(km)}` : ''}<br>
    <span class="meta">${esc(st.text || (all.length ? '' : 'Ei ruokalistaa'))}</span>
    ${best ? `<div class="pop-best">💪 ${esc((best.d.items.find((i) => i.nutrition) ?? best.d.items[0]).name)} – ${fmt1(best.p)} g / 100 g</div>` : ''}
    <div class="pop-actions"><button class="chip" data-showlist="${r.id}">Ruokalista</button>
    <a class="chip" href="${mapsUrl(r)}" target="_blank" rel="noopener">🧭 Reitti</a></div>
  </div>`;
}

async function renderMap() {
  const view = $('#view');
  if (!$('#map')) {
    view.innerHTML = '<div id="map" class="map"><p class="muted center">Ladataan karttaa…</p></div>';
    sizeMap();
    try { await loadLeaflet(); } catch {
      $('#map').innerHTML = '<p class="center warn">Kartan lataus epäonnistui. Tarkista verkkoyhteys.</p>';
      return;
    }
    if (state.tab !== 'map' || !$('#map')) return;
    $('#map').innerHTML = '';
    map = L.map('map', { zoomControl: true }).setView([60.452, 22.28], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  if (!map) return;
  markerLayer.clearLayers();
  const pts = [];
  for (const r of visibleRestaurants()) {
    const all = dishesOf(r);
    const st = openStatus(r, state.date, all.length > 0);
    const active = all.some(passes) && !st.closed;
    const m = L.circleMarker([r.lat, r.lon], {
      radius: 10, weight: 2, color: '#fff', fillOpacity: 0.95,
      fillColor: active ? '#0f766e' : '#94a3a0',
    }).bindPopup(popupHtml(r)).bindTooltip(r.name, { direction: 'top', offset: [0, -8] });
    markerLayer.addLayer(m);
    pts.push([r.lat, r.lon]);
  }
  if (state.pos) {
    markerLayer.addLayer(L.circleMarker([state.pos.lat, state.pos.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Sinä'));
  }
  if (!map._fitted && pts.length) { map.fitBounds(pts, { padding: [30, 30] }); map._fitted = true; }
  setTimeout(() => map.invalidateSize(), 50);
}

function sizeMap() {
  const el = $('#map');
  if (!el) return;
  const top = $('.top').offsetHeight, tabs = $('.tabs').offsetHeight;
  el.style.height = `${Math.max(300, window.innerHeight - top - tabs - 24)}px`;
}
window.addEventListener('resize', () => { sizeMap(); map?.invalidateSize(); });

// ---------- Yläpalkki ----------
function renderTop() {
  const dates = new Set();
  for (const days of Object.values(state.data.menus)) for (const d of Object.keys(days)) dates.add(d);
  const today = todayIso();
  const list = [...dates].filter((d) => d >= today).sort();
  if (!list.includes(state.date)) state.date = list[0] ?? today;
  $('#days').innerHTML = list.length
    ? list.map((d) => `<button class="chip ${d === state.date ? 'active' : ''}" data-date="${d}">${dayLabel(d)}</button>`).join('')
    : '<span class="meta">Ei tulevia ruokalistoja</span>';
  $('#filters').innerHTML = `
    <select id="diet" aria-label="Ruokavalio" class="${state.diet !== 'all' ? 'on' : ''}">
      ${Object.entries(DIETS).map(([k, v]) => `<option value="${k}" ${k === state.diet ? 'selected' : ''}>${v.label}</option>`).join('')}
    </select>
    <button id="cheap" class="chip" aria-pressed="${state.cheapOnly}">Max 3,10 €</button>`;
  const hide = state.tab === 'favs';
  $('#days').style.display = hide ? 'none' : '';
  $('#filters').style.display = hide ? 'none' : '';
}

function render() {
  if (!state.data) return;
  renderTop();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (state.tab === 'map') return renderMap();
  if (map) { map.remove(); map = null; markerLayer = null; }
  $('#view').innerHTML = state.tab === 'rank' ? renderRank() : state.tab === 'favs' ? renderFavs() : renderList();
}

// ---------- Tapahtumat ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.fav != null) { toggleIn('favs', normName(ds.fav)); return render(); }
  if (ds.date) { state.date = ds.date; return render(); }
  if (ds.tab) { state.tab = ds.tab; store.set('tab', state.tab); window.scrollTo(0, 0); return render(); }
  if (ds.mode) { state.rankMode = ds.mode; store.set('rankMode', state.rankMode); return render(); }
  if (ds.collapse) { toggleIn('collapsed', ds.collapse); return render(); }
  if (ds.hide) { toggleIn('hidden', ds.hide); return render(); }
  if (ds.unhide) { toggleIn('hidden', ds.unhide); return render(); }
  if (ds.showhidden != null) { state.showHidden = !state.showHidden; return render(); }
  if (ds.showlist) {
    const id = ds.showlist;
    state.collapsed.delete(id); store.set('collapsed', [...state.collapsed]);
    state.tab = 'list'; store.set('tab', 'list');
    render();
    document.getElementById('r-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.id === 'cheap') { state.cheapOnly = !state.cheapOnly; store.set('cheapOnly', state.cheapOnly); return render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'metric') { state.metric = e.target.value; store.set('metric', state.metric); render(); }
  if (e.target.id === 'diet') { state.diet = e.target.value; store.set('diet', state.diet); render(); }
});

function locate() {
  const btn = $('#locate');
  if (!('geolocation' in navigator)) { btn.textContent = '📍 Ei sijaintia'; return; }
  btn.textContent = '📍 Haetaan…';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      store.set('useLocation', true);
      btn.textContent = '📍 Lähimmät';
      btn.setAttribute('aria-pressed', 'true');
      render();
    },
    () => { btn.textContent = '📍 Sijainti estetty'; store.set('useLocation', false); },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 },
  );
}
$('#locate').addEventListener('click', () => {
  if (state.pos) { // toinen painallus poistaa lajittelun
    state.pos = null; store.set('useLocation', false);
    $('#locate').setAttribute('aria-pressed', 'false');
    return render();
  }
  locate();
});

// ---------- Käynnistys ----------
async function load() {
  try {
    const res = await fetch('data/menus.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    const t = new Date(state.data.generatedAt);
    $('#status').textContent = `Päivitetty ${t.toLocaleString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} · Lähteet: Unica, Sodexo, Kårkaféerna, Juvenes`;
    render();
  } catch {
    $('#view').innerHTML = '<p class="center warn">Ruokalistojen lataus epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.</p>';
  }
}

if (store.get('useLocation', false)) locate();
load();
// Aukiolotila päivittyy, vaikka sovellus olisi auki pitkään.
setInterval(() => { if (state.tab === 'list') render(); }, 5 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
