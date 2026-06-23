'use strict';

/**
 * SmokeRenderer.js — boots the real renderer inside a hidden Electron window and
 * verifies it loads cleanly: the bridge is present, the shell renders, a chart
 * computes over IPC, and the ESM ChartWheel produces valid (NaN-free) SVG in the
 * actual browser environment. Captures renderer console errors and fails on any.
 *
 * Run with `npm run smoke`. Uses a throwaway temp data dir so it never touches
 * real profiles.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, BrowserWindow, ipcMain } = require('electron');

const ProfileRepository = require('../src/main/ProfileRepository');
const IpcRouter = require('../src/main/IpcRouter');
const AstrologyService = require('../src/core/astrology/AstrologyService');

const consoleErrors = [];

function fail(message) {
  console.error(`\n✗ SMOKE FAILED: ${message}\n`);
  app.exit(1);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // Configure the Swiss Ephemeris path (Main does this in the real app); without
  // it, swisseph chart compute throws "星历数据路径未配置" and the wheel render
  // gets undefined data.
  try {
    const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');
    SwissEphCore.configure({ ephePath: path.join(__dirname, '..', 'assets', 'ephemeris') });
  } catch (_) { /* swisseph optional; JS fallback otherwise */ }

  // Isolated temp store.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'myst-smoke-'));
  const repo = new ProfileRepository(tmpDir).init();
  new IpcRouter({ ipcMain, profileRepository: repo, astrologyService: new AstrologyService() }).register();

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload', 'Preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    // level 3 === error
    if (level >= 3) consoleErrors.push(message);
  });
  win.webContents.on('preload-error', (_e, file, error) => {
    consoleErrors.push(`preload-error ${file}: ${error}`);
  });

  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'Index.html'));
    // Allow the app's async start() and a render frame to complete.
    await new Promise((r) => setTimeout(r, 1500));

    const report = await win.webContents.executeJavaScript(`(async () => {
      const out = { hasApi: !!window.mystApi };
      out.hasSidebar = !!document.querySelector('.sidebar');
      out.brand = (document.querySelector('.brand-title')||{}).textContent || '';
      out.navItems = document.querySelectorAll('.nav-item').length;

      // Save a profile + compute a natal chart over the real IPC bridge.
      const save = await window.mystApi.profiles.save({
        nameZh:'冒烟', gender:'other',
        birthData:{ year:1990, month:1, day:15, hour:14, minute:30,
          location:{ label:'北京', latitude:39.9042, longitude:116.4074 } }
      });
      out.saveOk = save && save.ok;
      const ref = (await window.mystApi.getReferenceData()).data;
      const chartRes = await window.mystApi.computeChart({ type:'natal', primary: save.data });
      out.chartOk = chartRes && chartRes.ok;
      out.ringPoints = out.chartOk ? chartRes.data.rings[0].points.length : 0;

      // Render the wheel via the real ESM module in this browser context.
      const mod = await import('./app/components/ChartWheel.js');
      const wheel = new mod.ChartWheel(ref);
      const svg = wheel.toSvg(chartRes.data);
      out.svgValid = svg.startsWith('<svg') && svg.endsWith('</svg>');
      out.svgHasNaN = /NaN/.test(svg);
      out.svgLen = svg.length;
      return out;
    })()`);

    console.log('\nSmoke report:', JSON.stringify(report, null, 2));
    console.log('Console errors:', consoleErrors.length ? consoleErrors : 'none');

    const problems = [];
    if (!report.hasApi) problems.push('window.mystApi missing');
    if (!report.hasSidebar) problems.push('shell did not render (.sidebar missing)');
    if (report.navItems < 3) problems.push('navigation incomplete');
    if (!report.saveOk) problems.push('profile save failed');
    if (!report.chartOk) problems.push('chart compute failed');
    if (report.ringPoints < 10) problems.push('chart has too few points');
    if (!report.svgValid) problems.push('SVG invalid');
    if (report.svgHasNaN) problems.push('SVG contains NaN coordinates');
    if (consoleErrors.length) problems.push(`renderer console errors: ${consoleErrors.join(' | ')}`);

    if (problems.length) {
      fail(problems.join('; '));
    } else {
      console.log('\n✓ SMOKE PASSED\n');
      app.exit(0);
    }
  } catch (err) {
    fail((err && err.stack) || String(err));
  }
});

// Safety timeout.
setTimeout(() => fail('timed out'), 30000);
