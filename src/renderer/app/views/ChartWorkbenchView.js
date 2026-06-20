import { h, mount, clear } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { renderChartResult } from '../components/ChartResult.js';
import { notify } from '../components/Toast.js';
import { t } from '../I18n.js';

const ZODIACS = [
  { value: 'tropical', label: 'chart.tropical' },
  { value: 'sidereal', label: 'chart.sidereal' },
];

export class ChartWorkbenchView {
  constructor(context, category) {
    this.ctx = context;
    this.category = category;
    this.state = {
      type: category === 'personal' ? 'natal' : 'synastry',
      houseSystem: 'placidus',
      zodiac: 'tropical',
      options: {},
    };
  }

  get title() {
    return this.category === 'personal'
      ? { h1: t('chart.personalTitle'), sub: t('chart.personalSub') }
      : { h1: t('chart.relationshipTitle'), sub: t('chart.relationshipSub') };
  }

  get chartTypes() {
    return (this.ctx.reference.chartTypes || []).filter((t) => t.category === this.category);
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _draw() {
    const profiles = this.ctx.store.getState().profiles || [];

    if (!profiles.length) {
      mount(this.container, h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '✶'),
        h('p', {}, t('chart.needProfile')),
      ]));
      return;
    }

    const primaryDefault = this.ctx.store.getState().selectedPrimaryId || profiles[0].id;
    this.primarySelect = profileSelect(profiles, primaryDefault);
    this.primarySelect.addEventListener('change', () => this._autoRefresh());
    this.secondarySelect = profileSelect(profiles, profiles[1] ? profiles[1].id : profiles[0].id);
    this.secondarySelect.addEventListener('change', () => this._autoRefresh());

    this.typeSelect = h('select', {
      class: 'select',
      onchange: (e) => {
        this.state.type = e.target.value;
        this._updateOptions();
        this._autoRefresh();
      },
    }, this.chartTypes.map((t) =>
      h('option', { value: t.type, selected: t.type === this.state.type }, t.nameZh)
    ));

    this.houseSelect = h('select', { class: 'select', onchange: () => this._autoRefresh() },
      this.ctx.reference.houseSystems.map((hs) =>
        h('option', { value: hs.value, selected: hs.value === this.state.houseSystem }, hs.nameZh)
      ));
    this.zodiacSelect = h('select', { class: 'select', onchange: () => this._autoRefresh() },
      ZODIACS.map((z) =>
        h('option', { value: z.value, selected: z.value === this.state.zodiac }, t(z.label))
      ));

    const barChildren = [];
    if (this.category === 'relationship') {
      barChildren.push(labeled(t('chart.labelInner'), this.primarySelect));
      barChildren.push(labeled(t('chart.labelOuter'), this.secondarySelect));
    } else {
      barChildren.push(labeled(t('chart.labelProfile'), this.primarySelect));
    }
    barChildren.push(labeled(t('chart.labelType'), this.typeSelect));
    barChildren.push(labeled(t('chart.labelHouse'), this.houseSelect));
    barChildren.push(labeled(t('chart.labelZodiac'), this.zodiacSelect));
    this.generateBtn = h('button', {
      class: 'btn btn-primary',
      onclick: () => this._compute(),
    }, this._hasGenerated ? t('chart.regenerate') : t('chart.generate'));
    barChildren.push(this.generateBtn);

    this.optionsHost = h('div', { class: 'workbench-options' });
    this.chartCol = h('div', { class: 'chart-col' }, [emptyResult()]);
    this.dataCol = h('div', { class: 'data-col' });

    const wrap = h('div', { class: 'workbench-wrap' }, [
      h('div', { class: 'workbench-bar' }, barChildren),
      this.optionsHost,
      h('div', { class: 'workbench-main' }, [
        this.chartCol,
        this.dataCol,
      ]),
    ]);

    mount(this.container, wrap);
    this._updateOptions();
  }

  _currentType() {
    return this.chartTypes.find((t) => t.type === this.state.type) || this.chartTypes[0];
  }

  _updateOptions() {
    const def = this._currentType();
    const needsOptions = def.options.length > 0;
    clear(this.optionsHost);

    if (!needsOptions) {
      this.optionsHost.classList.remove('is-open');
      this.dateInput = null;
      this.yearInput = null;
      this.latInput = null;
      this.lngInput = null;
      this.locLabelInput = null;
      return;
    }

    const row = h('div', { class: 'options-row' });

    if (def.options.includes('targetDate')) {
      this.dateInput = h('input', { class: 'input', type: 'datetime-local', value: defaultDateTimeLocal(), onchange: () => this._autoRefresh() });
      row.appendChild(field(t('chart.targetDate'), this.dateInput));
      this.yearInput = null;
      this.latInput = null;
      this.lngInput = null;
      this.locLabelInput = null;
    } else if (def.options.includes('year')) {
      this.yearInput = h('input', { class: 'input', type: 'number', min: 1, max: 3000, value: new Date().getFullYear(), style: { width: '100px' }, onchange: () => this._autoRefresh() });
      row.appendChild(field(t('chart.returnYear'), this.yearInput));
      this.dateInput = null;
      this.latInput = null;
      this.lngInput = null;
      this.locLabelInput = null;
    } else if (def.options.includes('location')) {
      this.locLabelInput = h('input', { class: 'input', type: 'text', placeholder: t('chart.locName') });
      this.latInput = h('input', { class: 'input', type: 'number', step: '0.0001', placeholder: t('chart.locLat') });
      this.lngInput = h('input', { class: 'input', type: 'number', step: '0.0001', placeholder: t('chart.locLng') });
      row.appendChild(field(t('chart.locName'), this.locLabelInput));
      row.appendChild(field(t('chart.locLat'), this.latInput));
      row.appendChild(field(t('chart.locLng'), this.lngInput));
      this.dateInput = null;
      this.yearInput = null;
    }

    this.optionsHost.appendChild(row);
    this.optionsHost.classList.add('is-open');
  }

  _buildOptions() {
    const options = {};
    const def = this._currentType();
    if (def.options.includes('targetDate') && this.dateInput && this.dateInput.value) {
      options.targetDate = new Date(this.dateInput.value).toISOString();
    }
    if (def.options.includes('year') && this.yearInput) {
      options.year = Number(this.yearInput.value);
    }
    if (def.options.includes('location')) {
      if (this.latInput) options.latitude = parseFloat(this.latInput.value);
      if (this.lngInput) options.longitude = parseFloat(this.lngInput.value);
      if (this.locLabelInput) options.locationLabel = this.locLabelInput.value || undefined;
    }
    return options;
  }

  _autoRefresh() {
    if (this._hasGenerated) this._compute();
  }

  async _compute() {
    const profiles = this.ctx.store.getState().profiles || [];
    const byId = (id) => profiles.find((p) => p.id === id);
    const def = this._currentType();

    const primary = byId(this.primarySelect.value);
    const secondary = def.requiresSecondary ? byId(this.secondarySelect.value) : undefined;

    if (def.requiresSecondary && secondary && secondary.id === primary.id) {
      notify.error(t('chart.sameProfile'));
      return;
    }

    this.state.houseSystem = this.houseSelect.value;
    this.state.zodiac = this.zodiacSelect.value;

    mount(this.chartCol, loadingResult());
    clear(this.dataCol);

    try {
      const chart = await ApiClient.computeChart({
        type: this.state.type,
        primary,
        secondary,
        settings: { houseSystem: this.state.houseSystem, zodiac: this.state.zodiac },
        options: this._buildOptions(),
      });
      renderChartResult(this.chartCol, this.dataCol, chart, this.ctx.reference,
        this.ctx.config ? this.ctx.config.chart : undefined);
      this._hasGenerated = true;
      this._lastChartData = chart;
      if (this.ctx.setLastChart) {
        this.ctx.setLastChart(chart, chart.meta && chart.meta.type);
      }
      if (this.generateBtn) this.generateBtn.textContent = t('chart.regenerate');
      notify.success(t('chart.generated', { type: chart.meta.typeNameZh }));
    } catch (err) {
      mount(this.chartCol, h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '⚠'),
        h('p', {}, err.message),
      ]));
      notify.error(err.message);
    }
  }
}

function labeled(text, control) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
    h('span', { style: { fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.05em' } }, text),
    control,
  ]);
}

function field(label, control) {
  return control ? h('div', { class: 'field' }, [h('label', {}, label), control]) : null;
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
    h('div', { class: 'big' }, '✶'),
    h('p', {}, t('chart.emptyResult')),
  ]);
}
function loadingResult() {
  return h('div', { class: 'empty-state' }, [
    h('div', { class: 'big boot-glyph' }, '✶'),
    h('p', {}, t('chart.loading')),
  ]);
}

function pad(n) { return String(n).padStart(2, '0'); }
function defaultDateTimeLocal() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}
