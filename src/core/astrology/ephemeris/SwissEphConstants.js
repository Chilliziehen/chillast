'use strict';

const swisseph = require('swisseph-v2');

/**
 * SwissEphConstants — lookup tables mapping the engine's lowercase celestial
 * keys and house-system names to the swisseph-v2 C-library constants. Kept
 * separate from the adapter so the mapping is auditable in one place.
 */
const BODY_IDS = {
  sun: swisseph.SE_SUN,
  moon: swisseph.SE_MOON,
  mercury: swisseph.SE_MERCURY,
  venus: swisseph.SE_VENUS,
  mars: swisseph.SE_MARS,
  jupiter: swisseph.SE_JUPITER,
  saturn: swisseph.SE_SATURN,
  uranus: swisseph.SE_URANUS,
  neptune: swisseph.SE_NEPTUNE,
  pluto: swisseph.SE_PLUTO,
  chiron: swisseph.SE_CHIRON,
  northnode: swisseph.SE_MEAN_NODE,
  lilith: swisseph.SE_MEAN_APOG,
};

/** Points derived from another (south node = north node + 180°), not computed directly. */
const DERIVED_POINTS = ['southnode'];

/** House-system single-char codes accepted by swe_houses. */
const HOUSE_SYSTEM_CODES = {
  placidus: 'P',
  koch: 'K',
  regiomontanus: 'R',
  topocentric: 'T',
  'equal-house': 'D',
  'whole-sign': 'W',
};

const FLAGS = swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SPEED;

module.exports = {
  BODY_IDS,
  DERIVED_POINTS,
  HOUSE_SYSTEM_CODES,
  FLAGS,
  swisseph,
};
