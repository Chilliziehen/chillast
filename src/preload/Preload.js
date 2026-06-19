'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload — the single, audited bridge between the sandboxed renderer and the
 * main process. It exposes a small, typed-by-convention API on `window.mystApi`
 * and nothing else: the renderer never gets Node or ipcRenderer directly, which
 * keeps the attack surface minimal while contextIsolation stays on.
 *
 * Every call returns the IpcRouter envelope `{ ok, data | error }`.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('mystApi', {
  /** Static reference data (signs, aspects, chart types, …). */
  getReferenceData: () => invoke('reference:get'),
  getConfig: () => invoke('config:get'),
  getLocale: () => invoke('locale:get'),
  getChartTypes: () => invoke('chartTypes:get'),

  /** Profile CRUD. */
  profiles: {
    list: () => invoke('profiles:list'),
    get: (id) => invoke('profiles:get', id),
    save: (profileJson) => invoke('profiles:save', profileJson),
    remove: (id) => invoke('profiles:remove', id),
  },

  /** Birth-place lookup. */
  searchCities: (query) => invoke('cities:search', query),

  /** Chart computation. */
  computeChart: (request) => invoke('chart:compute', request),

  /** Chinese astrology (命理). */
  chinese: {
    getReferenceData: () => invoke('chinese:reference'),
    computeBazi: (profileData) => invoke('chinese:computeBazi', profileData),
    getSolarTerms: (year) => invoke('chinese:solarTerms', year),
    searchCities: (query) => invoke('chinese:searchCities', query),
  },
});
