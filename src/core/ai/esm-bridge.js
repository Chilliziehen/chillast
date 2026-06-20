'use strict';

const _cache = new Map();

async function load(pkg) {
  if (_cache.has(pkg)) return _cache.get(pkg);
  const mod = await import(pkg);
  _cache.set(pkg, mod);
  return mod;
}

module.exports = { load };
