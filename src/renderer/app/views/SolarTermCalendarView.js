import { h, mount } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { renderSolarTermCalendar } from '../components/SolarTermCalendar.js';
import { notify } from '../components/Toast.js';
import { t } from '../I18n.js';

export class SolarTermCalendarView {
  constructor(context) {
    this.ctx = context;
  }

  get title() {
    return { h1: t('tools.solarTermTitle'), sub: t('tools.solarTermSub') };
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  _draw() {
    this.yearInput = h('input', {
      class: 'input', type: 'number', min: 1, max: 3000,
      value: new Date().getFullYear(), style: { width: '100px' },
    });
    this.resultHost = h('div', { class: 'p-4' }, [
      h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '◇'),
        h('p', {}, t('tools.solarTermEmpty')),
      ]),
    ]);

    const wrap = h('div', { class: 'workbench-wrap' }, [
      h('div', { class: 'workbench-bar' }, [
        labeled(t('chart.returnYear'), this.yearInput),
        h('button', { class: 'btn btn-primary', onclick: () => this._compute() }, t('tools.solarTermGenerate')),
      ]),
      this.resultHost,
    ]);

    mount(this.container, wrap);
  }

  async _compute() {
    const year = Number(this.yearInput.value);
    if (!year || year < 1 || year > 3000) return;

    mount(this.resultHost, h('div', { class: 'empty-state' }, [
      h('div', { class: 'big boot-glyph' }, '◇'),
      h('p', {}, t('tools.solarTermLoading')),
    ]));

    try {
      const data = await ApiClient.chinese.getSolarTerms(year);
      mount(this.resultHost, h('div', { class: 'p-4' }, [
        renderSolarTermCalendar(data),
      ]));
    } catch (err) {
      mount(this.resultHost, h('div', { class: 'empty-state' }, [
        h('div', { class: 'big' }, '⚠'),
        h('p', {}, err.message),
      ]));
      notify.error(err.message);
    }
  }
}

function labeled(text, control) {
  return h('div', { class: 'flex-col gap-half' }, [
    h('span', { class: 'fs-2xs text-muted ls-normal' }, text),
    control,
  ]);
}
