// Hakee kaikkien ravintoloiden ruokalistat ja ravintoarvot ja kirjoittaa
// ne tiedostoon data/menus.json. Ajetaan GitHub Actionsissa (ei selaimessa),
// koska ravintoloiden rajapinnat eivät salli selainhakuja muilta sivustoilta.
//
// Käyttö: node scripts/fetch-menus.mjs [--no-geocode]

import { writeFile, mkdir } from 'node:fs/promises';
import { RESTAURANTS } from './restaurants.mjs';
import { parseUnicaWeek, parseUnicaRecipe, parseSodexoDay, parseUnicaHours, parseJamix, parseKarkaDay, htmlToLines } from './parsers.mjs';

const UA = 'Safkatrack/1.0 (Turku student menu PWA)';
const TZ = 'Europe/Helsinki';

function todayHelsinki() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso) {
  const dow = (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7; // ma = 0
  return addDays(iso, -dow);
}

async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts));
}
async function getText(url, { retries = 2 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= retries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

async function fetchUnica(r, weekStarts) {
  const days = {};
  for (const monday of weekStarts) {
    const url = `https://www.unica.fi/menuapi/week-menus?costCenter=${r.costNumber}&date=${monday}&language=fi`;
    Object.assign(days, parseUnicaWeek(await getJson(url)));
  }
  // Lounasajat ovat vain vanhassa feed-rajapinnassa.
  try {
    r.hoursByDate = parseUnicaHours(await getJson(`https://www.unica.fi/menuapi/feed/json?costNumber=${r.costNumber}&language=fi`, { retries: 1 }));
  } catch { /* ei aukioloaikoja */ }
  return days;
}

async function fetchJamix(r, dates) {
  const [customer, kitchen] = r.jamix;
  const d = (iso) => iso.replaceAll('-', '');
  const url = `https://fi.jamix.cloud/apps/menuservice/rest/haku/menu/${customer}/${kitchen}?lang=fi&date=${d(dates[0])}&date2=${d(dates.at(-1))}`;
  const text = await getText(url);
  debug.jamix = text.slice(0, 4000);
  return parseJamix(JSON.parse(text), { price: r.price ?? '' });
}

// Kårkaféernan sivulla on kaikki ravintolat samalla sivulla, päivä kerrallaan.
function isoWeek(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 864e5 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: d.getUTCFullYear(), week, day: day + 1 };
}
async function fetchKarka(rs, dates) {
  const names = rs.map((r) => r.karkaName);
  const result = Object.fromEntries(rs.map((r) => [r.id, {}]));
  await pool(dates.filter((d) => isoWeek(d).day <= 6), 3, async (date) => {
    const { year, week, day } = isoWeek(date);
    const html = await getText(`https://www.karkafeerna.fi/fi/lounas/?year=${year}&week=${week}&day=${day}`);
    if (!debug.karka && day === 1) debug.karka = htmlToLines(html).slice(0, 500);
    const byName = parseKarkaDay(html, names);
    for (const r of rs) if (byName[r.karkaName]?.length) result[r.id][date] = byName[r.karkaName];
  });
  return result;
}

const debug = {};

async function fetchSodexo(r, dates) {
  const days = {};
  await pool(dates, 3, async (date) => {
    const json = await getJson(`https://www.sodexo.fi/ruokalistat/output/daily_json/${r.sodexoId}/${date}`);
    const dishes = parseSodexoDay(json);
    if (dishes.length) days[date] = dishes;
  });
  return days;
}

// Unican ravintoarvot ovat erillisessä reseptirajapinnassa.
async function fillUnicaNutrition(menus, fromDate) {
  const ids = new Set();
  for (const days of Object.values(menus))
    for (const [date, dishes] of Object.entries(days))
      if (date >= fromDate) for (const d of dishes) for (const it of d.items) if (it.recipeId) ids.add(it.recipeId);

  const cache = new Map();
  let failed = 0;
  await pool([...ids], 8, async (id) => {
    try {
      cache.set(id, parseUnicaRecipe(await getJson(`https://www.unica.fi/menuapi/recipes/${id}?language=fi`, { retries: 1 })));
    } catch {
      failed++;
    }
  });
  for (const days of Object.values(menus))
    for (const dishes of Object.values(days))
      for (const d of dishes)
        for (const it of d.items) {
          if (it.recipeId && cache.has(it.recipeId)) it.nutrition = cache.get(it.recipeId);
          delete it.recipeId;
        }
  console.log(`Unica-reseptit: ${ids.size} haettu, ${failed} epäonnistui`);
}

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Tarkentaa koordinaatit osoitteesta. Hylkää tuloksen, joka on kaukana
// käsin annetusta sijainnista (todennäköisesti väärä osuma).
async function geocode(r) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fi&q=${encodeURIComponent(r.address)}`;
    const [hit] = await getJson(url, { retries: 0 });
    if (!hit) return false;
    const p = { lat: +hit.lat, lon: +hit.lon };
    if (distanceKm(p, r) > 1.5) return false;
    r.lat = Math.round(p.lat * 1e5) / 1e5;
    r.lon = Math.round(p.lon * 1e5) / 1e5;
    return true;
  } catch {
    return false;
  } finally {
    await new Promise((res) => setTimeout(res, 1100)); // Nominatimin käyttöehdot: max 1 haku / s
  }
}

async function main() {
  const today = todayHelsinki();
  const monday = mondayOf(today);
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
  // Perjantaista alkaen haetaan myös seuraavan viikon listat.
  const weekStarts = dow >= 4 ? [monday, addDays(monday, 7)] : [monday];
  const dates = weekStarts.flatMap((m) => Array.from({ length: 7 }, (_, i) => addDays(m, i)));

  const restaurants = RESTAURANTS.map((r) => ({ ...r }));
  const menus = {};
  const errors = {};

  const karka = restaurants.filter((r) => r.chain === 'karka');
  try {
    Object.assign(menus, await fetchKarka(karka, dates));
  } catch (e) {
    for (const r of karka) { errors[r.id] = e.message; menus[r.id] = {}; }
    console.warn(`Kårkaféerna: VIRHE ${e.message}`);
  }

  await pool(restaurants.filter((r) => r.chain !== 'karka'), 4, async (r) => {
    try {
      menus[r.id] =
        r.chain === 'unica' ? await fetchUnica(r, weekStarts)
        : r.chain === 'jamix' ? await fetchJamix(r, dates)
        : await fetchSodexo(r, dates);
      console.log(`${r.name}: ${Object.keys(menus[r.id]).length} päivää`);
    } catch (e) {
      errors[r.id] = e.message;
      menus[r.id] = {};
      console.warn(`${r.name}: VIRHE ${e.message}`);
    }
  });

  await fillUnicaNutrition(
    Object.fromEntries(restaurants.filter((r) => r.chain === 'unica').map((r) => [r.id, menus[r.id]])),
    today,
  );

  if (!process.argv.includes('--no-geocode')) {
    for (const r of restaurants) r.coordsVerified = await geocode(r);
  }

  // Aukioloajat päivämäärittäin: rajapinnasta (Unica) tai viikkorytmistä.
  for (const r of restaurants) {
    const byDate = {};
    for (const date of dates) {
      const dow = isoWeek(date).day;
      const h = r.hoursByDate?.[date] ?? r.hours?.[dow];
      if (h) byDate[date] = h;
    }
    r.hoursByDate = byDate;
  }

  // Väliaikainen vianetsintä uusille lähteille.
  for (const r of karka) if (!Object.keys(menus[r.id]).length) console.warn(`${r.name}: ei ruokia`);
  await writeFile('data/debug.json', JSON.stringify(debug));

  const data = {
    generatedAt: new Date().toISOString(),
    restaurants: restaurants.map(({ costNumber, sodexoId, karkaName, jamix, hours, price, ...rest }) => rest),
    menus,
    errors,
  };
  await mkdir('data', { recursive: true });
  await writeFile('data/menus.json', JSON.stringify(data));
  const ok = restaurants.length - Object.keys(errors).length;
  console.log(`Valmis: ${ok}/${restaurants.length} ravintolaa`);
  if (ok === 0) process.exit(1);
}

main();
