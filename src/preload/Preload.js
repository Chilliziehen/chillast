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

  /** AI astrology advisor. */
  ai: {
    interpret: (chartData, options) => invoke('ai:interpret', chartData, options),
    chat: (messages, context) => invoke('ai:chat', messages, context),
    stop: (sessionId) => invoke('ai:stop', sessionId),
    configure: (settings) => invoke('ai:configure', settings),
    status: () => invoke('ai:status'),
    testConnection: () => invoke('ai:testConnection'),
    testWithSettings: (settings) => invoke('ai:testWithSettings', settings),
    providers: () => invoke('ai:providers'),
    setContext: (context) => invoke('ai:setContext', context),
    onToken: (callback) => ipcRenderer.on('ai:token', (_e, data) => callback(data)),
    onDone: (callback) => ipcRenderer.on('ai:done', (_e, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('ai:error', (_e, data) => callback(data)),
    onStatusChanged: (callback) => ipcRenderer.on('ai:statusChanged', (_e, data) => callback(data)),
    onSessionsChanged: (callback) => ipcRenderer.on('ai:sessionsChanged', () => callback()),
    removeAllListeners: () => {
      // Only the per-request streaming channels are cleared between turns;
      // statusChanged / sessionsChanged are long-lived and registered once.
      for (const ch of ['ai:token', 'ai:done', 'ai:error'])
        ipcRenderer.removeAllListeners(ch);
    },
    knowledge: {
      list: () => invoke('ai:knowledge:list'),
      import: (filePaths) => invoke('ai:knowledge:import', filePaths),
      remove: (docId) => invoke('ai:knowledge:remove', docId),
    },
    sessions: {
      list: () => invoke('ai:sessions:list'),
      get: (id) => invoke('ai:sessions:get', id),
      create: () => invoke('ai:sessions:create'),
      delete: (id) => invoke('ai:sessions:delete', id),
      append: (sessionId, message) => invoke('ai:sessions:append', sessionId, message),
      rename: (id, title) => invoke('ai:sessions:rename', id, title),
      generateTitle: (id) => invoke('ai:sessions:generateTitle', id),
    },
  },
});
