import { h, mount } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { fiveElementsPanel, dayMasterPanel, lunarInfoPanel, pillarDetailPanel, tenGodsPanel } from '../components/BaZiTables.js';
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

    this.resultHost = h('div', { class: 'bazi-result' }, [emptyResult()]);

    const wrap = h('div', { class: 'workbench-wrap' }, [
      h('div', { class: 'workbench-bar' }, [
        labeled(t('chinese.labelProfile'), this.profileSelect),
        h('button', { class: 'btn btn-primary', onclick: () => this._compute() }, t('chinese.generate')),
        h('button', {
          class: 'btn btn-ghost',
          onclick: () => {
            const profiles = this.ctx.store.getState().profiles || [];
            const p = profiles.find((x) => x.id === this.profileSelect.value);
            if (p && this.ctx.setActiveProfile) this.ctx.setActiveProfile(p);
            if (this.ctx.requestAiChat) {
              this.ctx.requestAiChat('请结合我当前选中档案的八字命盘，进行详细的传统命理分析（五行旺衰、十神、藏干、格局与人生建议）。');
            }
          },
        }, t('ai.interpret')),
      ]),
      this.resultHost,
    ]);

    mount(this.container, wrap);
  }

  async _compute() {
    const profiles = this.ctx.store.getState().profiles || [];
    const profile = profiles.find((p) => p.id === this.profileSelect.value);
    if (!profile) return;

    // Let the AI know which profile is being analyzed.
    if (this.ctx.setActiveProfile) this.ctx.setActiveProfile(profile);

    mount(this.resultHost, loadingResult());

    try {
      const result = await ApiClient.chinese.computeBazi(profile);
      this._lastResult = result;
      this._renderResult(result);

      notify.success(t('chinese.generated'));
    } catch (err) {
      mount(this.resultHost, h('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, [
        h('div', { class: 'big' }, '⚠'),
        h('p', {}, err.message),
      ]));
      notify.error(err.message);
    }
  }

  // Unified single page — all panels in one responsive grid, no pillar switching.
  _renderResult(result) {
    mount(this.resultHost, [
      dayMasterPanel(result.bazi),
      tenGodsPanel(result.analysis),
      pillarDetailPanel(result.bazi),
      fiveElementsPanel(result.bazi),
      lunarInfoPanel(result.lunar),
      hourPillarsPanel(result.bazi),
    ]);
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
  return h('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, [
    h('div', { class: 'big' }, '☯'),
    h('p', {}, t('chinese.emptyResult')),
  ]);
}

function loadingResult() {
  return h('div', { class: 'empty-state', style: { gridColumn: '1 / -1' } }, [
    h('div', { class: 'big boot-glyph' }, '☯'),
    h('p', {}, t('chinese.loading')),
  ]);
}

function pad(n) { return String(n).padStart(2, '0'); }
