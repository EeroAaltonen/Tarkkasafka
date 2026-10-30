// Muuntaa eri ketjujen rajapintojen vastaukset yhteiseen muotoon.
//
// Yhteinen muoto yhdelle ruokalinjalle (dish):
// { line, price, items: [{ name, diets, recipeId?, nutrition }] }
// nutrition = { kcal, protein, carbs, fat } grammoina / 100 g, tai null.

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function normDiets(d) {
  if (!d) return [];
  const arr = Array.isArray(d) ? d : String(d).split(',');
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

// ---------- Unica (Compass-alusta) ----------

// week-menus -> { 'YYYY-MM-DD': [dish] }
export function parseUnicaWeek(json) {
  const out = {};
  for (const day of json?.menus ?? []) {
    const date = String(day.date ?? '').slice(0, 10);
    if (!date) continue;
    const dishes = [];
    const packages = [...(day.menuPackages ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const p of packages) {
      const items = (p.meals ?? [])
        .filter((m) => m?.name)
        .map((m) => ({ name: m.name.trim(), diets: normDiets(m.diets), recipeId: m.recipeId ?? null, nutrition: null }));
      if (items.length) dishes.push({ line: (p.name ?? '').trim(), price: (p.price ?? '').trim(), items });
    }
    if (dishes.length) out[date] = dishes;
  }
  return out;
}

// recipes/<id> -> nutrition
export function parseUnicaRecipe(json) {
  const vals = json?.nutritionalValues;
  if (!Array.isArray(vals) || !vals.length) return null;
  const get = (name) => vals.find((v) => v.name === name)?.amount;
  let kcal = get('EnergyKcal');
  if (kcal == null && get('EnergyKj') != null) kcal = get('EnergyKj') / 4.184;
  const n = { kcal: round1(kcal), protein: round1(get('Protein')), carbs: round1(get('Carbohydrates')), fat: round1(get('Fat')) };
  return n.protein == null && n.kcal == null ? null : n;
}

// ---------- Sodexo ----------

// "Energia kj/Energia kj: 283.27 kj | Proteiini/Proteiini: 3.15 proteiin | ..."
export function parseSodexoNutrients(str) {
  if (!str || typeof str !== 'string') return null;
  const map = {};
  for (const part of str.split('|')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx).split('/')[0].trim().toLowerCase();
    const num = parseFloat(part.slice(idx + 1).trim().replace(',', '.'));
    if (Number.isFinite(num)) map[key] = num;
  }
  let kcal = map['energia kcal'];
  if (kcal == null && map['energia kj'] != null) kcal = map['energia kj'] / 4.184;
  const n = { kcal: round1(kcal), protein: round1(map['proteiini']), carbs: round1(map['hiilihydraatit']), fat: round1(map['rasva']) };
  return n.protein == null && n.kcal == null ? null : n;
}

// daily_json/<id>/<date> -> [dish]
export function parseSodexoDay(json) {
  const courses = json?.courses;
  const list = Array.isArray(courses) ? courses : Object.values(courses ?? {});
  const dishes = [];
  for (const c of list) {
    const recipes = Object.entries(c.recipes ?? {})
      .filter(([k]) => /^\d+$/.test(k))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, r]) => r);
    let items = recipes
      .filter((r) => r?.name)
      .map((r) => ({ name: r.name.trim(), diets: normDiets(r.dietcodes), nutrition: parseSodexoNutrients(r.nutrients) }));
    // Jos reseptejä ei ole eritelty, käytetään ruokalajin otsikkoa.
    if (!items.length && c.title_fi) items = [{ name: c.title_fi.trim(), diets: normDiets(c.dietcodes ?? c.properties), nutrition: null }];
    if (!items.length) continue;
    dishes.push({ line: (c.category ?? '').trim(), price: (c.price ?? '').trim(), title: c.title_fi?.trim(), items });
  }
  return dishes;
}

// Unica feed/json -> { 'YYYY-MM-DD': '10:30–19:45' }
export function parseUnicaHours(json) {
  const out = {};
  for (const d of json?.MenusForDays ?? []) {
    const date = String(d.Date ?? '').slice(0, 10);
    const t = String(d.LunchTime ?? '').trim();
    if (date && t) out[date] = t.replace(/\s*[-–]\s*/, '–').replace(/\./g, ':');
  }
  return out;
}

// ---------- Juvenes (Jamix) ----------

// Etsii rekursiivisesti päiväsolmut ({ date: 20261102, mealoptions: [...] }).
export function parseJamix(json, { price = '' } = {}) {
  const out = {};
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.mealoptions) && node.date != null) {
      const s = String(node.date);
      const date = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10);
      const dishes = out[date] ?? (out[date] = []);
      const opts = [...node.mealoptions].sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0));
      for (const mo of opts) {
        const items = [...(mo.menuItems ?? [])]
          .sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0))
          .filter((m) => m?.name)
          .map((m) => ({ name: m.name.trim(), diets: normDiets(m.diets), nutrition: null }));
        if (items.length) dishes.push({ line: (mo.name ?? '').trim(), price, items });
      }
      if (!dishes.length) delete out[date];
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(json);
  return out;
}

// ---------- Kårkaféerna (HTML-sivu) ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å', euro: '€', ndash: '–', mdash: '—' };
export function htmlToLines(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '')
    // Linkit ja kuvat merkitään omiksi riveikseen, koska ravintolan nimi on
    // sivulla vain logona ja "Viikon lista" -linkin id:ssä.
    .replace(/<a\b[^>]*href="([^"]*viikonlista[^"]*)"[^>]*>/gi, (m, href) => `\n@@link:${href.replace(/&amp;/g, '&')}\n`)
    .replace(/<img\b[^>]*alt="([^"]+)"[^>]*>/gi, (m, alt) => `\n@@img:${alt}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr|td|th|section|article|span|a|strong|b|em|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e] ?? m;
    })
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// "100g sisältää: Energia 182kcal, Suola 790mg, Proteiini 25.9g, Hiilihydraatit 9.4g, Rasva 7.3g."
export function parseKarkaNutrition(line) {
  const num = (re) => { const m = line.match(re); return m ? parseFloat(m[1].replace(',', '.')) : null; };
  const n = { kcal: num(/Energia\s*([\d.,]+)\s*kcal/i), protein: num(/Proteiini\s*([\d.,]+)/i), carbs: num(/Hiilihydraat\w*\s*([\d.,]+)/i), fat: num(/Rasva\s*([\d.,]+)/i) };
  // Pelkät nollat = tietoja ei ole täytetty.
  if (!n.kcal && !n.protein) return null;
  return n;
}

// Rivit, jotka eivät ole ruokien nimiä.
const KARKA_META = [
  /^(Opiskelijat|Jatko-?opiskelijat|Henkilökunta|Muut)\b/i,
  /^Sis\.\s/i, /^100\s*g\s+sisältää/i, /^@@/, /^Viikon lista$/i,
  // Ruokavalioiden selitysrivi, esim. "Laktoositon, gluteeniton, sis. paprikaa/chiliä."
  /^(laktoositon|gluteeniton|maidoton|vegaan|vegaaninen|vegetaarinen|kasvis|pähkinätön|sisältää|kananmunaton|saatavilla)\b/i,
  // Aukioloajat, esim. "MA-PE 11.00-14.30", "LA 12-15"
  /^(MA|TI|KE|TO|PE|LA|SU)(\s*-\s*(MA|TI|KE|TO|PE|LA|SU))?\.?\s+\d/i,
];
const DIET_LINE = /^(\*|[A-Za-zÅÄÖåäö]{1,3})(\s+(\*|[A-Za-zÅÄÖåäö]{1,3}))*$/;
const CAT_NUM = /^\d{1,2}$/;

// Yhden ravintolan osio -> [dish]
// Sivulla ruoan nimi, hintakategoria (numero, nimi, hinnat), ruokavaliokoodit,
// selitys ja ravintoarvot ovat peräkkäisinä riveinä. Hintakategoria voi olla
// joko ruoan perässä tai ennen useampaa ruokaa (koskee silloin kaikkia niitä).
function parseKarkaSection(lines) {
  const dishes = [];
  let cur = null, pending = null, prevTitle = false;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (CAT_NUM.test(l)) {
      const cat = { name: '', price: '' };
      if (i + 1 < lines.length && !KARKA_META.some((re) => re.test(lines[i + 1]))) cat.name = lines[++i];
      while (i + 1 < lines.length && /^(Opiskelijat|Jatko-?opiskelijat|Henkilökunta|Muut)\b/i.test(lines[i + 1])) {
        const pl = lines[++i];
        if (/^Opiskelijat\b/i.test(pl)) cat.price = (pl.match(/\d+[.,]\d+/) ?? [''])[0].replace('.', ',');
      }
      if (cur && !cur.cat) cur.cat = cat;
      else pending = cat;
      prevTitle = false;
      continue;
    }
    if (/^100\s*g\s+sisältää/i.test(l)) { if (cur) cur.item.nutrition = parseKarkaNutrition(l); prevTitle = false; continue; }
    if (KARKA_META.some((re) => re.test(l))) { prevTitle = false; continue; }
    if (/^\([A-Za-zÅÄÖåäö, ]{1,8}\)$/.test(l)) l = l.slice(1, -1).replace(/,/g, ' ');
    if (DIET_LINE.test(l)) { if (cur) cur.item.diets.push(...l.split(/\s+/).filter((c) => c !== '*').map((c) => c.toUpperCase())); prevTitle = false; continue; }
    // Ruoan nimi. Kaksi nimiriviä peräkkäin = otsikko + kuvaus.
    const name = l.replace(/[\s,*"]+$/, '').trim();
    if (prevTitle && cur) {
      cur.heading = cur.heading ? `${cur.heading} · ${cur.item.name}` : cur.item.name;
      cur.item.name = name;
    } else {
      cur = { heading: '', cat: pending, item: { name, diets: [], nutrition: null } };
      dishes.push(cur);
    }
    prevTitle = true;
  }
  return dishes.map((d) => ({
    line: [d.heading, d.cat?.name].filter(Boolean).join(' · '),
    price: d.cat?.price ?? '',
    items: [d.item],
  }));
}

// Päivän sivu -> { karkaId: [dish] }. Osio alkaa ravintolan "Viikon lista" -linkistä.
export function parseKarkaDayById(html) {
  const lines = htmlToLines(html);
  const starts = [];
  lines.forEach((l, i) => { const m = l.match(/^@@link:.*[?&]id=(\d+)/); if (m) starts.push([i, m[1]]); });
  const out = {};
  // Sivun alaosa (yhteydenottolomake, osoitteet) ei kuulu viimeiseen ravintolaan.
  const FOOTER = /^(Juomat|Astra|Arken|Aurum|Kåren|Catering|Lue lisää|Lähetä|Hyvä ruoka, parempi maailma)$/i;
  starts.forEach(([s, id], k) => {
    let section = lines.slice(s + 1, starts[k + 1]?.[0] ?? lines.length);
    const stop = section.findIndex((l) => FOOTER.test(l));
    if (stop >= 0) section = section.slice(0, stop);
    const dishes = parseKarkaSection(section);
    if (dishes.length > (out[id]?.length ?? 0)) out[id] = dishes;
  });
  return out;
}

// Vianetsintää varten: mitä riviä kunkin osion linkkiä edeltää.
export function karkaSectionInfo(html) {
  const lines = htmlToLines(html);
  return lines.flatMap((l, i) => (l.startsWith('@@link:') ? [{ link: l, before: lines.slice(Math.max(0, i - 6), i) }] : []));
}

// Päivän sivu -> { ravintolan nimi: [dish] } (vanha, nimiotsikoiden mukaan)
export function parseKarkaDay(html, names) {
  const lines = htmlToLines(html);
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  const starts = [];
  lines.forEach((l, i) => { if (wanted.has(l.toLowerCase())) starts.push(i); });
  const best = {};
  starts.forEach((s, k) => {
    const name = wanted.get(lines[s].toLowerCase());
    const dishes = parseKarkaSection(lines.slice(s + 1, starts[k + 1] ?? lines.length));
    if (dishes.length > (best[name]?.length ?? 0)) best[name] = dishes;
  });
  return best;
}
