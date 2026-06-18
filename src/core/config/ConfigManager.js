'use strict';

const path = require('path');
const fs = require('fs');
const TokenEngine = require('./TokenEngine');

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

function loadDefaults() {
  const configPath = path.resolve(__dirname, '..', '..', '..', 'config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw);
}

const ConfigManager = {
  load(overrides) {
    const defaults = loadDefaults();
    const merged = overrides ? deepMerge(defaults, overrides) : defaults;
    return TokenEngine.resolve(merged);
  },

  loadRaw(overrides) {
    const defaults = loadDefaults();
    return overrides ? deepMerge(defaults, overrides) : defaults;
  },

  camelToKebab: TokenEngine.camelToKebab,

  themeAsCssVars(colors) {
    const vars = {};
    for (const [key, value] of Object.entries(colors)) {
      vars[`--${TokenEngine.camelToKebab(key)}`] = String(value);
    }
    return vars;
  },

  deepMerge,
};

module.exports = ConfigManager;
