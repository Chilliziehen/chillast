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
  constructor({ ipcMain, profileRepository, astrologyService, chineseAstrologyService, config, locale, aiService, aiSessionStore }) {
    this.ipcMain = ipcMain;
    this.profiles = profileRepository;
    this.astrology = astrologyService;
    this.chinese = chineseAstrologyService;
    this.config = config || {};
    this.locale = locale || {};
    this.ai = aiService;
    this.aiSessionStore = aiSessionStore || null;
    this.webContents = null;
  }

  setWebContents(wc) { this.webContents = wc; }

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

    this._handle('chinese:reference', () => this.chinese.referenceData());
    this._handle('chinese:computeBazi', (_e, profileData) => this.chinese.computeBaZi(profileData));
    this._handle('chinese:solarTerms', (_e, year) => {
      const { getSolarTermCalendar } = require('../core/chinese/SolarTermCalendar');
      return getSolarTermCalendar(year);
    });
    this._handle('chinese:searchCities', (_e, query) => {
      const { searchChineseCities } = require('../core/chinese/ChineseCityDatabase');
      return searchChineseCities(query);
    });

    // AI handlers
    if (this.ai) {
      this._handle('ai:status', () => this.ai.status());
      this._handle('ai:testConnection', () => this.ai.testConnection());
      this._handle('ai:testWithSettings', (_e, settings) => this.ai.testWithSettings(settings));
      this._handle('ai:providers', () => {
        const ModelProvider = require('../core/ai/ModelProvider');
        return ModelProvider.listProviders();
      });
      this._handle('ai:configure', async (_e, settings) => {
        const { app, safeStorage } = require('electron');
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(app.getPath('userData'), 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        // Save API key — try safeStorage, fallback to plain JSON
        if (settings.apiKey) {
          const credPath = path.join(dataDir, 'ai-credentials.json');
          const credJson = JSON.stringify({ apiKey: settings.apiKey });
          try {
            if (safeStorage.isEncryptionAvailable()) {
              const encrypted = safeStorage.encryptString(credJson);
              fs.writeFileSync(credPath, encrypted);
            } else {
              throw new Error('safeStorage not available');
            }
          } catch (_) {
            fs.writeFileSync(credPath, credJson, 'utf-8');
          }
        }

        // Save non-secret settings
        const settingsPath = path.join(dataDir, 'ai-settings.json');
        const persisted = {
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl || '',
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        };
        fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), 'utf-8');

        await this.ai.configure(settings);
        if (this.webContents) this.webContents.send('ai:statusChanged', this.ai.status());
        return { ok: true };
      });
      this._handle('ai:interpret', async (_e, chartData, options) => {
        const sessionId = options.sessionId || String(Date.now());
        try {
          let aiText = '';
          for await (const ev of this.ai.interpret(chartData, options)) {
            if (this.webContents) this.webContents.send('ai:token', { type: ev.type, data: ev.data });
            if (ev.type === 'token') {
              aiText += ev.data;
            }
          }
          if (aiText && this.aiSessionStore && sessionId) {
            this.aiSessionStore.appendMessage(sessionId, { role: 'user', content: 'AI 解读' });
            this.aiSessionStore.appendMessage(sessionId, { role: 'ai', content: aiText });
          }
          if (this.webContents) this.webContents.send('ai:done', { ok: true });
          this._maybeAutoTitle(sessionId);
          return { ok: true };
        } catch (err) {
          if (this.webContents) this.webContents.send('ai:error', { message: err.message });
          return { ok: false, error: err.message };
        }
      });
      this._handle('ai:chat', async (_e, messages, context) => {
        const sessionId = context.sessionId || String(Date.now());
        try {
          let fullMessages = messages;
          if (this.aiSessionStore && sessionId) {
            const userMsg = messages[messages.length - 1];
            if (userMsg) {
              this.aiSessionStore.appendMessage(sessionId, userMsg);
            }
            const session = this.aiSessionStore.get(sessionId);
            if (session && session.messages) {
              fullMessages = session.messages;
            }
          }

          let aiText = '';
          for await (const ev of this.ai.chat(fullMessages, { ...context, sessionId })) {
            if (this.webContents) this.webContents.send('ai:token', { sessionId, type: ev.type, data: ev.data });
            if (ev.type === 'token') {
              aiText += ev.data;
            }
          }

          if (aiText && this.aiSessionStore && sessionId) {
            this.aiSessionStore.appendMessage(sessionId, { role: 'ai', content: aiText });
          }

          if (this.webContents) this.webContents.send('ai:done', { ok: true, sessionId });
          this._maybeAutoTitle(sessionId);
          return { ok: true };
        } catch (err) {
          if (this.webContents) this.webContents.send('ai:error', { message: err.message, sessionId });
          return { ok: false, error: err.message };
        }
      });
      this._handle('ai:stop', (_e, sessionId) => { this.ai.stop(sessionId); return { ok: true }; });
      this._handle('ai:knowledge:list', () => this.ai.getKnowledgeBase()?.listDocuments() || []);
      this._handle('ai:sessions:list', () => this.aiSessionStore ? this.aiSessionStore.list() : []);
      this._handle('ai:sessions:get', (_e, id) => this.aiSessionStore ? this.aiSessionStore.get(id) : null);
      this._handle('ai:sessions:create', () => this.aiSessionStore ? this.aiSessionStore.create() : null);
      this._handle('ai:sessions:delete', (_e, id) => {
        if (this.aiSessionStore) return this.aiSessionStore.delete(id);
        return false;
      });
      this._handle('ai:sessions:rename', (_e, id, title) => {
        if (!this.aiSessionStore) return null;
        const updated = this.aiSessionStore.setTitle(id, title);
        if (updated && this.webContents) this.webContents.send('ai:sessionsChanged');
        return updated;
      });
      this._handle('ai:sessions:generateTitle', async (_e, id) => {
        if (!this.aiSessionStore) return { title: '' };
        const session = this.aiSessionStore.get(id);
        if (!session) return { title: '' };
        const title = await this.ai.summarizeTitle(session.messages);
        if (title) {
          this.aiSessionStore.setTitle(id, title);
          if (this.webContents) this.webContents.send('ai:sessionsChanged');
        }
        return { title };
      });
      this._handle('ai:sessions:append', (_e, sessionId, message) => {
        if (!this.aiSessionStore) return { ok: false };
        const updated = this.aiSessionStore.appendMessage(sessionId, message);
        return updated ? { ok: true, data: updated } : { ok: false };
      });
      this._handle('ai:setContext', (_e, context) => {
        this.ai.setContext(context);
        return { ok: true };
      });
      this._handle('ai:knowledge:import', async (_e, filePaths) => {
        const kb = this.ai.getKnowledgeBase();
        if (!kb) throw new Error('知识库未初始化');
        const count = await kb.importDocuments(filePaths);
        return { count };
      });
      this._handle('ai:knowledge:remove', (_e, docId) => {
        const kb = this.ai.getKnowledgeBase();
        if (!kb) throw new Error('知识库未初始化');
        const removed = kb.removeDocument(docId);
        return { removed };
      });
    }

    this._handle('cities:search', (_e, query) => this._searchCities(query));
    return this;
  }

  /**
   * Generate an AI title for a session the first time it has content, then
   * notify the renderer to refresh its session list. Fire-and-forget: never
   * blocks the chat response and swallows all errors.
   */
  async _maybeAutoTitle(sessionId) {
    try {
      if (!this.aiSessionStore || !this.ai || !sessionId) return;
      const session = this.aiSessionStore.get(sessionId);
      if (!session || session.title) return;
      if (!session.messages.some((m) => m.role === 'user')) return;
      const title = await this.ai.summarizeTitle(session.messages);
      if (!title) return;
      this.aiSessionStore.setTitle(sessionId, title);
      if (this.webContents) this.webContents.send('ai:sessionsChanged');
    } catch (_) { /* titling is best-effort */ }
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
