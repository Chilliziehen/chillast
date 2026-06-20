'use strict';

const fs = require('fs');
const { swisseph } = require('./SwissEphConstants');

let _ephePath = null;
let _initialized = false;

function configure({ ephePath } = {}) {
  _ephePath = ephePath || null;
}

function ensureInitialized() {
  if (_initialized) return;
  if (!_ephePath) throw new Error('星历数据路径未配置（需由 Main 注入）');
  if (!fs.existsSync(_ephePath)) throw new Error(`星历数据目录不存在: ${_ephePath}`);
  swisseph.swe_set_ephe_path(_ephePath);
  _initialized = true;
}

function calcBody(jdUt, planetId) {
  ensureInitialized();
  const r = swisseph.swe_calc_ut(jdUt, planetId, require('./SwissEphConstants').FLAGS);
  if (r && r.error) throw new Error(`星历计算失败 (planetId=${planetId}): ${r.error}`);
  return r;
}

function houses(jdUt, lat, lng, hsysCode) {
  ensureInitialized();
  const r = swisseph.swe_houses(jdUt, lat, lng, hsysCode);
  if (r && r.error) throw new Error(`宫位计算失败: ${r.error}`);
  return r;
}

function housePos(lat, lng, hsysCode, longitude, latitude = 0) {
  ensureInitialized();
  const r = swisseph.swe_house_pos(lat, lng, hsysCode, [longitude, latitude]);
  if (r && r.error) throw new Error(`落宫计算失败: ${r.error}`);
  return Math.floor(r.housePosition);
}

function julDay(year, month, day, hour) {
  return swisseph.swe_julday(year, month, day, hour, swisseph.SE_GREG_CAL);
}

function close() {
  if (_initialized) {
    swisseph.swe_close();
    _initialized = false;
  }
}

module.exports = {
  configure,
  calcBody,
  houses,
  housePos,
  julDay,
  close,
};
