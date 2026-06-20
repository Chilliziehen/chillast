'use strict';

/**
 * EphemerisComparison — A/B test between the legacy HoroscopeAdapter (Moshier)
 * and the SwissephAdapter. Both use the same tz-lookup + luxon UT path, so any
 * divergence is a planetary-algorithm / house-algorithm difference.
 */

const assert = require('assert');
const path = require('path');
const AngleMath = require('../src/core/util/AngleMath');
const HoroscopeAdapter = require('../src/core/astrology/HoroscopeAdapter');
const SwissephAdapter = require('../src/core/astrology/ephemeris/SwissephAdapter');
const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');

SwissEphCore.configure({ ephePath: path.join(__dirname, '..', 'assets', 'ephemeris') });

const PROFILES = [
  { name: '1900柏林', year: 1900, month: 6, day: 15, hour: 12, minute: 0, latitude: 52.52, longitude: 13.405 },
  { name: '1970纽约',    year: 1970, month: 4, day: 10, hour: 6, minute: 30, latitude: 40.7128, longitude: -74.006 },
  { name: '1990北京',year: 1990, month: 1, day: 15, hour: 14, minute: 30, latitude: 39.9042, longitude: 116.4074 },
  { name: '2000伦敦', year: 2000, month: 3, day: 20, hour: 8, minute: 0, latitude: 51.5074, longitude: -0.1278 },
  { name: '2025悉尼', year: 2025, month: 12, day: 21, hour: 23, minute: 0, latitude: -33.8688, longitude: 151.2093 },
  { name: 'DST边界',year: 1989, month: 4, day: 2, hour: 2, minute: 30, latitude: 40.7128, longitude: -74.006 },
  { name: '斐济跨日线', year: 2010, month: 8, day: 15, hour: 10, minute: 0, latitude: -17.7134, longitude: 178.0650 },
  { name: '1923雷克雅未克', year: 1923, month: 11, day: 5, hour: 18, minute: 45, latitude: 64.1466, longitude: -21.9426 },
  { name: '2015东京',  year: 2015, month: 7, day: 7, hour: 7, minute: 7, latitude: 35.6762, longitude: 139.6503 },
  { name: '2049孟买', year: 2049, month: 2, day: 14, hour: 5, minute: 15, latitude: 19.0760, longitude: 72.8777 },
];

const THRESHOLDS = {
  longitude: 0.01,
  ascendant: 0.05,
  mc: 0.01,
  houseCusp: 0.1,
};

function angDiff(a, b) {
  return AngleMath.separation(a, b);
}

function runComparison() {
  const report = [];
  let allPass = true;

  for (const p of PROFILES) {
    const settings = { houseSystem: 'placidus', zodiac: 'tropical' };
    const legacy = new HoroscopeAdapter(settings).castFromLocal(p);
    const swiss = new SwissephAdapter(settings).castFromLocal(p);

    const issues = [];

    for (const lp of legacy.points) {
      const sp = swiss.points.find((x) => x.key === lp.key);
      if (!sp) { issues.push(`${p.name}: ${lp.key} missing in swisseph`); continue; }
      const d = angDiff(lp.longitude, sp.longitude);
      if (d > THRESHOLDS.longitude) issues.push(`${p.name}: ${lp.key} longitude diff ${d.toFixed(4)}°`);
      if (lp.retrograde !== sp.retrograde) issues.push(`${p.name}: ${lp.key} retrograde mismatch`);
      if (lp.signIndex !== sp.signIndex) issues.push(`${p.name}: ${lp.key} signIndex mismatch (legacy=${lp.signIndex} swiss=${sp.signIndex})`);
      if (lp.house !== sp.house) issues.push(`${p.name}: ${lp.key} house mismatch (legacy=${lp.house} swiss=${sp.house})`);
    }

    const ascD = angDiff(legacy.angles.ascendant, swiss.angles.ascendant);
    if (ascD > THRESHOLDS.ascendant) issues.push(`${p.name}: ASC diff ${ascD.toFixed(4)}°`);
    const mcD = angDiff(legacy.angles.midheaven, swiss.angles.midheaven);
    if (mcD > THRESHOLDS.mc) issues.push(`${p.name}: MC diff ${mcD.toFixed(4)}°`);

    for (let i = 0; i < 12; i += 1) {
      const d = angDiff(legacy.houses[i].cuspLongitude, swiss.houses[i].cuspLongitude);
      if (d > THRESHOLDS.houseCusp) issues.push(`${p.name}: cusp ${i + 1} diff ${d.toFixed(4)}°`);
    }

    if (issues.length) allPass = false;
    report.push({ profile: p.name, issues });
  }

  return { allPass, report };
}

module.exports = { runComparison };
