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
