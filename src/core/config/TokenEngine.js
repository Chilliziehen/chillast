'use strict';

const SPACING_MULTIPLIERS = [0, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const SPACING_NAMES = ['0', 'half', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];

const TYPE_NAMES = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'display'];
const TYPE_EXPONENTS = [-3, -2, -1, 0, 1, 2, 3, 4, 5];

function camelToKebab(str) {
  return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

const TokenEngine = {
  resolve(raw) {
    const p = raw.primitives || {};
    const unit = p.unit || 4;
    const typeBase = p.typeBase || 13;
    const typeScale = p.typeScale || 1.2;

    const spacing = {};
    SPACING_MULTIPLIERS.forEach((mult, i) => {
      spacing[SPACING_NAMES[i]] = mult === 0 ? '0px' : `${Math.round(unit * mult)}px`;
    });
    spacing.px = '1px';
    if (raw.spacing) Object.assign(spacing, raw.spacing);

    const type = {};
    TYPE_EXPONENTS.forEach((exp, i) => {
      type[TYPE_NAMES[i]] = `${Math.round(typeBase * Math.pow(typeScale, exp))}px`;
    });
    if (raw.type) Object.assign(type, raw.type);

    const weight = { normal: 400, medium: 500, semibold: 600, bold: 700 };

    return {
      spacing,
      type,
      weight,
      colors: raw.colors || {},
      radii: raw.radii || {},
      shadows: raw.shadows || {},
      layout: raw.layout || {},
      chart: raw.chart || {},
      window: raw.window || {},
      ephemeris: raw.ephemeris || { backend: 'swisseph' },
      locale: raw.locale || 'zh',
    };
  },

  camelToKebab,
};

module.exports = TokenEngine;
