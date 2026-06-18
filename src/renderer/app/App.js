// App.js — the renderer application root. It loads reference data and profiles,
// builds the app chrome (sidebar + header) and routes between views. Views are
// instantiated lazily and re-rendered when the active route or profile list
// changes. Acts as the composition root for the UI layer.

import { h, mount } from './Dom.js';
import { Store } from './Store.js';
import { ApiClient } from './ApiClient.js';
import { applyConfig } from './ConfigApplier.js';
import { loadLocale } from './I18n.js';
import { ProfilesView } from './views/ProfilesView.js';
import { ChartView } from './views/ChartView.js';
import { SynastryView } from './views/SynastryView.js';

const ROUTES = [
  { key: 'profiles', glyph: '☰', label: '档案管理', group: '档案' },
  { key: 'personal', glyph: '☉', label: '个人星盘', group: '星盘' },
  { key: 'relationship', glyph: '☍', label: '合盘分析', group: '星盘' },
];

export class App {
  constructor(rootEl) {
    this.root = rootEl;
    this.store = new Store({ profiles: [], selectedPrimaryId: null });
    this.activeRoute = 'profiles';
    this.views = {};
  }

  async start() {
    const config = await ApiClient.getConfig();
    applyConfig(config);
    this.config = config;

    const locale = await ApiClient.getLocale();
    loadLocale(locale);

    const reference = await ApiClient.getReferenceData();
    this.reference = reference;
    await this.refreshProfiles();

    const ctx = {
      store: this.store,
      reference: this.reference,
      config: this.config,
      refreshProfiles: () => this.refreshProfiles(),
      navigate: (route) => this.navigate(route),
    };
    this.views.profiles = new ProfilesView(ctx);
    this.views.personal = new ChartView(ctx);
    this.views.relationship = new SynastryView(ctx);

    this._buildShell();
    this.navigate('profiles');

    // Re-render the active view whenever profiles change.
    this.store.subscribe(() => {
      if (this.activeRoute && this.contentEl) this._renderActive();
      this._syncNav();
    });
  }

  async refreshProfiles() {
    const profiles = await ApiClient.profiles.list();
    const state = this.store.getState();
    const selectedPrimaryId = state.selectedPrimaryId
      && profiles.some((p) => p.id === state.selectedPrimaryId)
      ? state.selectedPrimaryId
      : (profiles[0] ? profiles[0].id : null);
    this.store.setState({ profiles, selectedPrimaryId });
  }

  _buildShell() {
    this.headerTitle = h('h1', {}, '');
    this.headerSub = h('div', { class: 'subtitle' }, '');
    this.contentEl = h('div', { class: 'content' });

    this.navEls = {};
    const navGroups = groupBy(ROUTES, 'group');
    const nav = Object.entries(navGroups).flatMap(([group, items]) => [
      h('div', { class: 'nav-group-label' }, group),
      ...items.map((r) => {
        const el = h('div', {
          class: 'nav-item', onclick: () => this.navigate(r.key),
        }, [h('span', { class: 'nav-glyph svg-glyph' }, r.glyph), h('span', {}, r.label)]);
        this.navEls[r.key] = el;
        return el;
      }),
    ]);

    const sidebar = h('aside', { class: 'sidebar' }, [
      h('div', { class: 'brand' }, [
        h('div', { class: 'brand-mark svg-glyph' }, '✶'),
        h('div', {}, [
          h('div', { class: 'brand-title' }, 'CHILLAST'),
          h('div', { class: 'brand-sub' }, 'PERSONAL ASTROLOGY ANALYSIS'),
        ]),
      ]),
      ...nav,
      h('div', { class: 'sidebar-footer' }, 'v0.0.2 · CHILLAST'),
    ]);

    const main = h('div', { class: 'main' }, [
      h('header', { class: 'app-header' }, [
        h('div', {}, [this.headerTitle, this.headerSub]),
        h('div', { class: 'header-actions' }, [
          h('span', { class: 'chip' }, `${this.reference.signs.length} 星座`),
          h('span', { class: 'chip' }, `${this.reference.chartTypes.length} 种星盘`),
        ]),
      ]),
      this.contentEl,
    ]);

    // #app already carries `.app-shell`; mount the grid children directly to
    // avoid nesting a second grid (which would collapse the content column).
    mount(this.root, [sidebar, main]);
  }

  navigate(route) {
    this.activeRoute = route;
    const meta = ROUTES.find((r) => r.key === route);
    const view = this.views[route];
    if (meta && view) {
      this.headerTitle.textContent = view.title.h1;
      this.headerSub.textContent = view.title.sub;
    }
    this._syncNav();
    this._renderActive();
  }

  _renderActive() {
    const view = this.views[this.activeRoute];
    if (view) view.render(this.contentEl);
  }

  _syncNav() {
    for (const [key, el] of Object.entries(this.navEls)) {
      el.classList.toggle('is-active', key === this.activeRoute);
    }
  }
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    (acc[item[key]] = acc[item[key]] || []).push(item);
    return acc;
  }, {});
}
