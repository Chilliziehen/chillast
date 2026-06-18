'use strict';

/**
 * Constants — the static astrological reference data shared across the engine
 * and the UI. Everything here is immutable lookup data: zodiac signs, celestial
 * points, aspect definitions, glyphs and palette tokens.
 *
 * Keys deliberately match the lower-case tokens produced by
 * circular-natal-horoscope-js so adapters can map without translation tables.
 */

/** The twelve tropical zodiac signs in order, with element/modality metadata. */
const ZODIAC_SIGNS = [
  { key: 'aries', nameEn: 'Aries', nameZh: '白羊座', shortZh: '羊', glyph: '♈', element: 'fire', modality: 'cardinal', ruler: 'mars' },
  { key: 'taurus', nameEn: 'Taurus', nameZh: '金牛座', shortZh: '牛', glyph: '♉', element: 'earth', modality: 'fixed', ruler: 'venus' },
  { key: 'gemini', nameEn: 'Gemini', nameZh: '双子座', shortZh: '双', glyph: '♊', element: 'air', modality: 'mutable', ruler: 'mercury' },
  { key: 'cancer', nameEn: 'Cancer', nameZh: '巨蟹座', shortZh: '蟹', glyph: '♋', element: 'water', modality: 'cardinal', ruler: 'moon' },
  { key: 'leo', nameEn: 'Leo', nameZh: '狮子座', shortZh: '狮', glyph: '♌', element: 'fire', modality: 'fixed', ruler: 'sun' },
  { key: 'virgo', nameEn: 'Virgo', nameZh: '处女座', shortZh: '处', glyph: '♍', element: 'earth', modality: 'mutable', ruler: 'mercury' },
  { key: 'libra', nameEn: 'Libra', nameZh: '天秤座', shortZh: '秤', glyph: '♎', element: 'air', modality: 'cardinal', ruler: 'venus' },
  { key: 'scorpio', nameEn: 'Scorpio', nameZh: '天蝎座', shortZh: '蝎', glyph: '♏', element: 'water', modality: 'fixed', ruler: 'mars' },
  { key: 'sagittarius', nameEn: 'Sagittarius', nameZh: '射手座', shortZh: '射', glyph: '♐', element: 'fire', modality: 'mutable', ruler: 'jupiter' },
  { key: 'capricorn', nameEn: 'Capricorn', nameZh: '摩羯座', shortZh: '摩', glyph: '♑', element: 'earth', modality: 'cardinal', ruler: 'saturn' },
  { key: 'aquarius', nameEn: 'Aquarius', nameZh: '水瓶座', shortZh: '瓶', glyph: '♒', element: 'air', modality: 'fixed', ruler: 'saturn' },
  { key: 'pisces', nameEn: 'Pisces', nameZh: '双鱼座', shortZh: '鱼', glyph: '♓', element: 'water', modality: 'mutable', ruler: 'jupiter' },
];

/**
 * Celestial points the engine can plot. `kind` separates physical bodies from
 * calculated points (nodes, lilith) and chart angles, which the wheel renders
 * with different weights.
 */
const CELESTIAL_POINTS = {
  sun: { nameEn: 'Sun', nameZh: '太阳', glyph: '☉', kind: 'body' },
  moon: { nameEn: 'Moon', nameZh: '月亮', glyph: '☽', kind: 'body' },
  mercury: { nameEn: 'Mercury', nameZh: '水星', glyph: '☿', kind: 'body' },
  venus: { nameEn: 'Venus', nameZh: '金星', glyph: '♀', kind: 'body' },
  mars: { nameEn: 'Mars', nameZh: '火星', glyph: '♂', kind: 'body' },
  jupiter: { nameEn: 'Jupiter', nameZh: '木星', glyph: '♃', kind: 'body' },
  saturn: { nameEn: 'Saturn', nameZh: '土星', glyph: '♄', kind: 'body' },
  uranus: { nameEn: 'Uranus', nameZh: '天王星', glyph: '♅', kind: 'body' },
  neptune: { nameEn: 'Neptune', nameZh: '海王星', glyph: '♆', kind: 'body' },
  pluto: { nameEn: 'Pluto', nameZh: '冥王星', glyph: '♇', kind: 'body' },
  chiron: { nameEn: 'Chiron', nameZh: '凯龙星', glyph: '⚷', kind: 'body' },
  northnode: { nameEn: 'North Node', nameZh: '北交点', glyph: '☊', kind: 'point' },
  southnode: { nameEn: 'South Node', nameZh: '南交点', glyph: '☋', kind: 'point' },
  lilith: { nameEn: 'Lilith', nameZh: '莉莉丝', glyph: '⚸', kind: 'point' },
  ascendant: { nameEn: 'Ascendant', nameZh: '上升', glyph: 'Asc', kind: 'angle' },
  midheaven: { nameEn: 'Midheaven', nameZh: '天顶', glyph: 'MC', kind: 'angle' },
  descendant: { nameEn: 'Descendant', nameZh: '下降', glyph: 'Dsc', kind: 'angle' },
  imumcoeli: { nameEn: 'Imum Coeli', nameZh: '天底', glyph: 'IC', kind: 'angle' },
};

/**
 * Aspect definitions. `angle` is the exact separation; `defaultOrb` the allowed
 * deviation; `level` drives the orb policy and rendering weight. Default orbs
 * follow the widely used astro-charts.com reference set.
 */
const ASPECTS = {
  conjunction: { nameEn: 'Conjunction', nameZh: '合相', angle: 0, defaultOrb: 8, level: 'major', glyph: '☌' },
  opposition: { nameEn: 'Opposition', nameZh: '对分相', angle: 180, defaultOrb: 8, level: 'major', glyph: '☍' },
  trine: { nameEn: 'Trine', nameZh: '三分相', angle: 120, defaultOrb: 7, level: 'major', glyph: '△' },
  square: { nameEn: 'Square', nameZh: '四分相', angle: 90, defaultOrb: 7, level: 'major', glyph: '□' },
  sextile: { nameEn: 'Sextile', nameZh: '六分相', angle: 60, defaultOrb: 6, level: 'major', glyph: '✱' },
  quincunx: { nameEn: 'Quincunx', nameZh: '梅花相', angle: 150, defaultOrb: 3, level: 'minor', glyph: '⚻' },
  sesquiquadrate: { nameEn: 'Sesquiquadrate', nameZh: '补八分相', angle: 135, defaultOrb: 3, level: 'minor', glyph: '⚼' },
  semisquare: { nameEn: 'Semisquare', nameZh: '八分相', angle: 45, defaultOrb: 3, level: 'minor', glyph: '∠' },
  semisextile: { nameEn: 'Semisextile', nameZh: '十二分相', angle: 30, defaultOrb: 2, level: 'minor', glyph: '⚺' },
  quintile: { nameEn: 'Quintile', nameZh: '五分相', angle: 72, defaultOrb: 2, level: 'minor', glyph: 'Q' },
};

/** Element and modality display metadata for distribution summaries. */
const ELEMENTS = {
  fire: { nameEn: 'Fire', nameZh: '火', token: 'element-fire' },
  earth: { nameEn: 'Earth', nameZh: '土', token: 'element-earth' },
  air: { nameEn: 'Air', nameZh: '风', token: 'element-air' },
  water: { nameEn: 'Water', nameZh: '水', token: 'element-water' },
};

const MODALITIES = {
  cardinal: { nameEn: 'Cardinal', nameZh: '基本' },
  fixed: { nameEn: 'Fixed', nameZh: '固定' },
  mutable: { nameEn: 'Mutable', nameZh: '变动' },
};

/** House systems exposed in the UI (values accepted by the horoscope lib). */
const HOUSE_SYSTEMS = [
  { value: 'placidus', nameEn: 'Placidus', nameZh: '普拉西度' },
  { value: 'whole-sign', nameEn: 'Whole Sign', nameZh: '整宫制' },
  { value: 'equal-house', nameEn: 'Equal House', nameZh: '等宫制' },
  { value: 'regiomontanus', nameEn: 'Regiomontanus', nameZh: '雷格蒙塔努斯' },
  { value: 'topocentric', nameEn: 'Topocentric', nameZh: '地点制' },
  { value: 'koch', nameEn: 'Koch', nameZh: '科赫' },
];

/** Default celestial set used for charts and aspect calculation. */
const DEFAULT_BODY_KEYS = [
  'sun', 'moon', 'mercury', 'venus', 'mars',
  'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'chiron',
];

const DEFAULT_POINT_KEYS = ['northnode', 'southnode', 'lilith'];
const ANGLE_KEYS = ['ascendant', 'midheaven', 'descendant', 'imumcoeli'];

module.exports = {
  ZODIAC_SIGNS,
  CELESTIAL_POINTS,
  ASPECTS,
  ELEMENTS,
  MODALITIES,
  HOUSE_SYSTEMS,
  DEFAULT_BODY_KEYS,
  DEFAULT_POINT_KEYS,
  ANGLE_KEYS,
};
