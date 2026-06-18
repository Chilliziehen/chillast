'use strict';

const DAY_SEQUENCE = [
  { ruler: 'sun',       years: 10 },
  { ruler: 'venus',     years: 8 },
  { ruler: 'mercury',   years: 13 },
  { ruler: 'moon',      years: 9 },
  { ruler: 'saturn',    years: 11 },
  { ruler: 'jupiter',   years: 12 },
  { ruler: 'mars',      years: 7 },
  { ruler: 'northnode', years: 3 },
  { ruler: 'southnode', years: 2 },
];

const NIGHT_SEQUENCE = [
  { ruler: 'moon',      years: 9 },
  { ruler: 'saturn',    years: 11 },
  { ruler: 'jupiter',   years: 12 },
  { ruler: 'mars',      years: 7 },
  { ruler: 'sun',       years: 10 },
  { ruler: 'venus',     years: 8 },
  { ruler: 'mercury',   years: 13 },
  { ruler: 'northnode', years: 3 },
  { ruler: 'southnode', years: 2 },
];

const CHALDEAN_ORDER = ['saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury', 'moon'];

const CYCLE_YEARS = 75;

const FirdariaCalc = {
  periods(sect) {
    return sect === 'night' ? NIGHT_SEQUENCE.map((p) => ({ ...p })) : DAY_SEQUENCE.map((p) => ({ ...p }));
  },

  activePeriod(age, sect) {
    const effectiveAge = age % CYCLE_YEARS;
    const seq = sect === 'night' ? NIGHT_SEQUENCE : DAY_SEQUENCE;
    let cursor = 0;
    for (const period of seq) {
      const start = cursor;
      const end = cursor + period.years;
      if (effectiveAge >= start && effectiveAge < end) {
        const subPeriods = this._subPeriods(period);
        const ageInPeriod = effectiveAge - start;
        const subYears = period.years / subPeriods.length;
        const subIndex = Math.min(Math.floor(ageInPeriod / subYears), subPeriods.length - 1);
        return {
          major: { ruler: period.ruler, years: period.years, startAge: start, endAge: end },
          minor: { ruler: subPeriods[subIndex], index: subIndex, count: subPeriods.length },
          allPeriods: seq.map((p, i) => {
            const s = seq.slice(0, i).reduce((sum, pp) => sum + pp.years, 0);
            return { ruler: p.ruler, years: p.years, startAge: s, endAge: s + p.years };
          }),
        };
      }
      cursor = end;
    }
    return this.activePeriod(0, sect);
  },

  _subPeriods(period) {
    if (period.ruler === 'northnode' || period.ruler === 'southnode') {
      return [period.ruler];
    }
    const idx = CHALDEAN_ORDER.indexOf(period.ruler);
    const ordered = [];
    for (let i = 0; i < CHALDEAN_ORDER.length; i++) {
      ordered.push(CHALDEAN_ORDER[(idx + i) % CHALDEAN_ORDER.length]);
    }
    return ordered;
  },
};

module.exports = FirdariaCalc;
