// Unit tests for BaZi 十神 / 藏干 / 五行 analysis. Pure logic, no native deps.
//   node tests/BaZiAnalysis.test.mjs

import { createRequire } from 'node:module';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const { analyze, tenGod, hiddenStemsOf } = require('../src/core/chinese/BaZiAnalysis');

let passed = 0; let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\nBaZiAnalysis');
const jiaWoodYang = { char: '甲', element: 'wood', yinYang: 'yang' };

test('ten gods cover all five relations + polarity', () => {
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'wood', yinYang: 'yang' }), '比肩');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'wood', yinYang: 'yin' }), '劫财');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'fire', yinYang: 'yang' }), '食神');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'fire', yinYang: 'yin' }), '伤官');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'earth', yinYang: 'yang' }), '偏财');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'earth', yinYang: 'yin' }), '正财');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'metal', yinYang: 'yang' }), '七杀');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'metal', yinYang: 'yin' }), '正官');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'water', yinYang: 'yang' }), '偏印');
  assert.strictEqual(tenGod(jiaWoodYang, { element: 'water', yinYang: 'yin' }), '正印');
});

test('hidden stems table is correct for sample branches', () => {
  assert.deepStrictEqual(hiddenStemsOf('子').map((h) => h.char), ['癸']);
  assert.deepStrictEqual(hiddenStemsOf('寅').map((h) => h.char), ['甲', '丙', '戊']);
  assert.deepStrictEqual(hiddenStemsOf('戌').map((h) => h.char), ['戊', '辛', '丁']);
});

test('analyze() marks the day stem as 日主 and counts hidden stems', () => {
  const bazi = {
    dayMaster: jiaWoodYang,
    pillars: {
      year: { stem: { char: '庚', element: 'metal', yinYang: 'yang' }, branch: { char: '申', element: 'metal', yinYang: 'yang', animal: '猴' } },
      month: { stem: { char: '戊', element: 'earth', yinYang: 'yang' }, branch: { char: '子', element: 'water', yinYang: 'yang' } },
      day: { stem: jiaWoodYang, branch: { char: '寅', element: 'wood', yinYang: 'yang', animal: '虎' } },
      hour: { stem: { char: '丙', element: 'fire', yinYang: 'yang' }, branch: { char: '午', element: 'fire', yinYang: 'yang', animal: '马' } },
    },
  };
  const a = analyze(bazi);
  const day = a.pillars.find((p) => p.key === 'day');
  assert.strictEqual(day.stemTenGod, '日主');
  assert.strictEqual(a.pillars.find((p) => p.key === 'year').stemTenGod, '七杀');
  // hidden stems of 寅 carry their own ten-gods
  assert.deepStrictEqual(day.hidden.map((h) => h.char), ['甲', '丙', '戊']);
  const totalCounts = Object.values(a.elementCounts).reduce((x, y) => x + y, 0);
  assert.ok(totalCounts > 8, 'counts should include hidden stems');
  assert.ok(['偏旺', '偏弱', '中和'].includes(a.strength.label));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
