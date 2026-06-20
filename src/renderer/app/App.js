// App.js — the renderer application root. It loads reference data and profiles,
// builds the app chrome (sidebar + header) and routes between views. Views are
// instantiated lazily and re-rendered when the active route or profile list
// changes. Acts as the composition root for the UI layer.

import { h, mount } from './Dom.js';
import { Store } from './Store.js';
import { ApiClient } from './ApiClient.js';
import { applyConfig } from './ConfigApplier.js';
import { loadLocale, t } from './I18n.js';
import { ProfilesView } from './views/ProfilesView.js';
import { ChartView } from './views/ChartView.js';
import { SynastryView } from './views/SynastryView.js';
import { ChineseAstrologyView } from './views/ChineseAstrologyView.js';
import { SolarTermCalendarView } from './views/SolarTermCalendarView.js';
import { AiSidebar } from './components/AiSidebar.js';
import { SettingsView } from './views/SettingsView.js';

const ROUTES = [
  { key: 'profiles', glyph: '☰', label: 'nav.profiles', group: 'nav.groupProfiles' },
  { key: 'personal', glyph: '☉', label: 'nav.personal', group: 'nav.groupCharts' },
  { key: 'relationship', glyph: '☍', label: 'nav.relationship', group: 'nav.groupCharts' },
  { key: 'chinese', glyph: '☯', label: 'nav.chinese', group: 'nav.groupChinese' },
  { key: 'solarTerms', glyph: '◇', label: 'nav.solarTerms', group: 'nav.groupTools' },
  { key: 'settings', glyph: '⚙', label: 'nav.settings', group: 'nav.groupTools' },
];

export class App {
  constructor(rootEl) {
    this.root = rootEl;
    this.store = new Store({ profiles: [], selectedPrimaryId: null });
    this.activeRoute = 'profiles';
    this.views = {};
    this.currentContext = { route: 'profiles', activeProfile: null, lastChartData: null, chartType: null };
    this.aiCollapsed = false;
  }

  async start() {
    const config = await ApiClient.getConfig();
    applyConfig(config);
    this.config = config;

    const locale = await ApiClient.getLocale();
    loadLocale(locale);

    const reference = await ApiClient.getReferenceData();
    this.reference = reference;
    this.reference._wheelLocale = locale.wheel || {};
    await this.refreshProfiles();

    const ctx = {
      store: this.store,
      reference: this.reference,
      config: this.config,
      refreshProfiles: () => this.refreshProfiles(),
      navigate: (route) => this.navigate(route),
      setLastChart: (chartData, chartType) => this.setLastChart(chartData, chartType),
    };
    this.views.profiles = new ProfilesView(ctx);
    this.views.personal = new ChartView(ctx);
    this.views.relationship = new SynastryView(ctx);
    this.views.chinese = new ChineseAstrologyView(ctx);
    this.views.solarTerms = new SolarTermCalendarView(ctx);
    this.views.settings = new SettingsView(ctx);

    this._buildShell();
    this.navigate('profiles');

    // Re-render the active view whenever profiles change.
    this.store.subscribe(() => {
      if (this.activeRoute && this.contentEl) this._renderActive();
      this._syncNav();
      const state = this.store.getState();
      const profiles = state.profiles || [];
      const selectedId = state.selectedPrimaryId;
      this.currentContext.activeProfile = selectedId
        ? profiles.find((p) => p.id === selectedId) || null
        : null;
      this._pushContext();
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
      h('div', { class: 'nav-group-label' }, t(group)),
      ...items.map((r) => {
        const el = h('div', {
          class: 'nav-item', onclick: () => this.navigate(r.key),
        }, [h('span', { class: 'nav-glyph svg-glyph' }, r.glyph), h('span', {}, t(r.label))]);
        this.navEls[r.key] = el;
        return el;
      }),
    ]);

    const sidebar = h('aside', { class: 'sidebar' }, [
      h('div', { class: 'brand' }, [
        h('div', { class: 'brand-mark svg-glyph' }, '✶'),
        h('div', {}, [
          h('div', { class: 'brand-title' }, t('app.title')),
          h('div', { class: 'brand-sub' }, t('app.brandSub')),
        ]),
      ]),
      ...nav,
      h('div', { class: 'sidebar-footer' }, t('app.version')),
    ]);

    this.aiSidebar = new AiSidebar({ onNavigate: (route) => this.navigate(route) });

    this.aiToggleBtn = h('button', {
      class: 'btn btn-sm ai-toggle-btn is-active',
      title: t('ai.toggle'),
      onclick: () => this._toggleAiSidebar(),
    }, '✦');

    // Add toggle to header actions
    const headerActions = h('div', { class: 'header-actions' }, [
      h('span', { class: 'chip' }, t('app.chipSigns', { count: this.reference.signs.length })),
      h('span', { class: 'chip' }, t('app.chipCharts', { count: this.reference.chartTypes.length })),
      this.aiToggleBtn,
    ]);

    const main = h('div', { class: 'main' }, [
      h('header', { class: 'app-header' }, [
        h('div', {}, [this.headerTitle, this.headerSub]),
        headerActions,
      ]),
      this.contentEl,
    ]);

    mount(this.root, [sidebar, main, this.aiSidebar.element]);
    this.aiSidebar.updateStatus().catch(() => {});
  }

  navigate(route) {
    this.activeRoute = route;
    this.currentContext.route = route;
    this._pushContext();
    const meta = ROUTES.find((r) => r.key === route);
    const view = this.views[route];
    if (meta && view) {
      this.headerTitle.textContent = view.title.h1;
      this.headerSub.textContent = view.title.sub;
    }
    this._syncNav();
    this._renderActive();
  }

  _toggleAiSidebar() {
    this.aiCollapsed = !this.aiCollapsed;
    if (this.aiCollapsed) {
      this.root.classList.add('ai-collapsed');
      this.aiToggleBtn.classList.remove('is-active');
    } else {
      this.root.classList.remove('ai-collapsed');
      this.aiToggleBtn.classList.add('is-active');
    }
  }

  _pushContext() {
    if (this.aiSidebar) this.aiSidebar.setContext(this.currentContext);
    window.mystApi.ai.setContext(this.currentContext);
  }

  setLastChart(chartData, chartType) {
    this.currentContext.lastChartData = chartData;
    this.currentContext.chartType = chartType;
    this._pushContext();
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
