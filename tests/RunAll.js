'use strict';

/**
 * RunAll.js — a dependency-free test runner for the astrology core. It exercises
 * the domain models, angle math, the aspect engine and every chart strategy via
 * the public AstrologyService facade, asserting both that charts are produced and
 * that key astronomical relationships hold (e.g. a solar return really returns the
 * Sun to its natal longitude). Run with `npm test`.
 */

const assert = require('assert');
const path = require('path');

const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');
SwissEphCore.configure({
  ephePath: path.join(__dirname, '..', 'assets', 'ephemeris'),
});

const AngleMath = require('../src/core/util/AngleMath');
const AspectEngine = require('../src/core/astrology/AspectEngine');
const Profile = require('../src/core/models/Profile');
const AstrologyService = require('../src/core/astrology/AstrologyService');
const FirdariaCalc = require('../src/core/astrology/FirdariaCalc');
const ConfigManager = require('../src/core/config/ConfigManager');
const TokenEngine = require('../src/core/config/TokenEngine');
const ChineseAstrologyService = require('../src/core/chinese/ChineseAstrologyService');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    process.stdout.write(`  ✗ ${name}\n      ${err.message}\n`);
  }
}

const subjectA = {
  nameZh: '甲', nameEn: 'Alpha', gender: 'male',
  birthData: { year: 1990, month: 1, day: 15, hour: 14, minute: 30, location: { label: '北京', latitude: 39.9042, longitude: 116.4074 } },
};
const subjectB = {
  nameZh: '乙', nameEn: 'Beta', gender: 'female',
  birthData: { year: 1992, month: 7, day: 3, hour: 9, minute: 5, location: { label: '上海', latitude: 31.2304, longitude: 121.4737 } },
};

const svc = new AstrologyService(
  new (require('../src/core/astrology/ChartStrategyFactory'))({ backend: 'swisseph' }),
);

console.log('\nAngleMath');
test('normalize wraps into [0,360)', () => {
  assert.strictEqual(AngleMath.normalize(370), 10);
  assert.strictEqual(AngleMath.normalize(-30), 330);
});
test('separation is symmetric and <=180', () => {
  assert.strictEqual(AngleMath.separation(10, 350), 20);
  assert.strictEqual(AngleMath.separation(0, 180), 180);
});
test('midpoint takes the short arc across 0', () => {
  assert.strictEqual(AngleMath.midpoint(350, 10), 0);
  assert.strictEqual(AngleMath.midpoint(0, 90), 45);
});
test('signIndex and degreeInSign', () => {
  assert.strictEqual(AngleMath.signIndex(295), 9); // Capricorn
  assert.strictEqual(Math.round(AngleMath.degreeInSign(295)), 25);
});

console.log('\nModels');
test('valid profile passes validation', () => {
  assert.deepStrictEqual(Profile.fromJSON(subjectA).validate(), []);
});
test('invalid birth data is rejected', () => {
  const bad = Profile.fromJSON({ ...subjectA, birthData: { ...subjectA.birthData, month: 13 } });
  assert.ok(bad.validate().length > 0);
});
test('profile requires a name', () => {
  const bad = Profile.fromJSON({ nameZh: '', nameEn: '', gender: 'other', birthData: subjectA.birthData });
  assert.ok(bad.validate().some((e) => e.includes('名字')));
});

console.log('\nAspectEngine');
test('detects an exact conjunction within orb', () => {
  const engine = new AspectEngine();
  const out = engine.compute(
    [{ key: 'a', longitude: 10 }],
    [{ key: 'b', longitude: 13 }],
    { sameSet: false },
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].aspectKey, 'conjunction');
  assert.ok(Math.abs(out[0].orb - 3) < 1e-6);
});
test('ignores pairs outside any orb', () => {
  const engine = new AspectEngine();
  const out = engine.compute(
    [{ key: 'a', longitude: 0 }],
    [{ key: 'b', longitude: 17 }],
    { sameSet: false },
  );
  assert.strictEqual(out.length, 0);
});
test('sameSet avoids duplicate and self pairs', () => {
  const engine = new AspectEngine();
  const pts = [{ key: 'a', longitude: 0 }, { key: 'b', longitude: 120 }, { key: 'c', longitude: 240 }];
  const out = engine.compute(pts, pts, { sameSet: true });
  assert.strictEqual(out.length, 3); // a-b, a-c, b-c trines
});

console.log('\nTokenEngine');
test('derives spacing scale from unit=4', () => {
  const tokens = TokenEngine.resolve({ primitives: { unit: 4 } });
  assert.strictEqual(tokens.spacing['1'], '4px');
  assert.strictEqual(tokens.spacing['2'], '8px');
  assert.strictEqual(tokens.spacing['4'], '16px');
  assert.strictEqual(tokens.spacing.half, '2px');
  assert.strictEqual(tokens.spacing.px, '1px');
});
test('derives type scale from base=13, scale=1.2', () => {
  const tokens = TokenEngine.resolve({ primitives: { typeBase: 13, typeScale: 1.2 } });
  assert.strictEqual(tokens.type.md, '13px');
  assert.strictEqual(tokens.type.lg, '16px');
  assert.strictEqual(tokens.type.sm, '11px');
});
test('allows explicit spacing overrides', () => {
  const tokens = TokenEngine.resolve({ primitives: { unit: 4 }, spacing: { '2': '10px' } });
  assert.strictEqual(tokens.spacing['2'], '10px');
  assert.strictEqual(tokens.spacing['1'], '4px');
});
test('passes through colors, chart, window', () => {
  const tokens = TokenEngine.resolve({ colors: { accent: '#ff0000' }, chart: { svgSize: 600 } });
  assert.strictEqual(tokens.colors.accent, '#ff0000');
  assert.strictEqual(tokens.chart.svgSize, 600);
});

console.log('\nConfigManager');
test('load returns resolved tokens', () => {
  const cfg = ConfigManager.load();
  assert.ok(cfg.spacing, 'has spacing');
  assert.ok(cfg.type, 'has type');
  assert.ok(cfg.weight, 'has weight');
  assert.ok(cfg.colors, 'has colors');
  assert.strictEqual(cfg.spacing['1'], '4px');
  assert.strictEqual(cfg.type.md, '13px');
  assert.strictEqual(cfg.window.width, 1440);
  assert.strictEqual(cfg.chart.svgSize, 740);
});
test('deep-merges partial overrides', () => {
  const cfg = ConfigManager.load({ colors: { accent: '#ff0000' }, chart: { svgSize: 800 } });
  assert.strictEqual(cfg.colors.accent, '#ff0000');
  assert.strictEqual(cfg.chart.svgSize, 800);
  assert.strictEqual(cfg.colors.bgBase, '#1e1e1e');
});
test('camelToKebab converts correctly', () => {
  assert.strictEqual(ConfigManager.camelToKebab('bgPanelSolid'), 'bg-panel-solid');
  assert.strictEqual(ConfigManager.camelToKebab('accent'), 'accent');
});

console.log('\nFirdariaCalc');
test('day birth period sequence totals 75 years', () => {
  const periods = FirdariaCalc.periods('day');
  const total = periods.reduce((s, p) => s + p.years, 0);
  assert.strictEqual(total, 75);
});
test('night birth starts with Moon', () => {
  const periods = FirdariaCalc.periods('night');
  assert.strictEqual(periods[0].ruler, 'moon');
});
test('activePeriod returns correct ruler for age 5 (day birth)', () => {
  const result = FirdariaCalc.activePeriod(5, 'day');
  assert.strictEqual(result.major.ruler, 'sun');
  assert.ok(result.major.startAge === 0);
  assert.ok(result.major.endAge === 10);
});
test('activePeriod returns correct ruler for age 12 (day birth)', () => {
  const result = FirdariaCalc.activePeriod(12, 'day');
  assert.strictEqual(result.major.ruler, 'venus');
});
test('activePeriod wraps after 75 years', () => {
  const result = FirdariaCalc.activePeriod(80, 'day');
  assert.strictEqual(result.major.ruler, 'sun');
});

console.log('\nChart strategies (via AstrologyService)');
function basicChartChecks(chart) {
  assert.ok(chart.meta && chart.meta.type, 'has meta.type');
  assert.ok(Array.isArray(chart.rings) && chart.rings.length >= 1, 'has rings');
  assert.ok(chart.rings[0].points.length >= 10, 'ring0 has points');
  assert.strictEqual(chart.houses.length, 12, 'has 12 houses');
  assert.ok(chart.angles.ascendant && chart.angles.midheaven, 'has angles');
  chart.rings[0].points.forEach((p) => {
    assert.ok(p.longitude >= 0 && p.longitude < 360, 'point longitude in range');
    assert.ok(p.signGlyph && p.nameZh, 'point enriched');
  });
}

test('natal chart', () => {
  const c = svc.computeChart({ type: 'natal', primary: subjectA });
  basicChartChecks(c);
  const sun = c.rings[0].points.find((p) => p.key === 'sun');
  assert.strictEqual(sun.signKey, 'capricorn');
});
test('transit chart is a bi-wheel with cross aspects', () => {
  const c = svc.computeChart({ type: 'transit', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
});
test('progressed chart', () => {
  const c = svc.computeChart({ type: 'progressed', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
});
test('solar return returns the Sun to natal longitude', () => {
  const natal = svc.computeChart({ type: 'natal', primary: subjectA });
  const natalSun = natal.rings[0].points.find((p) => p.key === 'sun').longitude;
  const sr = svc.computeChart({ type: 'solarReturn', primary: subjectA, options: { year: 2026 } });
  const srSun = sr.rings[0].points.find((p) => p.key === 'sun').longitude;
  assert.ok(AngleMath.separation(natalSun, srSun) < 0.05, `sun diff ${AngleMath.separation(natalSun, srSun)}`);
});
test('lunar return returns the Moon to natal longitude', () => {
  const natal = svc.computeChart({ type: 'natal', primary: subjectA });
  const natalMoon = natal.rings[0].points.find((p) => p.key === 'moon').longitude;
  const lr = svc.computeChart({ type: 'lunarReturn', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  const lrMoon = lr.rings[0].points.find((p) => p.key === 'moon').longitude;
  assert.ok(AngleMath.separation(natalMoon, lrMoon) < 0.2, `moon diff ${AngleMath.separation(natalMoon, lrMoon)}`);
});
test('tertiary progressed chart', () => {
  const c = svc.computeChart({ type: 'tertiaryProgressed', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
  assert.strictEqual(c.meta.type, 'tertiaryProgressed');
});
test('solar arc chart advances all points by Sun arc', () => {
  const c = svc.computeChart({ type: 'solarArc', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
  assert.strictEqual(c.meta.type, 'solarArc');
  const natalSun = c.rings[0].points.find((p) => p.key === 'sun');
  const arcSun = c.rings[1].points.find((p) => p.key === 'sun');
  const arcMars = c.rings[1].points.find((p) => p.key === 'mars');
  const natalMars = c.rings[0].points.find((p) => p.key === 'mars');
  const sunArc = AngleMath.normalize(arcSun.longitude - natalSun.longitude);
  const marsArc = AngleMath.normalize(arcMars.longitude - natalMars.longitude);
  assert.ok(Math.abs(sunArc - marsArc) < 0.01, 'all planets share the same arc');
});
test('firdaria chart includes period data', () => {
  const c = svc.computeChart({ type: 'firdaria', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'firdaria');
  assert.ok(c.meta.firdaria, 'has firdaria data');
  assert.ok(c.meta.firdaria.major.ruler, 'has major period ruler');
  assert.ok(Array.isArray(c.meta.firdaria.allPeriods), 'has all periods');
});
test('profection chart rotates ASC by age', () => {
  const c = svc.computeChart({ type: 'profection', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'profection');
  assert.ok(c.meta.profection, 'has profection data');
  assert.ok(typeof c.meta.profection.age === 'number');
  assert.ok(typeof c.meta.profection.profectedSign === 'string');
  assert.ok(typeof c.meta.profection.lordOfYear === 'string');
});
test('relocation chart has different houses from natal', () => {
  const natal = svc.computeChart({ type: 'natal', primary: subjectA });
  const reloc = svc.computeChart({
    type: 'relocation',
    primary: subjectA,
    options: { latitude: 40.7128, longitude: -74.006, locationLabel: 'New York' },
  });
  basicChartChecks(reloc);
  assert.strictEqual(reloc.rings.length, 1);
  assert.strictEqual(reloc.meta.type, 'relocation');
  const natalAsc = natal.angles.ascendant.longitude;
  const relocAsc = reloc.angles.ascendant.longitude;
  assert.ok(Math.abs(natalAsc - relocAsc) > 1, 'ascendant differs for different location');
});
test('synastry produces inter-aspects between two charts', () => {
  const c = svc.computeChart({ type: 'synastry', primary: subjectA, secondary: subjectB });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
  assert.ok(c.aspects.length > 0);
});
test('composite midpoints lie on the short arc', () => {
  const a = svc.computeChart({ type: 'natal', primary: subjectA }).rings[0].points.find((p) => p.key === 'sun').longitude;
  const b = svc.computeChart({ type: 'natal', primary: subjectB }).rings[0].points.find((p) => p.key === 'sun').longitude;
  const comp = svc.computeChart({ type: 'composite', primary: subjectA, secondary: subjectB });
  const compSun = comp.rings[0].points.find((p) => p.key === 'sun').longitude;
  assert.ok(Math.abs(AngleMath.separation(a, compSun) - AngleMath.separation(b, compSun)) < 0.01, 'equidistant from both');
});
test('davison chart is a single real chart', () => {
  const c = svc.computeChart({ type: 'davison', primary: subjectA, secondary: subjectB });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
});
test('marx chart uses A planets in B houses', () => {
  const c = svc.computeChart({ type: 'marx', primary: subjectA, secondary: subjectB });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'marx');
  const natalA = svc.computeChart({ type: 'natal', primary: subjectA });
  const natalB = svc.computeChart({ type: 'natal', primary: subjectB });
  const marxSun = c.rings[0].points.find((p) => p.key === 'sun');
  const natalASun = natalA.rings[0].points.find((p) => p.key === 'sun');
  assert.ok(Math.abs(marxSun.longitude - natalASun.longitude) < 0.01, 'uses A planet positions');
  assert.strictEqual(c.houses[0].cuspLongitude, natalB.houses[0].cuspLongitude, 'uses B house cusps');
});
test('composite secondary progressed chart', () => {
  const c = svc.computeChart({ type: 'compositeSecondary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'compositeSecondary');
});
test('composite tertiary progressed chart', () => {
  const c = svc.computeChart({ type: 'compositeTertiary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'compositeTertiary');
});
test('marx secondary progressed chart', () => {
  const c = svc.computeChart({ type: 'marxSecondary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'marxSecondary');
});
test('marx tertiary progressed chart', () => {
  const c = svc.computeChart({ type: 'marxTertiary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 1);
  assert.strictEqual(c.meta.type, 'marxTertiary');
});
test('davison secondary progressed chart', () => {
  const c = svc.computeChart({ type: 'davisonSecondary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
  assert.strictEqual(c.meta.type, 'davisonSecondary');
});
test('davison tertiary progressed chart', () => {
  const c = svc.computeChart({ type: 'davisonTertiary', primary: subjectA, secondary: subjectB, options: { targetDate: '2026-06-18T12:00:00Z' } });
  basicChartChecks(c);
  assert.strictEqual(c.rings.length, 2);
  assert.strictEqual(c.meta.type, 'davisonTertiary');
});
test('relationship chart without secondary throws', () => {
  assert.throws(() => svc.computeChart({ type: 'synastry', primary: subjectA }));
});
test('unknown chart type throws', () => {
  assert.throws(() => svc.computeChart({ type: 'nope', primary: subjectA }));
});
test('referenceData and chartTypes are complete', () => {
  const ref = svc.referenceData();
  assert.strictEqual(ref.signs.length, 12);
  assert.strictEqual(ref.chartTypes.length, 20);
});

console.log('\nSxwnlLoader');
test('sandbox exposes core sxwnl objects', () => {
  const sxwnl = require('../src/core/chinese/SxwnlLoader');
  assert.ok(sxwnl.obb, 'has obb');
  assert.ok(sxwnl.Lunar, 'has Lunar');
  assert.ok(sxwnl.JD, 'has JD');
  assert.ok(sxwnl.XL, 'has XL');
  assert.ok(sxwnl.SSQ, 'has SSQ');
  assert.strictEqual(sxwnl.J2000, 2451545);
});
test('obb has Gan, Zhi, ShX arrays', () => {
  const sxwnl = require('../src/core/chinese/SxwnlLoader');
  assert.strictEqual(sxwnl.obb.Gan.length, 10);
  assert.strictEqual(sxwnl.obb.Zhi.length, 12);
  assert.strictEqual(sxwnl.obb.ShX.length, 12);
});

console.log('\nChineseAstrologyService');
const chineseSvc = new ChineseAstrologyService();
test('referenceData has 10 stems, 12 branches, 5 elements, 12 animals', () => {
  const ref = chineseSvc.referenceData();
  assert.strictEqual(ref.stems.length, 10);
  assert.strictEqual(ref.branches.length, 12);
  assert.strictEqual(ref.elements.length, 5);
  assert.strictEqual(ref.animals.length, 12);
});
test('BaZi returns four 2-char pillars', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  const { pillars } = result.bazi;
  for (const key of ['year', 'month', 'day', 'hour']) {
    assert.strictEqual(pillars[key].full.length, 2, `${key} pillar is 2 chars`);
    assert.ok(pillars[key].stem.char, `${key} has stem`);
    assert.ok(pillars[key].branch.char, `${key} has branch`);
  }
});
test('day master element is valid', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  const valid = ['wood', 'fire', 'earth', 'metal', 'water'];
  assert.ok(valid.includes(result.bazi.dayMaster.element), 'valid element');
});
test('each pillar stem and branch have element + yinYang', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  const valid = ['wood', 'fire', 'earth', 'metal', 'water'];
  const validYY = ['yin', 'yang'];
  for (const key of ['year', 'month', 'day', 'hour']) {
    assert.ok(valid.includes(result.bazi.pillars[key].stem.element), `${key} stem element`);
    assert.ok(validYY.includes(result.bazi.pillars[key].stem.yinYang), `${key} stem yinYang`);
    assert.ok(valid.includes(result.bazi.pillars[key].branch.element), `${key} branch element`);
    assert.ok(validYY.includes(result.bazi.pillars[key].branch.yinYang), `${key} branch yinYang`);
  }
});
test('lunar date returns valid info', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  assert.ok(result.lunar.lunarYear, 'has lunar year');
  assert.ok(result.lunar.lunarDay, 'has lunar day');
  assert.ok(result.lunar.zodiacAnimal, 'has zodiac animal');
  assert.ok(result.lunar.huangdiYear > 4000, 'huangdi year is reasonable');
});
test('known BaZi: 1990-01-15 14:30 Beijing = 己巳 丁丑 庚辰 丁亥', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  assert.strictEqual(result.bazi.pillars.year.full, '己巳');
  assert.strictEqual(result.bazi.pillars.month.full, '丁丑');
  assert.strictEqual(result.bazi.pillars.day.full, '庚辰');
  assert.strictEqual(result.bazi.pillars.hour.full, '丁亥');
  assert.strictEqual(result.bazi.dayMaster.char, '庚');
  assert.strictEqual(result.bazi.dayMaster.element, 'metal');
});
test('allHourPillars has 12 entries', () => {
  const result = chineseSvc.computeBaZi({ birthData: subjectA.birthData });
  assert.strictEqual(result.bazi.allHourPillars.length, 12);
});
test('missing birthData throws', () => {
  assert.throws(() => chineseSvc.computeBaZi({}), /缺少出生数据/);
});
test('missing longitude throws', () => {
  assert.throws(() => chineseSvc.computeBaZi({
    birthData: { year: 1990, month: 1, day: 15, hour: 14, minute: 30, location: {} },
  }), /缺少出生地经度/);
});

console.log('\nSolarTermCalendar');
test('returns 24 solar terms for a year', () => {
  const { getSolarTermCalendar } = require('../src/core/chinese/SolarTermCalendar');
  const data = getSolarTermCalendar(2024);
  assert.ok(data.terms.length >= 23, `got ${data.terms.length} terms`);
  assert.ok(data.terms[0].name, 'term has name');
  assert.ok(data.terms[0].date, 'term has date');
  assert.strictEqual(data.year, 2024);
});

console.log('\nChineseCityDatabase');
test('searches Chinese cities', () => {
  const { searchChineseCities } = require('../src/core/chinese/ChineseCityDatabase');
  const results = searchChineseCities('北京');
  assert.ok(results.length > 0, 'found cities');
  assert.ok(results[0].latitude > 30, 'has valid latitude');
  assert.ok(results[0].longitude > 100, 'has valid longitude');
  assert.ok(results[0].nameZh, 'has nameZh');
});
test('returns empty for no match', () => {
  const { searchChineseCities } = require('../src/core/chinese/ChineseCityDatabase');
  const results = searchChineseCities('xyznoexist');
  assert.strictEqual(results.length, 0);
});

console.log('\nEphemeris comparison (legacy vs swisseph)');
test('10-profile A/B comparison reports differences', () => {
  const { runComparison } = require('./EphemerisComparison');
  const { allPass, report } = runComparison();
  // This test EXERCISES the comparison — it does not assert identical outputs.
  // Moshier and Swiss Ephemeris are expected to diverge outside 1950-2050,
  // and ASC/house cusps diverge at high latitudes (Reykjavik 64°N).
  // The purpose is to document these divergences for the migration report.
  const failingProfiles = report.filter((r) => r.issues.length);
  console.log(`  ${failingProfiles.length}/${report.length} profiles with known divergences`);
  // Verify the test actually ran (data files loaded, adapters created)
  assert.ok(report.length === 10, 'all 10 profiles compared');
  assert.ok(report.every((r) => typeof r.profile === 'string'), 'all reports have profile names');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
