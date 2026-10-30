// Safkatrack – Turun opiskelijaravintoloiden ruokalistat.
// Data tulee tiedostosta data/menus.json, jonka GitHub Actions päivittää.

import { DICTS } from './i18n.js';

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

const normName = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

const state = {
  data: null,
  date: null,
  tab: store.get('tab', 'list'),
  pos: null,
  favs: new Set(store.get('favs', [])),
  hidden: new Set(store.get('hidden', [])),
  collapsed: new Set(store.get('collapsed', [])),
  allergies: new Set(store.get('allergies', [])),
  metric: store.get('metric', 'protein'),
  rankMode: store.get('rankMode', 'dishes'),
  cheapOnly: store.get('cheapOnly', false),
  diet: store.get('diet', 'all'),
  lang: store.get('lang', 'fi'),
  plan: store.get('plan', {}), // { 'YYYY-MM-DD': { lunch: entry, dinner: entry } }
  planWeek: null, // maanantai
  showHidden: false,
  showAllergies: false,
  weekOf: null, // ravintolan viikkonäkymä
  goNow: null, // 'pending' | tulos
  search: '',
  picker: null, // { key } lisättävä ruoka
  toast: '',
};
const t = (k, ...a) => { const v = DICTS[state.lang][k] ?? DICTS.fi[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const CHAINS = { unica: 'Unica', sodexo: 'Sodexo', karka: 'Kårkaféerna', jamix: 'Juvenes' };
const ALLERGENS = ['kala', 'ayriaiset', 'pahkina', 'kananmuna', 'soija', 'selleri', 'sinappi', 'seesami'];

// Ruoan nimi valitulla kielellä
const itemName = (it) => (state.lang === 'en' && it.name_en) || it.name;

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

// ---------- Ruokavaliot ja allergiat ----------
// Ruokavaliomerkinnät katsotaan pääruoasta (annoksen ensimmäinen komponentti).
const VEG_CODES = new Set(['VEG', 'VGN', 'V', 'VE', 'VEGAN']);
const MEAT_RE = /(broiler|kana(?!muna)|kanan(?!muna)|chicken|nauta|naudan|härkä(?!papu)|härän|possu|porsa|porsaan|sian|sika|pork|liha(?!ton)|kinkku|pekoni|bacon|makkara|nakki|lammas|lampaan|kalkkuna|riista|poro|poron|hirvi|ankka|chorizo|salami|kebab|pihvi|wings|siipi|beef)/i;
const NOT_MEAT_RE = /(vega|kasvis|soija|härkis|nyhtö|tofu|quorn|seitan|beyond|kasvi)/i;
const mainItem = (d) => d.items[0];
const codes = (it) => (it?.diets ?? []).map((c) => c.toUpperCase());
const isVeg = (d) => codes(mainItem(d)).some((c) => VEG_CODES.has(c)) || /vegaan|kasvis|vege/i.test(d.line ?? '');
const isMeat = (d) => !isVeg(d) && d.items.some((it) => MEAT_RE.test(it.name) && !NOT_MEAT_RE.test(it.name));

const DIETS = {
  all: { label: 'dietAll', test: () => true },
  meat: { label: 'dietMeat', test: isMeat },
  veg: { label: 'dietVeg', test: isVeg },
  G: { label: 'dietG', test: (d) => codes(mainItem(d)).includes('G') },
  L: { label: 'dietL', test: (d) => codes(mainItem(d)).some((c) => c === 'L' || c === 'M') },
  M: { label: 'dietM', test: (d) => codes(mainItem(d)).includes('M') },
};
const hasAllergy = (d) => state.allergies.size > 0 && d.items.some((it) => (it.allergens ?? []).some((a) => state.allergies.has(a)));
const passes = (d) => (!state.cheapOnly || isCheap(d)) && (DIETS[state.diet] ?? DIETS.all).test(d) && !hasAllergy(d);
const filtersOn = () => state.cheapOnly || state.diet !== 'all' || state.allergies.size > 0;

// ---------- Päivämäärät ja aukioloajat ----------
const todayIso = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(/[.:]/).map(Number);
  return h * 60 + m;
};
const WD = { fi: ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const WD_LONG = { fi: ['Sunnuntai', 'Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
function dayLabel(iso, long = false) {
  const d = new Date(iso + 'T12:00:00');
  if (!long && iso === todayIso()) return t('today');
  const wd = (long ? WD_LONG : WD)[state.lang][d.getDay()];
  return state.lang === 'en' ? `${wd} ${d.getDate()}/${d.getMonth() + 1}` : `${wd} ${d.getDate()}.${d.getMonth() + 1}.`;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = (iso) => addDays(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
function isoWeekNo(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
const toMin = (x) => { const [h, m] = x.split(/[:.]/).map(Number); return h * 60 + (m || 0); };
const fmtTime = (x) => (state.lang === 'fi' ? x.replace(':', '.') : x);

// { text, closed, open, later } valitulle päivälle
function openStatus(r, date, hasMenu) {
  const h = r.hoursByDate?.[date];
  if (!hasMenu) return { text: h ? t('lunchAt', h.split('–').map(fmtTime).join('–')) : '', closed: true };
  if (!h) return { text: '', closed: false };
  const [a, b] = h.split('–');
  if (date !== todayIso() || !a || !b) return { text: t('lunchAt', `${fmtTime(a)}–${fmtTime(b ?? '')}`), closed: false };
  const now = nowMinutes();
  if (now < toMin(a)) return { text: t('opensAt', fmtTime(a), fmtTime(b)), closed: false, later: true };
  if (now < toMin(b)) return { text: t('openUntil', fmtTime(b)), closed: false, open: true };
  return { text: t('closedToday', fmtTime(b)), closed: true };
}

// ---------- Etäisyys ----------
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace('.', state.lang === 'fi' ? ',' : '.')} km`);
const distOf = (r) => (state.pos ? distanceKm(state.pos, r) : null);

// ---------- Ravintoarvot ----------
// Annoksen arvot / 100 g = ensimmäinen komponentti, jolla on ravintotiedot (yleensä pääruoka).
const mainNutrition = (dish) => dish.items.find((i) => i.nutrition)?.nutrition ?? null;

// Koko annoksen arvio: oletetaan tavallinen annoskoko komponentin tyypin mukaan.
const SAUCE_RE = /(kastike|kastiketta|kastikkeessa|majoneesi|dippi|dressing|pesto|salsa|sauce|mayo|aioli|tzatziki|chutney|hillo|raikas jogurtti)/i;
const SIDE_SALAD_RE = /(salaatti|salad|coleslaw|raaste)/i;
function portionGrams(it, idx) {
  if (idx === 0) return /keitto|soup/i.test(it.name) ? 300 : 200; // pääruoka
  if (SAUCE_RE.test(it.name)) return 50;
  if (SIDE_SALAD_RE.test(it.name)) return 80;
  return 150;
}
function plateEstimate(dish) {
  let grams = 0, have = 0;
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  dish.items.forEach((it, i) => {
    const g = portionGrams(it, i);
    grams += g;
    if (!it.nutrition) return;
    have++;
    for (const k of Object.keys(sum)) sum[k] += ((it.nutrition[k] ?? 0) * g) / 100;
  });
  if (!have) return null;
  return { ...sum, grams, complete: have === dish.items.length };
}

const fmt1 = (v) => { const s = (Math.round(v * 10) / 10).toString(); return state.lang === 'fi' ? s.replace('.', ',') : s; };
const METRICS = {
  protein: { label: 'metricProtein', unit: 'g / 100 g', value: (d) => mainNutrition(d)?.protein, dir: -1, fmt: (v) => `${fmt1(v)} g` },
  plate: { label: 'metricPlate', unit: 'g', value: (d) => plateEstimate(d)?.protein, dir: -1, fmt: (v) => `≈${Math.round(v)} g` },
  density: { label: 'metricDensity', unit: 'g / 100 kcal', value: (d) => { const n = mainNutrition(d); return n?.protein != null && n.kcal ? (n.protein / n.kcal) * 100 : null; }, dir: -1, fmt: (v) => `${fmt1(v)} g` },
  kcal: { label: 'metricKcal', unit: 'kcal / 100 g', value: (d) => mainNutrition(d)?.kcal, dir: 1, fmt: (v) => `${Math.round(v)}` },
};

function macrosHtml(dish) {
  const n = mainNutrition(dish);
  if (!n) return `<div class="nodata">${t('noData')}</div>`;
  const parts = [];
  if (n.protein != null) parts.push(`<span class="macro p">P ${fmt1(n.protein)} g</span>`);
  if (n.kcal != null) parts.push(`<span class="macro">${Math.round(n.kcal)} kcal</span>`);
  if (n.carbs != null) parts.push(`<span class="macro">HH ${fmt1(n.carbs)} g</span>`);
  if (n.fat != null) parts.push(`<span class="macro">R ${fmt1(n.fat)} g</span>`);
  const p = plateEstimate(dish);
  const plate = p ? `<div class="plate">${t('plate')} ≈${Math.round(p.grams)} g (${t('estimate')}${p.complete ? '' : ', ' + t('partial')}): <strong>P ${Math.round(p.protein)} g</strong> · ${Math.round(p.kcal)} kcal</div>` : '';
  return `<div class="macros">${parts.join('')}<span class="meta">${t('per100')}</span></div>${plate}`;
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
const restaurantById = (id) => state.data.restaurants.find((r) => r.id === id);
const dishKey = (rid, date, idx) => `${rid}|${date}|${idx}`;
function dishByKey(key) {
  const [rid, date, idx] = key.split('|');
  const r = restaurantById(rid);
  const d = r && dishesOf(r, date)[Number(idx)];
  return d ? { r, d, date } : null;
}

// ---------- Suunnitelma ----------
function planEntryFromDish(r, d) {
  const p = plateEstimate(d);
  const main = d.items.find((i) => i.nutrition) ?? d.items[0];
  return {
    name: main.name, name_en: main.name_en, rid: r.id, rname: r.name, price: d.price,
    n: p ? { protein: Math.round(p.protein), kcal: Math.round(p.kcal) } : null,
  };
}
function setPlan(date, slot, entry) {
  state.plan[date] = { ...(state.plan[date] ?? {}) };
  if (entry) state.plan[date][slot] = entry; else delete state.plan[date][slot];
  if (!Object.keys(state.plan[date]).length) delete state.plan[date];
  // Vanhat (yli 8 viikkoa) suunnitelmat pois
  const cutoff = addDays(todayIso(), -56);
  for (const k of Object.keys(state.plan)) if (k < cutoff) delete state.plan[k];
  store.set('plan', state.plan);
}
const entryName = (e) => (state.lang === 'en' && e.name_en) || e.name;

function showToast(msg) {
  state.toast = msg;
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Näkymät: ravintolalista ----------
function itemHtml(it, extra = '') {
  const on = isFav(it.name);
  return `<div class="item">
    ${extra}<span class="name">${esc(itemName(it))}${it.diets?.length ? ` <span class="diets">${esc(it.diets.join(', '))}</span>` : ''}</span>
    <button class="star ${on ? 'on' : ''}" data-fav="${esc(it.name)}" aria-pressed="${on}" aria-label="${on ? t('favRemove') : t('favAdd')}">${on ? '★' : '☆'}</button>
  </div>`;
}

function dishHtml(r, d, date, idx) {
  const fav = d.items.some((i) => isFav(i.name));
  const key = dishKey(r.id, date, idx);
  // Sodexo antaa englanniksi vain koko annoksen otsikon.
  const items = state.lang === 'en' && d.title_en
    ? `<div class="item"><span class="name">${esc(d.title_en)}${d.items[0].diets?.length ? ` <span class="diets">${esc(d.items[0].diets.join(', '))}</span>` : ''}</span>
        <button class="star ${isFav(d.items[0].name) ? 'on' : ''}" data-fav="${esc(d.items[0].name)}">${isFav(d.items[0].name) ? '★' : '☆'}</button></div>`
    : d.items.map((it) => itemHtml(it)).join('');
  const picking = state.picker === key;
  return `<div class="dish ${fav ? 'has-fav' : ''}">
    ${d.line || d.price ? `<div class="line"><span>${esc(d.line)}</span><span>${esc(d.price)}</span></div>` : ''}
    ${items}
    ${macrosHtml(d)}
    <div class="dish-actions">
      ${picking
        ? `<span class="meta">${t('pickSlot')}</span><button class="chip" data-place="${key}" data-slot="lunch">${t('lunch')}</button><button class="chip" data-place="${key}" data-slot="dinner">${t('dinner')}</button><button class="linklike" data-pick="">${t('cancel')}</button>`
        : `<button class="linklike" data-pick="${key}">${t('addToPlan')}</button>`}
    </div>
  </div>`;
}

const mapsUrl = (r) => `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`;

function restaurantCard(r) {
  const all = dishesOf(r);
  const st = openStatus(r, state.date, all.length > 0);
  const collapsed = state.collapsed.has(r.id);
  const km = distOf(r);
  const shown = all.map((d, i) => [d, i]).filter(([d]) => passes(d));
  let body = '';
  if (!collapsed) {
    if (!all.length) body = `<p class="empty">${state.data.errors?.[r.id] ? t('fetchFailed') : t('noMenu')}</p>`;
    else if (!shown.length) body = `<p class="empty">${t('noMatch')}</p>`;
    else body = shown.map(([d, i]) => dishHtml(r, d, state.date, i)).join('') + (shown.length < all.length ? `<p class="empty">${t('hiddenByFilter', all.length - shown.length)}</p>` : '');
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
      <div class="meta">${esc(r.campus)} · ${esc(CHAINS[r.chain] ?? r.chain)}${st.text ? ` · <span class="${st.open ? 'open' : ''}">${esc(st.text)}</span>` : ''}${collapsed && shown.length ? ` · ${t('dishesCount', shown.length)}` : ''}</div>
      ${body}
      ${collapsed ? '' : `<div class="card-actions">
        <a href="${mapsUrl(r)}" target="_blank" rel="noopener">${t('route')}</a>
        <button data-weekof="${r.id}">${t('week')}</button>
        <button data-hide="${r.id}">${t('hide')}</button>
      </div>`}
    </section>`,
    r,
  };
}

// Tänään tarjolla olevat suosikit
function favouritesToday() {
  const today = todayIso();
  const hits = [];
  for (const r of visibleRestaurants()) for (const d of dishesOf(r, today)) for (const it of d.items) if (isFav(it.name)) hits.push({ r, it });
  return hits;
}

function bannersHtml() {
  let html = '';
  const today = todayIso();
  if (state.date === today) {
    const fav = favouritesToday();
    if (fav.length) html += `<div class="banner fav"><strong>${t('favToday')}</strong>${fav.map((h) => `<div>${esc(itemName(h.it))} – ${esc(h.r.name)}${distOf(h.r) != null ? ` · ${fmtDist(distOf(h.r))}` : ''}</div>`).join('')}</div>`;
    const p = state.plan[today];
    if (p && (p.lunch || p.dinner)) {
      html += `<div class="banner plan"><strong>${t('planToday')}</strong>${['lunch', 'dinner'].filter((s) => p[s]).map((s) => `<div>${t(s)}: ${esc(entryName(p[s]))}${p[s].rname ? ` – ${esc(p[s].rname)}` : ''}</div>`).join('')}</div>`;
    }
  }
  html += `<button class="gonow" data-gonow>${t('goNow')}</button>`;
  if (state.goNow === 'needloc') html += `<div class="banner">${t('goNowNeedsLoc')}</div>`;
  else if (state.goNow && state.goNow !== 'needloc') {
    // Lasketaan uudelleen, jotta suodattimien muutokset näkyvät heti.
    if (state.pos) state.goNow = computeGoNow();
  }
  if (state.goNow === 'none') html += `<div class="banner">${t('goNowNone')}</div>`;
  else if (state.goNow?.r) {
    const { r, dishes, st } = state.goNow;
    html += `<div class="banner go"><strong>${t('goNowTitle')}: ${esc(r.name)} · ${fmtDist(distOf(r))}</strong><div class="meta">${esc(st.text)}</div>
      ${dishes.slice(0, 3).map((d) => `<div>• ${esc(itemName(d.items.find((i) => i.nutrition) ?? d.items[0]))}${mainNutrition(d)?.protein != null ? ` <span class="meta">(P ${fmt1(mainNutrition(d).protein)} g/100 g)</span>` : ''}</div>`).join('')}
      <div class="pop-actions"><button class="chip" data-showlist="${r.id}">${t('tabList')}</button><a class="chip" href="${mapsUrl(r)}" target="_blank" rel="noopener">${t('route')}</a></div></div>`;
  }
  return html;
}

function computeGoNow() {
  const today = todayIso();
  const cands = [];
  for (const r of visibleRestaurants()) {
    const all = dishesOf(r, today);
    const st = openStatus(r, today, all.length > 0);
    const dishes = all.filter(passes).sort((a, b) => (mainNutrition(b)?.protein ?? -1) - (mainNutrition(a)?.protein ?? -1));
    if (st.closed || !dishes.length) continue;
    cands.push({ r, dishes, st, km: distOf(r), score: distOf(r) + (st.later ? 0.5 : 0) });
  }
  cands.sort((a, b) => a.score - b.score);
  return cands[0] ?? 'none';
}

function renderList() {
  if (state.weekOf) return renderWeekOf();
  const cards = visibleRestaurants().map(restaurantCard);
  cards.sort((a, b) => a.rank - b.rank || (state.pos ? distOf(a.r) - distOf(b.r) : 0));
  const hidden = state.data.restaurants.filter((r) => state.hidden.has(r.id));
  let footer = '';
  if (hidden.length) {
    footer = `<div class="hidden-box">
      <button class="linklike" data-showhidden>${state.showHidden ? '▾' : '▸'} ${t('hiddenRestaurants', hidden.length)}</button>
      ${state.showHidden ? hidden.map((r) => `<div class="hidden-row"><span>${esc(r.name)}</span><button class="chip" data-unhide="${r.id}">${t('show')}</button></div>`).join('') : ''}
    </div>`;
  }
  return bannersHtml() + cards.map((c) => c.html).join('') + footer;
}

// Yhden ravintolan koko viikko
function renderWeekOf() {
  const r = restaurantById(state.weekOf);
  if (!r) { state.weekOf = null; return renderList(); }
  const today = todayIso();
  const dates = Object.keys(state.data.menus[r.id] ?? {}).filter((d) => d >= today).sort();
  return `<button class="linklike back" data-weekof="">${t('back')}</button>
    <h2 class="view-title">${esc(t('weekOf', r.name))}</h2>
    ${dates.length ? dates.map((date) => {
      const all = dishesOf(r, date);
      const shown = all.map((d, i) => [d, i]).filter(([d]) => passes(d));
      const st = openStatus(r, date, all.length > 0);
      return `<section class="card"><div class="card-head"><h2>${dayLabel(date, true)}</h2></div>
        ${st.text ? `<div class="meta">${esc(st.text)}</div>` : ''}
        ${shown.length ? shown.map(([d, i]) => dishHtml(r, d, date, i)).join('') : `<p class="empty">${t('noMatch')}</p>`}
      </section>`;
    }).join('') : `<p class="muted center">${t('noMenu')}</p>`}`;
}

// ---------- Rankkaus ----------
function renderRank() {
  const m = METRICS[state.metric] ?? METRICS.protein;
  const rows = [];
  let missing = 0, hidden = 0;
  for (const r of visibleRestaurants()) {
    dishesOf(r).forEach((d, idx) => {
      if (!passes(d)) { hidden++; return; }
      const v = m.value(d);
      if (v == null) { missing++; return; }
      rows.push({ r, d, v, idx });
    });
  }
  rows.sort((a, b) => m.dir * (a.v - b.v));

  let list = rows;
  if (state.rankMode === 'restaurants') {
    const seen = new Set();
    list = rows.filter((x) => (seen.has(x.r.id) ? false : seen.add(x.r.id)));
  }

  const toolbar = `<div class="toolbar">
    <select id="metric" aria-label="${t('sortBy')}">
      ${Object.entries(METRICS).map(([k, v]) => `<option value="${k}" ${k === state.metric ? 'selected' : ''}>${t(v.label)}</option>`).join('')}
    </select>
    <div class="seg" role="group">
      <button data-mode="dishes" class="${state.rankMode === 'dishes' ? 'active' : ''}">${t('dishes')}</button>
      <button data-mode="restaurants" class="${state.rankMode === 'restaurants' ? 'active' : ''}">${t('restaurants')}</button>
    </div>
  </div>
  <p class="note">${t('rankNote')}${state.rankMode === 'restaurants' ? t('rankRestNote') : ''}${missing ? `<strong>${t('missingNote', missing)}</strong>` : ''}${filtersOn() ? t('filterHides', hidden) : ''}</p>`;

  if (!list.length) return toolbar + `<p class="muted center">${t('noNutritionDay')}</p>`;

  return toolbar + list.map((x, i) => {
    const km = distOf(x.r);
    const main = x.d.items.find((it) => it.nutrition) ?? x.d.items[0];
    const others = x.d.items.filter((it) => it !== main).map(itemName);
    return `<section class="card rank">
      <div class="pos">${i + 1}</div>
      <div class="body">
        <div class="item"><span class="name"><strong>${esc(itemName(main))}</strong></span>
          <button class="star ${isFav(main.name) ? 'on' : ''}" data-fav="${esc(main.name)}">${isFav(main.name) ? '★' : '☆'}</button></div>
        ${others.length ? `<div class="meta">+ ${esc(others.join(', '))}</div>` : ''}
        <div class="meta">${esc(x.r.name)}${km != null ? ` · <span class="dist">${fmtDist(km)}</span>` : ''}${x.d.price ? ` · ${esc(x.d.price)}` : ''}</div>
        ${macrosHtml(x.d)}
      </div>
      <div class="value">${m.fmt(x.v)}<small>${m.unit}</small></div>
    </section>`;
  }).join('');
}

// ---------- Etsi + suosikit ----------
function renderSearch() {
  const q = normName(state.search);
  const today = todayIso();
  let results = '';
  if (q.length >= 2) {
    const groups = new Map();
    for (const r of visibleRestaurants()) {
      for (const [date, dishes] of Object.entries(state.data.menus[r.id] ?? {})) {
        if (date < today) continue;
        for (const d of dishes) {
          if (!passes(d)) continue;
          for (const it of d.items) {
            if (!normName(it.name).includes(q) && !normName(it.name_en ?? '').includes(q)) continue;
            const g = groups.get(normName(it.name)) ?? { it, hits: [] };
            g.hits.push({ r, date });
            groups.set(normName(it.name), g);
          }
        }
      }
    }
    results = groups.size
      ? [...groups.values()].slice(0, 40).map((g) => {
          g.hits.sort((a, b) => a.date.localeCompare(b.date) || (distOf(a.r) ?? 0) - (distOf(b.r) ?? 0));
          return `<section class="card">${itemHtml(g.it)}${g.hits.map((h) => `<div class="meta">${dayLabel(h.date)} · ${esc(h.r.name)}${distOf(h.r) != null ? ` · ${fmtDist(distOf(h.r))}` : ''}</div>`).join('')}</section>`;
        }).join('')
      : `<p class="muted center">${t('searchNone')}</p>`;
  }

  return `<input id="search" class="search" type="search" placeholder="${esc(t('searchPlaceholder'))}" value="${esc(state.search)}" autocomplete="off">
    <p class="meta search-hint">${t('searchHint')}</p>
    <div id="search-results">${results}</div>
    <h2 class="view-title">${t('favourites')}</h2>
    ${notifyHtml()}
    ${renderFavs()}`;
}

function renderFavs() {
  if (!state.favs.size) return `<p class="muted">${t('noFavs')}</p>`;
  const today = todayIso();
  const found = new Map([...state.favs].map((k) => [k, { it: null, hits: [] }]));
  for (const r of state.data.restaurants) {
    for (const [date, dishes] of Object.entries(state.data.menus[r.id] ?? {})) {
      if (date < today) continue;
      for (const d of dishes) for (const it of d.items) {
        const f = found.get(normName(it.name));
        if (f) { f.it = it; f.hits.push({ r, date }); }
      }
    }
  }
  return [...found.entries()].map(([k, f]) => {
    f.hits.sort((a, b) => a.date.localeCompare(b.date) || (distOf(a.r) ?? 0) - (distOf(b.r) ?? 0));
    const label = f.it ? itemName(f.it) : k;
    return `<section class="card">
      <div class="item"><span class="name"><strong>${esc(label)}</strong></span>
        <button class="star on" data-fav="${esc(f.it?.name ?? k)}" aria-label="${t('favRemove')}">★</button></div>
      ${f.hits.length
        ? f.hits.map((h) => `<div class="meta">${dayLabel(h.date)} · ${esc(h.r.name)}${distOf(h.r) != null ? ` · ${fmtDist(distOf(h.r))}` : ''}</div>`).join('')
        : `<p class="empty">${t('notOffered')}</p>`}
    </section>`;
  }).join('');
}

// ---------- Ilmoitukset ----------
const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;
function notifyHtml() {
  if (!notifySupported()) return '';
  const perm = Notification.permission;
  if (perm === 'denied') return `<p class="note">${t('notifyDenied')}</p>`;
  const on = perm === 'granted' && store.get('notify', false);
  return `<div class="notify"><button class="chip ${on ? 'active' : ''}" data-notify>${on ? t('notifyEnabled') : t('notifyOn')}</button>
    <p class="meta">${t('notifyInfo')}</p></div>`;
}

// Tallennetaan suosikit service workerin luettavaksi (se ei näe localStoragea).
async function syncPrefsToSW() {
  try {
    const c = await caches.open('safkatrack-prefs');
    await c.put('prefs.json', new Response(JSON.stringify({ favs: [...state.favs], notify: store.get('notify', false), lang: state.lang, title: t('notifyTitle') })));
  } catch { /* ei välimuistia */ }
}

async function enableNotifications() {
  if (store.get('notify', false) && Notification.permission === 'granted') {
    store.set('notify', false);
    await syncPrefsToSW();
    return render();
  }
  const perm = await Notification.requestPermission();
  store.set('notify', perm === 'granted');
  await syncPrefsToSW();
  if (perm === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) await reg.periodicSync.register('favs-check', { minInterval: 12 * 60 * 60 * 1000 });
    } catch { /* taustatarkistus ei käytössä */ }
    notifyFavouritesToday(true);
  }
  render();
}

// Näyttää ilmoituksen tämän päivän suosikeista kerran päivässä.
async function notifyFavouritesToday(force = false) {
  if (!notifySupported() || Notification.permission !== 'granted' || !store.get('notify', false)) return;
  const today = todayIso();
  if (!force && store.get('notifiedOn', '') === today) return;
  const hits = favouritesToday();
  if (!hits.length) return;
  store.set('notifiedOn', today);
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(t('notifyTitle'), {
      body: hits.slice(0, 4).map((h) => `${itemName(h.it)} – ${h.r.name}`).join('\n'),
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'favs-' + today,
    });
    await caches.open('safkatrack-prefs').then((c) => c.put('notified.json', new Response(JSON.stringify({ date: today }))));
  } catch { /* ei ilmoitusta */ }
}

// ---------- Suunnitelma ----------
function renderPlan() {
  const monday = state.planWeek ?? mondayOf(state.date ?? todayIso());
  state.planWeek = monday;
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Lukujärjestys: sarakkeina päivät, riveinä lounas ja päivällinen.
  const shortDay = (date) => {
    const d = new Date(date + 'T12:00:00');
    return `<span class="tt-wd">${WD[state.lang][d.getDay()]}</span><span class="tt-date">${d.getDate()}.${d.getMonth() + 1}.</span>`;
  };
  const cell = (date, slot) => {
    const e = state.plan[date]?.[slot];
    const key = `${date}|${slot}`;
    const sel = state.planDetail === key ? ' selected' : '';
    return `<div class="tt-cell ${e ? 'filled' : ''}${date === todayIso() ? ' today' : ''}${sel}" data-dropslot="${key}">
      ${e
        ? `<button class="tt-entry" data-dragentry="${key}" data-detail="${key}" title="${esc(entryName(e))}">
            <span class="tt-name">${esc(entryName(e))}</span>${e.rname ? `<span class="tt-sub">${esc(e.rname)}</span>` : ''}</button>`
        : `<button class="tt-add" data-slotpick="${key}" aria-label="${t(slot)}">+</button>`}
    </div>`;
  };
  const total = (date) => {
    const es = ['lunch', 'dinner'].map((s) => state.plan[date]?.[s]).filter((e) => e?.n);
    if (!es.length) return '<div class="tt-total"></div>';
    return `<div class="tt-total">P ≈${es.reduce((a, e) => a + e.n.protein, 0)} g<br>${es.reduce((a, e) => a + e.n.kcal, 0)} kcal</div>`;
  };
  const grid = `<div class="tt">
      ${days.map((d) => `<div class="tt-day${d === todayIso() ? ' today' : ''}">${shortDay(d)}</div>`).join('')}
      <div class="tt-row">${t('lunch')}</div>
      ${days.map((d) => cell(d, 'lunch')).join('')}
      <div class="tt-row">${t('dinner')}</div>
      ${days.map((d) => cell(d, 'dinner')).join('')}
      <div class="tt-row">${t('planDayTotal')}</div>
      ${days.map(total).join('')}
    </div>`;

  // Napautetun ruoan tiedot
  let detail = '';
  if (state.planDetail) {
    const [dd, ds] = state.planDetail.split('|');
    const e = state.plan[dd]?.[ds];
    if (e) {
      detail = `<section class="card tt-detail">
        <div class="meta">${dayLabel(dd, true)} · ${t(ds)}</div>
        <strong>${esc(entryName(e))}</strong>
        ${e.rname ? `<div class="meta">${esc(e.rname)}${e.price ? ` · ${esc(e.price)}` : ''}</div>` : ''}
        ${e.n ? `<div class="plate">${t('plate')} (${t('estimate')}): <strong>P ≈${e.n.protein} g</strong> · ${e.n.kcal} kcal</div>` : ''}
        <div class="dish-actions"><button class="chip" data-unplan="${state.planDetail}">✕ ${t('remove')}</button><button class="linklike" data-detail="">${t('close')}</button></div>
      </section>`;
    } else state.planDetail = null;
  }

  // Lähde: valitun päivän ruoat
  const src = [];
  const sorted = [...visibleRestaurants()].sort((a, b) => (state.pos ? distOf(a) - distOf(b) : 0));
  for (const r of sorted) dishesOf(r).forEach((d, i) => { if (passes(d)) src.push({ r, d, i }); });
  const source = src.length
    ? src.map(({ r, d, i }) => {
        const key = dishKey(r.id, state.date, i);
        const main = d.items.find((it) => it.nutrition) ?? d.items[0];
        const p = plateEstimate(d);
        return `<div class="src" data-dragdish="${key}"><span class="handle" aria-hidden="true">⠿</span>
          <div class="slot-text"><div>${esc(itemName(main))}</div><div class="meta">${esc(r.name)}${p ? ` · P ≈${Math.round(p.protein)} g` : ''}</div></div>
          <div class="src-btns"><button class="chip" data-place="${key}" data-slot="lunch">+ ${t('lunch')}</button><button class="chip" data-place="${key}" data-slot="dinner">+ ${t('dinner')}</button></div>
        </div>`;
      }).join('')
    : `<p class="muted">${t('noMenu')}</p>`;

  const pickSlot = state.slotPick;
  return `<h2 class="view-title">${t('planTitle')}</h2>
    <div class="toolbar plan-nav">
      <button class="chip" data-planweek="-7">${t('prevWeek')}</button>
      <strong>${t('weekLabel', isoWeekNo(monday))}</strong>
      <button class="chip" data-planweek="7">${t('nextWeek')}</button>
    </div>
    <p class="note">${t('planHint')}</p>
    ${grid}
    ${detail}
    ${pickSlot ? ownMealHtml(pickSlot) : ''}
    <div class="toolbar"><button class="chip" data-planshare>${t('planShare')}</button><button class="chip" data-planclear>${t('planClear')}</button></div>
    <h2 class="view-title">${t('planSource', dayLabel(state.date, true))}</h2>
    <div class="sources">${source}</div>`;
}

// Tyhjää paikkaa painettaessa: oma ruoka tai valinta päivän listalta
function ownMealHtml(slotKey) {
  const [date, slot] = slotKey.split('|');
  const opts = [];
  for (const r of visibleRestaurants()) dishesOf(r, date).forEach((d, i) => { if (passes(d)) opts.push({ r, d, i }); });
  return `<section class="card picker">
    <div class="card-head"><h2>${dayLabel(date, true)} · ${t(slot)}</h2><button class="linklike" data-slotpick="">${t('cancel')}</button></div>
    <div class="own"><input id="own-meal" type="text" placeholder="${esc(t('planOwnPlaceholder'))}" aria-label="${esc(t('planOwn'))}"><button class="chip active" data-ownadd="${slotKey}">${t('add')}</button></div>
    ${opts.slice(0, 60).map(({ r, d, i }) => {
      const main = d.items.find((it) => it.nutrition) ?? d.items[0];
      return `<button class="pick-row" data-place="${dishKey(r.id, date, i)}" data-slot="${slot}"><span>${esc(itemName(main))}</span><span class="meta">${esc(r.name)}</span></button>`;
    }).join('')}
  </section>`;
}

function planAsText() {
  const monday = state.planWeek;
  const lines = [`${t('planTitle')} – ${t('weekLabel', isoWeekNo(monday))}`];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const p = state.plan[date];
    if (!p) continue;
    lines.push('', dayLabel(date, true));
    for (const s of ['lunch', 'dinner']) if (p[s]) lines.push(`  ${t(s)}: ${entryName(p[s])}${p[s].rname ? ` (${p[s].rname})` : ''}`);
  }
  return lines.join('\n');
}

// ---------- Raahaus (hiiri ja kosketus) ----------
// Lähdelistassa raahaus alkaa ⠿-kahvasta (jotta sivu vierii normaalisti),
// lukujärjestyksessä koko ruoasta. Raahaus alkaa vasta kun osoitin liikkuu,
// joten pelkkä napautus toimii tavallisena painalluksena.
let drag = null, pending = null;
document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  const src = handle ? handle.closest('[data-dragdish],[data-dragentry]') : e.target.closest('.tt-entry[data-dragentry]');
  if (!src) return;
  if (handle) e.preventDefault();
  pending = { src, x: e.clientX, y: e.clientY };
});
function startDrag(e) {
  const { src } = pending;
  pending = null;
  const r = src.getBoundingClientRect();
  const ghost = src.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = `${Math.max(r.width, 120)}px`;
  document.body.appendChild(ghost);
  drag = { src, ghost, dish: src.dataset.dragdish, entry: src.dataset.dragentry, dx: Math.min(e.clientX - r.left, 60), dy: e.clientY - r.top };
  moveGhost(e);
}
function moveGhost(e) {
  if (!drag) return;
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
  document.querySelectorAll('.over').forEach((s) => s.classList.remove('over'));
  drag.ghost.style.display = 'none';
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dropslot]');
  drag.ghost.style.display = '';
  under?.classList.add('over');
  // Vieritä, kun raahataan lähelle reunaa
  if (e.clientY < 90) window.scrollBy(0, -12);
  else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 12);
}
document.addEventListener('pointermove', (e) => {
  if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) startDrag(e);
  if (drag) { e.preventDefault(); moveGhost(e); }
}, { passive: false });
// Estetään napautus raahauksen jälkeen
let suppressClick = false;
document.addEventListener('click', (e) => { if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('pointerup', (e) => {
  pending = null;
  if (!drag) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  drag.ghost.style.display = 'none';
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dropslot]');
  drag.ghost.remove();
  const { dish, entry } = drag;
  drag = null;
  if (!target) return render();
  const [date, slot] = target.dataset.dropslot.split('|');
  if (dish) {
    const found = dishByKey(dish);
    if (found) setPlan(date, slot, planEntryFromDish(found.r, found.d));
  } else if (entry) {
    const [fd, fs] = entry.split('|');
    if (fd === date && fs === slot) return render();
    const moving = state.plan[fd]?.[fs];
    const swap = state.plan[date]?.[slot];
    setPlan(date, slot, moving);
    setPlan(fd, fs, swap ?? null);
  }
  render();
});
document.addEventListener('pointercancel', () => { pending = null; if (drag) { drag.ghost.remove(); drag = null; } });

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
    <span class="meta">${esc(st.text || (all.length ? '' : t('noMenu')))}</span>
    ${best ? `<div class="pop-best">💪 ${esc(itemName(best.d.items.find((i) => i.nutrition) ?? best.d.items[0]))} – ${fmt1(best.p)} g / 100 g</div>` : ''}
    <div class="pop-actions"><button class="chip" data-showlist="${r.id}">${t('tabList')}</button>
    <a class="chip" href="${mapsUrl(r)}" target="_blank" rel="noopener">${t('route')}</a></div>
  </div>`;
}

async function renderMap() {
  const view = $('#view');
  if (!$('#map')) {
    view.innerHTML = `<div id="map" class="map"><p class="muted center">…</p></div>`;
    sizeMap();
    try { await loadLeaflet(); } catch {
      $('#map').innerHTML = `<p class="center warn">${t('loadFailed')}</p>`;
      return;
    }
    if (state.tab !== 'map' || !$('#map')) return;
    $('#map').innerHTML = '';
    map = L.map('map', { zoomControl: true }).setView([60.452, 22.28], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
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
  if (state.pos) markerLayer.addLayer(L.circleMarker([state.pos.lat, state.pos.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }));
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
    : `<span class="meta">${t('noUpcoming')}</span>`;
  const nAlg = state.allergies.size;
  $('#filters').innerHTML = `
    <select id="diet" aria-label="Diet" class="${state.diet !== 'all' ? 'on' : ''}">
      ${Object.entries(DIETS).map(([k, v]) => `<option value="${k}" ${k === state.diet ? 'selected' : ''}>${t(v.label)}</option>`).join('')}
    </select>
    <button id="cheap" class="chip" aria-pressed="${state.cheapOnly}">${t('maxPrice')}</button>
    <button id="alg" class="chip ${nAlg ? 'active' : ''}" aria-expanded="${state.showAllergies}">${t('allergies')}${nAlg ? ` (${nAlg})` : ''} ${state.showAllergies ? '▴' : '▾'}</button>`;
  $('#allergy-row').innerHTML = state.showAllergies
    ? `<span class="meta">${t('allergiesHint')}</span>${ALLERGENS.map((a) => `<button class="chip ${state.allergies.has(a) ? 'active' : ''}" data-alg="${a}">${t('alg_' + a)}</button>`).join('')}<p class="meta">${t('allergyNote')}</p>`
    : '';
  const hideDays = state.tab === 'search';
  $('#days').style.display = hideDays ? 'none' : '';
  $('#locate').textContent = state.pos ? t('locate') : t('locate');
  $('#lang').textContent = t('lang');
  document.documentElement.lang = state.lang;
  document.querySelectorAll('.tabs button').forEach((b) => { b.querySelector('.lbl').textContent = t({ list: 'tabList', rank: 'tabRank', map: 'tabMap', plan: 'tabPlan', search: 'tabSearch' }[b.dataset.tab]); });
}

function render() {
  if (!state.data) return;
  renderTop();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (state.tab === 'map') return renderMap();
  if (map) { map.remove(); map = null; markerLayer = null; }
  const active = document.activeElement?.id;
  const caret = active === 'search' ? document.activeElement.selectionStart : null;
  $('#view').innerHTML =
    state.tab === 'rank' ? renderRank()
    : state.tab === 'search' ? renderSearch()
    : state.tab === 'plan' ? renderPlan()
    : renderList();
  if (active === 'search') { const s = $('#search'); s.focus(); s.setSelectionRange(caret, caret); }
  renderStatus();
}

function renderStatus() {
  const g = new Date(state.data.generatedAt);
  $('#status').textContent = `${t('updated')} ${g.toLocaleString(state.lang === 'fi' ? 'fi-FI' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${t('sources')}`;
}

// ---------- Tapahtumat ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const ds = b.dataset;
  if (ds.fav != null) { toggleIn('favs', normName(ds.fav)); syncPrefsToSW(); return render(); }
  if (ds.date) { state.date = ds.date; state.planWeek = null; state.picker = null; return render(); }
  if (ds.tab) { state.tab = ds.tab; store.set('tab', state.tab); state.weekOf = null; window.scrollTo(0, 0); return render(); }
  if (ds.mode) { state.rankMode = ds.mode; store.set('rankMode', state.rankMode); return render(); }
  if (ds.collapse) { toggleIn('collapsed', ds.collapse); return render(); }
  if (ds.hide) { toggleIn('hidden', ds.hide); return render(); }
  if (ds.unhide) { toggleIn('hidden', ds.unhide); return render(); }
  if (ds.showhidden != null) { state.showHidden = !state.showHidden; return render(); }
  if (ds.weekof != null) { state.weekOf = ds.weekof || null; window.scrollTo(0, 0); return render(); }
  if (ds.alg) { toggleIn('allergies', ds.alg); return render(); }
  if (ds.pick != null) { state.picker = ds.pick || null; return render(); }
  if (ds.place) {
    const found = dishByKey(ds.place);
    if (found) {
      setPlan(found.date, ds.slot, planEntryFromDish(found.r, found.d));
      showToast(`${t('added')}: ${dayLabel(found.date, true)} · ${t(ds.slot)}`);
    }
    state.picker = null;
    state.slotPick = null;
    return render();
  }
  if (ds.slotpick != null) { state.slotPick = ds.slotpick || null; state.planDetail = null; render(); if (state.slotPick) $('#own-meal')?.focus(); return; }
  if (ds.ownadd) {
    const v = $('#own-meal')?.value.trim();
    if (v) { const [date, slot] = ds.ownadd.split('|'); setPlan(date, slot, { name: v, own: true }); }
    state.slotPick = null;
    return render();
  }
  if (ds.unplan) { const [date, slot] = ds.unplan.split('|'); setPlan(date, slot, null); state.planDetail = null; return render(); }
  if (ds.detail != null) { state.planDetail = ds.detail && ds.detail !== state.planDetail ? ds.detail : null; state.slotPick = null; return render(); }
  if (ds.planweek) { state.planWeek = addDays(state.planWeek, Number(ds.planweek)); return render(); }
  if (ds.planclear != null) {
    if (!confirm(t('planClearConfirm'))) return;
    for (let i = 0; i < 7; i++) delete state.plan[addDays(state.planWeek, i)];
    store.set('plan', state.plan);
    return render();
  }
  if (ds.planshare != null) {
    const text = planAsText();
    try {
      if (navigator.share) await navigator.share({ title: 'Safkatrack', text });
      else { await navigator.clipboard.writeText(text); showToast(t('copied')); }
    } catch { /* peruttu */ }
    return;
  }
  if (ds.notify != null) return enableNotifications();
  if (ds.gonow != null) {
    if (!state.pos) { state.goNow = 'needloc'; render(); locate(() => { state.goNow = computeGoNow(); render(); }); return; }
    state.goNow = computeGoNow();
    return render();
  }
  if (ds.showlist) {
    const id = ds.showlist;
    state.collapsed.delete(id); store.set('collapsed', [...state.collapsed]);
    state.tab = 'list'; store.set('tab', 'list'); state.weekOf = null;
    render();
    document.getElementById('r-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (b.id === 'cheap') { state.cheapOnly = !state.cheapOnly; store.set('cheapOnly', state.cheapOnly); return render(); }
  if (b.id === 'alg') { state.showAllergies = !state.showAllergies; return render(); }
  if (b.id === 'lang') { state.lang = state.lang === 'fi' ? 'en' : 'fi'; store.set('lang', state.lang); syncPrefsToSW(); return render(); }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'metric') { state.metric = e.target.value; store.set('metric', state.metric); render(); }
  if (e.target.id === 'diet') { state.diet = e.target.value; store.set('diet', state.diet); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'search') { state.search = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'own-meal') $('[data-ownadd]')?.click();
});

function locate(after) {
  const btn = $('#locate');
  if (!('geolocation' in navigator)) { btn.textContent = t('noLocation'); return; }
  btn.textContent = t('locating');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      store.set('useLocation', true);
      btn.setAttribute('aria-pressed', 'true');
      if (after) after(); else render();
      btn.textContent = t('locate');
    },
    () => { btn.textContent = t('locationBlocked'); store.set('useLocation', false); },
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
  $('#view').innerHTML = `<p class="muted center">${t('loading')}</p>`;
  try {
    const res = await fetch('data/menus.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
    render();
    syncPrefsToSW();
    notifyFavouritesToday();
  } catch {
    $('#view').innerHTML = `<p class="center warn">${t('loadFailed')}</p>`;
  }
}

if (store.get('useLocation', false)) locate();
load();
// Aukiolotila päivittyy, vaikka sovellus olisi auki pitkään.
setInterval(() => { if (state.tab === 'list' && !drag) render(); }, 5 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
