import { h, mount, clear } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { renderChartResult } from '../components/ChartResult.js';
import { notify } from '../components/Toast.js';

const ZODIACS = [
  { value: 'tropical', label: '回归黄道' },
  { value: 'sidereal', label: '恒星黄道' },
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
      ? { h1: '个人星盘', sub: '本命 · 行运 · 推运 · 返照 · 太阳弧 · 法达 · 小限 · 重置' }
      : { h1: '合盘分析', sub: '比较 · 组合 · 马盘 · 时空 · 推运变体' };
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
        h('p', {}, '请先在「档案管理」创建至少一个档案。'),
      ]));
      return;
    }

    const primaryDefault = this.ctx.store.getState().selectedPrimaryId || profiles[0].id;
    this.primarySelect = profileSelect(profiles, primaryDefault);
    this.secondarySelect = profileSelect(profiles, profiles[1] ? profiles[1].id : profiles[0].id);

    this.typeSelect = h('select', {
      class: 'select',
      onchange: (e) => {
        this.state.type = e.target.value;
        this._updateOptions();
      },
    }, this.chartTypes.map((t) =>
      h('option', { value: t.type, selected: t.type === this.state.type }, t.nameZh)
    ));

    this.houseSelect = h('select', { class: 'select' },
      this.ctx.reference.houseSystems.map((hs) =>
        h('option', { value: hs.value, selected: hs.value === this.state.houseSystem }, hs.nameZh)
      ));
    this.zodiacSelect = h('select', { class: 'select' },
      ZODIACS.map((z) =>
        h('option', { value: z.value, selected: z.value === this.state.zodiac }, z.label)
      ));

    const barChildren = [];
    if (this.category === 'relationship') {
      barChildren.push(labeled('内环', this.primarySelect));
      barChildren.push(labeled('外环', this.secondarySelect));
    } else {
      barChildren.push(labeled('档案', this.primarySelect));
    }
    barChildren.push(labeled('类型', this.typeSelect));
    barChildren.push(labeled('宫制', this.houseSelect));
    barChildren.push(labeled('黄道', this.zodiacSelect));
    barChildren.push(h('button', {
      class: 'btn btn-primary',
      style: { marginTop: '14px' },
      onclick: () => this._compute(),
    }, '✶ 生成'));

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
      this.dateInput = h('input', { class: 'input', type: 'datetime-local', value: defaultDateTimeLocal() });
      row.appendChild(field('目标日期', this.dateInput));
      this.yearInput = null;
      this.latInput = null;
      this.lngInput = null;
      this.locLabelInput = null;
    } else if (def.options.includes('year')) {
      this.yearInput = h('input', { class: 'input', type: 'number', min: 1, max: 3000, value: new Date().getFullYear(), style: { width: '100px' } });
      row.appendChild(field('返照年份', this.yearInput));
      this.dateInput = null;
      this.latInput = null;
      this.lngInput = null;
      this.locLabelInput = null;
    } else if (def.options.includes('location')) {
      this.locLabelInput = h('input', { class: 'input', type: 'text', placeholder: '地名' });
      this.latInput = h('input', { class: 'input', type: 'number', step: '0.0001', placeholder: '纬度' });
      this.lngInput = h('input', { class: 'input', type: 'number', step: '0.0001', placeholder: '经度' });
      row.appendChild(field('地名', this.locLabelInput));
      row.appendChild(field('纬度', this.latInput));
      row.appendChild(field('经度', this.lngInput));
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

  async _compute() {
    const profiles = this.ctx.store.getState().profiles || [];
    const byId = (id) => profiles.find((p) => p.id === id);
    const def = this._currentType();

    const primary = byId(this.primarySelect.value);
    const secondary = def.requiresSecondary ? byId(this.secondarySelect.value) : undefined;

    if (def.requiresSecondary && secondary && secondary.id === primary.id) {
      notify.error('请为合盘选择两个不同的档案');
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
      notify.success(`${chart.meta.typeNameZh} 已生成`);
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
    h('p', {}, '选择参数后点击「生成」查看星盘。'),
  ]);
}
function loadingResult() {
  return h('div', { class: 'empty-state' }, [
    h('div', { class: 'big boot-glyph' }, '✶'),
    h('p', {}, '正在计算星盘…'),
  ]);
}

function pad(n) { return String(n).padStart(2, '0'); }
function defaultDateTimeLocal() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}
