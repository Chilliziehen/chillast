'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const ProfileRepository = require('./ProfileRepository');
const IpcRouter = require('./IpcRouter');
const AstrologyService = require('../core/astrology/AstrologyService');

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
    const baseDir = path.join(app.getPath('userData'), 'data');
    this.profileRepository = new ProfileRepository(baseDir).init();
    this.astrologyService = new AstrologyService();
    new IpcRouter({
      ipcMain,
      profileRepository: this.profileRepository,
      astrologyService: this.astrologyService,
    }).register();
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1100,
      minHeight: 720,
      backgroundColor: '#1e1e1e',
      title: 'Myst · 神秘学星盘工作室',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'Preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

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
  }
}

new Main().start();
