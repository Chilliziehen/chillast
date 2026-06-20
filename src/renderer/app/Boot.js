// Boot.js — renderer entry point. Mounts the toast host and starts the App,
// surfacing any fatal bootstrap error in place of the splash screen.

import { App } from './App.js';
import { mountToastHost } from './components/Toast.js';

async function boot() {
  mountToastHost();
  const root = document.getElementById('app');
  try {
    const app = new App(root);
    await app.start();
    window.__mystApp = app;
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><div class="big">⚠</div>
      <p>应用启动失败：${(err && err.message) || err}</p></div>`;
    console.error(err);
  }
}

boot();
