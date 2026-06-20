'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const ProfileRepository = require('./ProfileRepository');
const IpcRouter = require('./IpcRouter');
const AstrologyService = require('../core/astrology/AstrologyService');
const ChineseAstrologyService = require('../core/chinese/ChineseAstrologyService');
const ConfigManager = require('../core/config/ConfigManager');
const SwissEphCore = require('../core/astrology/ephemeris/SwissEphCore');
const ChartStrategyFactory = require('../core/astrology/ChartStrategyFactory');
const AiService = require('../core/ai/AiService');

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
    SwissEphCore.configure({ ephePath });

    const baseDir = path.join(app.getPath('userData'), 'data');
    this.profileRepository = new ProfileRepository(baseDir).init();
    this.astrologyService = new AstrologyService(
      new ChartStrategyFactory({ backend: this.config.ephemeris.backend }),
    );
    this.chineseAstrologyService = new ChineseAstrologyService();

    // AI Service bootstrap
    const builtinKnowledgePath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', 'knowledge', 'builtin')
      : path.join(__dirname, '..', '..', 'assets', 'knowledge', 'builtin');
    const userKnowledgePath = path.join(app.getPath('userData'), 'knowledge', 'user');
    this.aiService = new AiService(this.astrologyService, this.chineseAstrologyService);
    const aiSettings = {
      ...(this.config.ai || {}),
      knowledgeBuiltinPath: builtinKnowledgePath,
      knowledgeUserPath: userKnowledgePath,
    };
    const credPath = path.join(app.getPath('userData'), 'ai-credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        const { safeStorage } = require('electron');
        const encrypted = fs.readFileSync(credPath, 'utf-8');
        const cred = JSON.parse(safeStorage.decryptString(encrypted));
        aiSettings.apiKey = cred.apiKey || '';
      } catch (_) {}
    }
    this.aiService.configure(aiSettings).catch(() => {});

    this.router = new IpcRouter({
      ipcMain,
      profileRepository: this.profileRepository,
      astrologyService: this.astrologyService,
      chineseAstrologyService: this.chineseAstrologyService,
      config: this.config,
      locale: this.locale,
      aiService: this.aiService,
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
      SwissEphCore.close();
      if (this.aiService) this.aiService.close();
    });
  }
}

new Main().start();
