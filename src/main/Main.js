'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const ProfileRepository = require('./ProfileRepository');
const IpcRouter = require('./IpcRouter');
const AstrologyService = require('../core/astrology/AstrologyService');
const ChineseAstrologyService = require('../core/chinese/ChineseAstrologyService');
const ConfigManager = require('../core/config/ConfigManager');
let SwissEphCore = null;
try {
  SwissEphCore = require('../core/astrology/ephemeris/SwissEphCore');
} catch (_) { /* swisseph-v2 native binding not rebuilt for Electron yet */ }
const ChartStrategyFactory = require('../core/astrology/ChartStrategyFactory');
const AiService = require('../core/ai/AiService');
const AiSessionStore = require('./AiSessionStore');

const fs = require('fs');

/**
 * Main — Electron main-process bootstrap. It composes the application root
 * (repository, service, IPC router), creates the secured main window and manages
 * the app lifecycle. This is the composition root: all wiring happens here so the
 * collaborators themselves stay free of construction concerns.
 */
class Main {
  constructor() {
    /** @type {BrowserWindow|null} */
    this.mainWindow = null;
    this.profileRepository = null;
    this.astrologyService = null;
  }

  /** Compose services that do not depend on Electron being ready. */
  bootstrapServices() {
    this.config = ConfigManager.load();
    const localeName = this.config.locale || 'zh';
    const localePath = path.join(__dirname, '..', '..', 'locale', `${localeName}.json`);
    this.locale = JSON.parse(fs.readFileSync(localePath, 'utf-8'));

    const ephePath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', 'ephemeris')
      : path.join(__dirname, '..', '..', 'assets', 'ephemeris');
    if (SwissEphCore) SwissEphCore.configure({ ephePath });

    const baseDir = path.join(app.getPath('userData'), 'data');
    this.profileRepository = new ProfileRepository(baseDir).init();
    this.aiSessionStore = new AiSessionStore(baseDir).init();
    this.astrologyService = new AstrologyService(
      new ChartStrategyFactory({ backend: this.config.ephemeris.backend }),
    );
    this.chineseAstrologyService = new ChineseAstrologyService();

    // AI Service bootstrap
    const builtinKnowledgePath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', 'knowledge', 'builtin')
      : path.join(__dirname, '..', '..', 'assets', 'knowledge', 'builtin');
    const userKnowledgePath = path.join(app.getPath('userData'), 'knowledge', 'user');
    this.aiService = new AiService(this.astrologyService, this.chineseAstrologyService, this.profileRepository);

    // Load persisted non-secret settings from data/ai-settings.json
    const aiSettingsPath = path.join(baseDir, 'ai-settings.json');
    const persistedSettings = fs.existsSync(aiSettingsPath)
      ? JSON.parse(fs.readFileSync(aiSettingsPath, 'utf-8'))
      : {};

    const vectorIndexDir = path.join(baseDir, 'vector-index');

    // Packaged builds ship a pre-downloaded embedding model + a pre-built vector
    // index as extraResources (see package.json build). Use the bundled model
    // offline, and seed userData's index from the bundle on first run (so the
    // app is instant + offline, never downloads or rebuilds).
    const bundledModelsDir = app.isPackaged ? path.join(process.resourcesPath, 'models') : null;
    const bundledIndexDir = app.isPackaged ? path.join(process.resourcesPath, 'vector-index') : null;
    if (bundledIndexDir && fs.existsSync(bundledIndexDir) && !fs.existsSync(vectorIndexDir)) {
      try {
        fs.cpSync(bundledIndexDir, vectorIndexDir, { recursive: true });
      } catch (e) {
        console.error('[Main] seeding bundled vector-index failed:', e.message);
      }
    }
    const bundledModel = bundledModelsDir && fs.existsSync(bundledModelsDir)
      ? { localPath: bundledModelsDir, offline: true }
      : {};

    const aiSettings = {
      ...(this.config.ai || {}),
      ...persistedSettings,
      // Embeddings are configured independently of the chat provider. Cache the
      // local model under userData (node_modules is read-only when packaged);
      // when packaged, prefer the bundled offline model.
      embeddings: {
        ...(this.config.embeddings || {}),
        ...(persistedSettings.embeddings || {}),
        cacheDir: path.join(baseDir, 'models'),
        ...bundledModel,
      },
      // Web-search tool config (provider/key/endpoint), independent of chat.
      search: {
        ...(this.config.search || {}),
        ...(persistedSettings.search || {}),
      },
      knowledgeBuiltinPath: builtinKnowledgePath,
      knowledgeUserPath: userKnowledgePath,
      knowledgeIndexDir: vectorIndexDir,
    };

    const credPath = path.join(baseDir, 'ai-credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        const { safeStorage } = require('electron');
        const buf = fs.readFileSync(credPath);
        let cred;
        try {
          if (safeStorage.isEncryptionAvailable()) {
            cred = JSON.parse(safeStorage.decryptString(buf));
          } else {
            throw new Error('safeStorage not available');
          }
        } catch (_) {
          cred = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        }
        aiSettings.apiKey = cred.apiKey || '';
      } catch (_) {}
    }
    // Stream knowledge-base init progress (model download + index build) to the
    // renderer so the first-run wait shows a non-blocking overlay, not a freeze.
    this.aiService.setInitProgressHandler((p) => {
      if (this.router && this.router.webContents) this.router.webContents.send('ai:initProgress', p);
    });
    this.aiService.configure(aiSettings).then(() => {
      if (this.router && this.router.webContents) {
        this.router.webContents.send('ai:statusChanged', this.aiService.status());
      }
    }).catch((e) => {
      console.error('[AiService] configure failed:', e.message);
    });

    this.router = new IpcRouter({
      ipcMain,
      profileRepository: this.profileRepository,
      astrologyService: this.astrologyService,
      chineseAstrologyService: this.chineseAstrologyService,
      config: this.config,
      locale: this.locale,
      aiService: this.aiService,
      aiSessionStore: this.aiSessionStore,
    }).register();
  }

  createWindow() {
    const win = this.config.window || {};
    this.mainWindow = new BrowserWindow({
      width: win.width || 1440,
      height: win.height || 920,
      minWidth: win.minWidth || 1100,
      minHeight: win.minHeight || 720,
      backgroundColor: win.backgroundColor || '#1e1e1e',
      title: 'CHILLAST',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'Preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    this.router.setWebContents(this.mainWindow.webContents);

    this.mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'Index.html'));
    this.mainWindow.once('ready-to-show', () => this.mainWindow.show());

    // Open external links in the OS browser, never inside the app shell.
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    this.mainWindow.on('closed', () => { this.mainWindow = null; });
  }

  /** Wire the full app lifecycle. */
  start() {
    // Single-instance lock keeps the JSON store free of concurrent writers.
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('second-instance', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      this.bootstrapServices();
      this.createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) this.createWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('quit', () => {
      if (SwissEphCore) SwissEphCore.close();
      if (this.aiService) this.aiService.close();
    });
  }
}

new Main().start();
