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
  metric: store.get('metric', 'protein'),
  rankMode: store.get('rankMode', 'dishes'),
  cheapOnly: store.get('cheapOnly', false),
};

// Opiskelijahinta = hintarivin ensimmäinen luku ("3,10 / 7,90 / 9,90").
// Kilohintaiset ("2,50€/100g") eivät ole kiinteähintaisia annoksia.
const STUDENT_PRICE = 3.1;
function studentPrice(price) {
  if (!price || /\/\s*100\s*g|kg/i.test(price)) return null;
  const m = price.match(/\d+[.,]\d+/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}
const isCheap = (d) => { const p = studentPrice(d.price); return p != null && p <= STUDENT_PRICE + 0.001; };

// ---------- Päivämäärät ----------
const todayIso = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (iso === todayIso()) return 'Tänään';
  return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
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

const METRICS = {
  protein: { label: 'Eniten proteiinia', unit: 'g / 100 g', value: (n) => n.protein, dir: -1, fmt: (v) => `${fmt1(v)} g` },
  density: { label: 'Paras proteiini/energia', unit: 'g / 100 kcal', value: (n) => (n.protein != null && n.kcal ? (n.protein / n.kcal) * 100 : null), dir: -1, fmt: (v) => `${fmt1(v)} g` },
  kcal: { label: 'Vähiten kaloreita', unit: 'kcal / 100 g', value: (n) => n.kcal, dir: 1, fmt: (v) => `${Math.round(v)}` },
};
const fmt1 = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

function macrosHtml(n) {
  if (!n) return '<div class="nodata">Ei ravintotietoja</div>';
  const parts = [];
  if (n.protein != null) parts.push(`<span class="macro p">P ${fmt1(n.protein)} g</span>`);
  if (n.kcal != null) parts.push(`<span class="macro">${Math.round(n.kcal)} kcal</span>`);
  if (n.carbs != null) parts.push(`<span class="macro">HH ${fmt1(n.carbs)} g</span>`);
  if (n.fat != null) parts.push(`<span class="macro">R ${fmt1(n.fat)} g</span>`);
  return `<div class="macros" title="Pääkomponentin ravintoarvot 100 grammassa">${parts.join('')}<span class="meta">/ 100 g</span></div>`;
}

// ---------- Suosikit ----------
function toggleFav(name) {
  const k = normName(name);
  state.favs.has(k) ? state.favs.delete(k) : state.favs.add(k);
  store.set('favs', [...state.favs]);
  render();
}
const isFav = (name) => state.favs.has(normName(name));

// ---------- Näkymät ----------
function restaurantsSorted() {
  const rs = [...state.data.restaurants];
  if (state.pos) rs.sort((a, b) => distOf(a) - distOf(b));
  return rs;
}

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

function restaurantHead(r) {
  const km = distOf(r);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + ', ' + r.address)}`;
  return `<div class="card-head">
      <h2><a href="${maps}" target="_blank" rel="noopener">${esc(r.name)}</a></h2>
      ${km != null ? `<span class="dist">${fmtDist(km)}</span>` : ''}
    </div>
    <div class="meta">${esc(r.campus)} · ${esc(r.chain === 'unica' ? 'Unica' : 'Sodexo')}</div>`;
}

function renderList() {
  const open = [], closed = [];
  for (const r of restaurantsSorted()) {
    const dishes = state.data.menus[r.id]?.[state.date] ?? [];
    (dishes.length ? open : closed).push(`<section class="card ${dishes.length ? '' : 'closed'}">
      ${restaurantHead(r)}
      ${dishes.length ? dishes.map(dishHtml).join('') : `<p class="empty">${state.data.errors?.[r.id] ? 'Ruokalistan haku epäonnistui.' : 'Ei ruokalistaa tälle päivälle.'}</p>`}
    </section>`);
  }
  return open.join('') + closed.join('');
}

function renderRank() {
  const m = METRICS[state.metric];
  const rows = [];
  let missing = 0, hidden = 0;
  for (const r of state.data.restaurants) {
    for (const d of state.data.menus[r.id]?.[state.date] ?? []) {
      if (state.cheapOnly && !isCheap(d)) { hidden++; continue; }
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
    <button id="cheap" class="chip" aria-pressed="${state.cheapOnly}">Max 3,10 €</button>
  </div>
  <p class="note">Arvot ovat annoksen pääkomponentin ravintoarvot 100 grammaa kohden ravintolan omista tiedoista. Lisukkeet ja kastikkeet eivät ole mukana.${state.rankMode === 'restaurants' ? ' Ravintola rankataan sen parhaan annoksen mukaan.' : ''}${missing ? ` <strong>${missing} annosta ilman ravintotietoja</strong> puuttuu listasta.` : ''}${state.cheapOnly ? ` Näytetään vain annokset, joiden opiskelijahinta on enintään 3,10 € (${hidden} piilotettu).` : ''}</p>`;

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

function renderDays() {
  const dates = new Set();
  for (const days of Object.values(state.data.menus)) for (const d of Object.keys(days)) dates.add(d);
  const today = todayIso();
  const list = [...dates].filter((d) => d >= today).sort();
  if (!list.includes(state.date)) state.date = list[0] ?? today;
  $('#days').innerHTML = list.length
    ? list.map((d) => `<button class="chip ${d === state.date ? 'active' : ''}" data-date="${d}">${dayLabel(d)}</button>`).join('')
    : '<span class="meta">Ei tulevia ruokalistoja</span>';
  $('#days').style.display = state.tab === 'favs' ? 'none' : '';
}

function render() {
  if (!state.data) return;
  renderDays();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#view').innerHTML = state.tab === 'rank' ? renderRank() : state.tab === 'favs' ? renderFavs() : renderList();
}

// ---------- Tapahtumat ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.fav != null) return toggleFav(t.dataset.fav);
  if (t.dataset.date) { state.date = t.dataset.date; return render(); }
  if (t.dataset.tab) { state.tab = t.dataset.tab; store.set('tab', state.tab); window.scrollTo(0, 0); return render(); }
  if (t.id === 'cheap') { state.cheapOnly = !state.cheapOnly; store.set('cheapOnly', state.cheapOnly); return render(); }
  if (t.dataset.mode) { state.rankMode = t.dataset.mode; store.set('rankMode', state.rankMode); return render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'metric') { state.metric = e.target.value; store.set('metric', state.metric); render(); }
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
    $('#status').textContent = `Päivitetty ${t.toLocaleString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} · Lähteet: Unica, Sodexo`;
    render();
  } catch {
    $('#view').innerHTML = '<p class="center warn">Ruokalistojen lataus epäonnistui. Tarkista verkkoyhteys ja yritä uudelleen.</p>';
  }
}

if (store.get('useLocation', false)) locate();
load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
