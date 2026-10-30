import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUnicaWeek, parseUnicaRecipe, parseSodexoDay, parseSodexoNutrients } from '../scripts/parsers.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));

test('Unica-viikko', () => {
  const w = parseUnicaWeek(fx('unica-week.json'));
  assert.deepEqual(Object.keys(w), ['2026-10-26']);
  const d = w['2026-10-26'][0];
  assert.equal(d.line, 'BRYGGE 10.30-19.45');
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].recipeId, 23278);
  assert.deepEqual(d.items[1].diets, ['A', 'G', 'L', 'M', 'Veg']);
});

test('Unica-resepti', () => {
  assert.deepEqual(parseUnicaRecipe(fx('unica-recipe.json')), { kcal: 192, protein: 6.6, carbs: 14.7, fat: 10.5 });
  assert.equal(parseUnicaRecipe({ nutritionalValues: [] }), null);
});

test('Sodexo-ravintoarvot', () => {
  const n = parseSodexoNutrients('Energia kj/Energia kj: 1168.00 kj | Rasva/Rasva: 18.00 rasva | Rasva, tyydyttyneet/Rasva, tyydyttyneet: 2.90 rasva-ty | Proteiini/Proteiini: 17.00 proteiin');
  assert.equal(n.protein, 17);
  assert.equal(n.fat, 18);
  assert.equal(n.kcal, 279.2);
  assert.equal(parseSodexoNutrients(''), null);
});

test('Sodexo-päivä', () => {
  const dishes = parseSodexoDay(fx('sodexo-day.json'));
  assert.equal(dishes.length, 3);
  assert.deepEqual(dishes[0].items.map((i) => i.name), ['Provencelaista kasvispataa', 'Paahdettua perunaa']);
  assert.equal(dishes[1].items[0].nutrition.protein, 17);
  assert.equal(dishes[2].items[0].name, 'Jälkiruoka');
  assert.equal(dishes[2].items[0].nutrition, null);
  assert.deepEqual(parseSodexoDay({ courses: [] }), []);
});

import { parseJamix, parseKarkaDay, parseUnicaHours, parseKarkaNutrition } from '../scripts/parsers.mjs';

test('Unica-aukioloajat', () => {
  assert.deepEqual(parseUnicaHours({ MenusForDays: [{ Date: '2026-10-30T00:00:00+00:00', LunchTime: '10.30-14.00' }] }), { '2026-10-30': '10:30–14:00' });
});

test('Jamix', () => {
  const j = [{ menuTypes: [{ menus: [{ days: [{ date: 20261102, mealoptions: [{ name: 'LOUNAS', menuItems: [{ name: 'Broileria', diets: 'G, L' }] }, { name: 'TYHJÄ', menuItems: [] }] }] }] }] }];
  assert.deepEqual(parseJamix(j, { price: '3,10' }), { '2026-11-02': [{ line: 'LOUNAS', price: '3,10', items: [{ name: 'Broileria', diets: ['G', 'L'], nutrition: null }] }] });
});

test('Kårkaféerna', () => {
  const html = `<h2>Aurum</h2><p>Ma-to 10.30-18</p><div><h3>Wings Saturday</h3><p>Kana wingsit &amp; coleslaw *</p><span>2</span><span>Normaali lounas</span><span>Opiskelijat 3,10 €</span><span>C P Ä</span><p>Sis. sitrusta.</p><p>100g sisältää: Energia 182kcal, Proteiini 25.9g, Hiilihydraatit 9.4g, Rasva 7.3g.</p></div><div><h3>Pinaattikeitto</h3><span>1</span><span>Normaali lounas</span><span>VGN G</span></div>`;
  const r = parseKarkaDay(html, ['Aurum', 'Kåren']);
  assert.equal(r.Aurum.length, 2);
  assert.equal(r.Aurum[0].items[0].name, 'Kana wingsit & coleslaw');
  assert.equal(r.Aurum[0].price, '3,10');
  assert.equal(r.Aurum[0].items[0].nutrition.protein, 25.9);
  assert.deepEqual(r.Aurum[1].items[0].diets, ['VGN', 'G']);
  assert.equal(parseKarkaNutrition('ei mitään'), null);
});
