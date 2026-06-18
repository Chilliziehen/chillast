'use strict';

const { CITIES } = require('../core/data/Cities');

/**
 * IpcRouter — Mediator between the renderer (via IPC) and the application
 * services. It is the only place that knows the channel names, and it normalises
 * every response into a `{ ok, data | error }` envelope so the renderer has a
 * single, predictable error-handling path. Business logic lives in the injected
 * services, never here.
 */
class IpcRouter {
  /**
   * @param {object} deps
   * @param {Electron.IpcMain} deps.ipcMain
   * @param {ProfileRepository} deps.profileRepository
   * @param {AstrologyService} deps.astrologyService
   */
  constructor({ ipcMain, profileRepository, astrologyService, config, locale }) {
    this.ipcMain = ipcMain;
    this.profiles = profileRepository;
    this.astrology = astrologyService;
    this.config = config || {};
    this.locale = locale || {};
  }

  /** Register every channel handler. Call once during app startup. */
  register() {
    this._handle('config:get', () => this.config);
    this._handle('locale:get', () => this.locale);
    this._handle('reference:get', () => this.astrology.referenceData());
    this._handle('chartTypes:get', () => this.astrology.chartTypes());

    this._handle('profiles:list', () => this.profiles.list());
    this._handle('profiles:get', (_e, id) => this.profiles.get(id));
    this._handle('profiles:save', (_e, profileJson) => this.profiles.save(profileJson));
    this._handle('profiles:remove', (_e, id) => this.profiles.remove(id));

    this._handle('chart:compute', (_e, request) => this.astrology.computeChart(request));

    this._handle('cities:search', (_e, query) => this._searchCities(query));
    return this;
  }

  /** Wrap a handler so thrown errors become a structured envelope. */
  _handle(channel, fn) {
    this.ipcMain.handle(channel, async (event, ...args) => {
      try {
        const data = await fn(event, ...args);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    });
  }

  /** Case-insensitive city search across Chinese/English names. */
  _searchCities(query) {
    const q = String(query || '').trim().toLowerCase();
    const pool = q
      ? CITIES.filter((c) => c.nameZh.toLowerCase().includes(q)
          || c.nameEn.toLowerCase().includes(q)
          || c.country.toLowerCase().includes(q))
      : CITIES;
    return pool.slice(0, 40);
  }
}

module.exports = IpcRouter;
