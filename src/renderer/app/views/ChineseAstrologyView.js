import { h, mount, clear } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { renderBaZiChart } from '../components/BaZiChart.js';
import { fiveElementsPanel, dayMasterPanel, lunarInfoPanel, pillarDetailPanel, singlePillarPanel } from '../components/BaZiTables.js';
import { hourPillarsPanel } from '../components/HourPillarsTable.js';
import { notify } from '../components/Toast.js';
import { t } from '../I18n.js';

export class ChineseAstrologyView {
  constructor(context) {
    this.ctx = context;
  }

  get title() {
    return { h1: t('chinese.title'), sub: t('chinese.sub') };
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _draw() {
    const profiles = this.ctx.store.getState().profiles || [];

    if (!profiles.length) {
      mount(this.container, h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '☯'),
        h('p', {}, t('chinese.needProfile')),
      ]));
      return;
    }

    const defaultId = this.ctx.store.getState().selectedPrimaryId || profiles[0].id;
    this.profileSelect = profileSelect(profiles, defaultId);

    this.chartCol = h('div', { class: 'chart-col' }, [emptyResult()]);
    this.dataCol = h('div', { class: 'data-col' });

    const wrap = h('div', { class: 'workbench-wrap' }, [
      h('div', { class: 'workbench-bar' }, [
        labeled(t('chinese.labelProfile'), this.profileSelect),
        h('button', { class: 'btn btn-primary', onclick: () => this._compute() }, t('chinese.generate')),
      ]),
      h('div', { class: 'workbench-main' }, [this.chartCol, this.dataCol]),
    ]);

    mount(this.container, wrap);
  }

  async _compute() {
    const profiles = this.ctx.store.getState().profiles || [];
    const profile = profiles.find((p) => p.id === this.profileSelect.value);
    if (!profile) return;

    mount(this.chartCol, loadingResult());
    clear(this.dataCol);

    try {
      const result = await ApiClient.chinese.computeBazi(profile);
      this._lastResult = result;
      this._selectedPillar = null;
      this._renderResult(result);

      notify.success(t('chinese.generated'));
    } catch (err) {
      mount(this.chartCol, h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '⚠'),
        h('p', {}, err.message),
      ]));
      notify.error(err.message);
    }
  }

  _renderResult(result) {
    const selectPillar = (key) => {
      this._selectedPillar = key;
      this._renderResult(result);
    };

    mount(this.chartCol, h('div', { style: { padding: 'var(--sp-4)' } }, [
      renderBaZiChart(result.bazi, selectPillar, this._selectedPillar),
    ]));

    if (this._selectedPillar) {
      mount(this.dataCol, [
        singlePillarPanel(result.bazi, this._selectedPillar),
        fiveElementsPanel(result.bazi),
        lunarInfoPanel(result.lunar),
      ]);
    } else {
      mount(this.dataCol, [
        dayMasterPanel(result.bazi),
        fiveElementsPanel(result.bazi),
        lunarInfoPanel(result.lunar),
        pillarDetailPanel(result.bazi),
        hourPillarsPanel(result.bazi),
      ]);
    }
  }
}

function labeled(text, control) {
  return h('div', { class: 'flex-col gap-half' }, [
    h('span', { class: 'fs-2xs text-muted ls-normal' }, text),
    control,
  ]);
}

function profileSelect(profiles, selectedId) {
  return h('select', { class: 'select' },
    profiles.map((p) =>
      h('option', { value: p.id, selected: p.id === selectedId },
        `${p.nameZh || p.nameEn} · ${p.birthData.year}-${pad(p.birthData.month)}-${pad(p.birthData.day)}`)
    ));
}

function emptyResult() {
  return h('div', { class: 'empty-state' }, [
    h('div', { class: 'big' }, '☯'),
    h('p', {}, t('chinese.emptyResult')),
  ]);
}

function loadingResult() {
  return h('div', { class: 'empty-state' }, [
    h('div', { class: 'big boot-glyph' }, '☯'),
    h('p', {}, t('chinese.loading')),
  ]);
}

function pad(n) { return String(n).padStart(2, '0'); }
