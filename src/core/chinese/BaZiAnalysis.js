'use strict';

const { HEAVENLY_STEMS } = require('./ChineseAstrologyConstants');

/**
 * BaZiAnalysis — derives the traditional interpretive layer of a 八字 chart
 * (地支藏干 hidden stems, 十神 ten gods, 五行 distribution and 日主 strength)
 * from the four pillars. Pure lookup-table logic; no external/native deps.
 */

const STEM_BY_CHAR = Object.fromEntries(HEAVENLY_STEMS.map((s) => [s.char, s]));

// 地支藏干 — hidden heavenly stems per earthly branch, ordered 主气 → 余气.
const HIDDEN_STEMS = {
  子: ['癸'],
  丑: ['己', '癸', '辛'],
  寅: ['甲', '丙', '戊'],
  卯: ['乙'],
  辰: ['戊', '乙', '癸'],
  巳: ['丙', '戊', '庚'],
  午: ['丁', '己'],
  未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'],
  酉: ['辛'],
  戌: ['戊', '辛', '丁'],
  亥: ['壬', '甲'],
};

// 五行生克 relative to a reference element.
const GENERATES = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const CONTROLS = { wood: 'earth', earth: 'water', water: 'fire', fire: 'metal', metal: 'wood' };

/**
 * 十神: the relation of a target stem to the day master.
 * same polarity → 比/食/偏财/七杀/偏印 ; different → 劫/伤/正财/正官/正印.
 */
function tenGod(dayMaster, target) {
  if (!dayMaster || !target || !target.element) return '';
  const same = dayMaster.yinYang === target.yinYang;
  const d = dayMaster.element;
  const e = target.element;
  if (e === d) return same ? '比肩' : '劫财';
  if (GENERATES[d] === e) return same ? '食神' : '伤官';
  if (CONTROLS[d] === e) return same ? '偏财' : '正财';
  if (CONTROLS[e] === d) return same ? '七杀' : '正官';
  if (GENERATES[e] === d) return same ? '偏印' : '正印';
  return '';
}

function hiddenStemsOf(branchChar) {
  return (HIDDEN_STEMS[branchChar] || []).map((char) => {
    const s = STEM_BY_CHAR[char];
    return { char, element: s ? s.element : 'unknown', yinYang: s ? s.yinYang : 'unknown' };
  });
}

/**
 * @param {object} bazi - the adapter's bazi output: { pillars:{year,month,day,hour}, dayMaster }
 * @returns {object} analysis layer (pillars w/ 十神+藏干, elementCounts, strength)
 */
function analyze(bazi) {
  if (!bazi || !bazi.pillars) return null;
  const dm = bazi.dayMaster;
  const order = ['year', 'month', 'day', 'hour'];

  const elementCounts = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  const bump = (el) => { if (elementCounts[el] != null) elementCounts[el] += 1; };

  const pillars = order.map((key) => {
    const p = bazi.pillars[key];
    const hidden = hiddenStemsOf(p.branch.char).map((hs) => ({
      char: hs.char,
      element: hs.element,
      tenGod: tenGod(dm, hs),
    }));
    bump(p.stem.element);
    hidden.forEach((hs) => bump(hs.element));
    return {
      key,
      stemChar: p.stem.char,
      stemElement: p.stem.element,
      // The day stem is the day master itself (元神), not a ten-god relation.
      stemTenGod: key === 'day' ? '日主' : tenGod(dm, p.stem),
      branchChar: p.branch.char,
      branchElement: p.branch.element,
      branchAnimal: p.branch.animal || '',
      hidden,
    };
  });

  // 日主旺弱 (heuristic, for reference): supportive = 同类(比劫) + 生我(印).
  const printElement = Object.keys(GENERATES).find((e) => GENERATES[e] === dm.element);
  const total = Object.values(elementCounts).reduce((a, b) => a + b, 0) || 1;
  const supportive = elementCounts[dm.element] + (printElement ? elementCounts[printElement] : 0);
  const ratio = supportive / total;
  let label = '中和';
  if (ratio >= 0.55) label = '偏旺';
  else if (ratio <= 0.4) label = '偏弱';

  return {
    dayMaster: dm,
    pillars,
    elementCounts,
    strength: { supportive, total, ratio, label, supportElement: dm.element, resourceElement: printElement },
  };
}

module.exports = { analyze, tenGod, hiddenStemsOf, HIDDEN_STEMS };
