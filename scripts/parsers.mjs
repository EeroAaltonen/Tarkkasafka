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
