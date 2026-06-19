// CityPicker.js — an autocomplete combo for birth places backed by the offline
// gazetteer (via ApiClient.searchCities). Selecting a city fills label + lat/lng;
// users may also type a custom place name and enter coordinates manually.

import { h, mount } from '../Dom.js';
import { ApiClient } from '../ApiClient.js';
import { t } from '../I18n.js';

export class CityPicker {
  /**
   * @param {object} opts
   * @param {object} [opts.value] initial { label, latitude, longitude }.
   * @param {Function} [opts.onChange] called with the current location object.
   */
  constructor(opts = {}) {
    this.value = opts.value || { label: '', latitude: '', longitude: '' };
    this.onChange = opts.onChange || (() => {});
    this._activeIndex = -1;
    this._build();
  }

  get element() { return this.root; }

  getValue() {
    return {
      label: this.labelInput.value.trim(),
      latitude: parseFloat(this.latInput.value),
      longitude: parseFloat(this.lngInput.value),
    };
  }

  _build() {
    this.labelInput = h('input', {
      class: 'input', placeholder: t('form.citySearch'), value: this.value.label || '',
      oninput: () => this._onSearch(),
      onfocus: () => this._onSearch(),
      onblur: () => setTimeout(() => this._closeList(), 150),
      onkeydown: (e) => this._onKey(e),
    });
    this.listEl = h('div', { class: 'combo-list', style: { display: 'none' } });
    const combo = h('div', { class: 'combo' }, [this.labelInput, this.listEl]);

    this.latInput = h('input', {
      class: 'input', type: 'number', step: '0.0001', placeholder: t('form.latPlaceholder'),
      value: this.value.latitude ?? '', oninput: () => this._emit(),
    });
    this.lngInput = h('input', {
      class: 'input', type: 'number', step: '0.0001', placeholder: t('form.lngPlaceholder'),
      value: this.value.longitude ?? '', oninput: () => this._emit(),
    });

    this.root = h('div', { class: 'field col-span' }, [
      h('label', {}, t('form.birthPlace')),
      combo,
      h('div', { class: 'row mt-2', style: { gap: '8px' } }, [this.latInput, this.lngInput]),
    ]);
  }

  async _onSearch() {
    const query = this.labelInput.value.trim();
    try {
      const [western, chinese] = await Promise.all([
        ApiClient.searchCities(query),
        ApiClient.chinese.searchCities(query).catch(() => []),
      ]);
      const merged = [
        ...chinese.map((c) => ({ ...c, nameEn: c.province, country: 'CN' })),
        ...western,
      ];
      const seen = new Set();
      const unique = merged.filter((c) => {
        const key = `${c.latitude.toFixed(1)},${c.longitude.toFixed(1)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      this._renderList(unique);
    } catch (_) { this._closeList(); }
  }

  _renderList(cities) {
    if (!cities.length) { this._closeList(); return; }
    this._activeIndex = -1;
    this._currentList = cities;
    const options = cities.map((c, i) => h('div', {
      class: 'combo-option', dataset: { index: String(i) },
      onmousedown: (e) => { e.preventDefault(); this._select(c); },
    }, [
      h('span', {}, `${c.nameZh} · ${c.nameEn}`),
      h('span', { class: 'meta' }, `${c.country} ${c.latitude.toFixed(2)}, ${c.longitude.toFixed(2)}`),
    ]));
    mount(this.listEl, options);
    this.listEl.style.display = 'block';
  }

  _onKey(e) {
    if (this.listEl.style.display === 'none' || !this._currentList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (e.key === 'Enter' && this._activeIndex >= 0) {
      e.preventDefault(); this._select(this._currentList[this._activeIndex]);
    } else if (e.key === 'Escape') { this._closeList(); }
  }

  _move(delta) {
    const opts = [...this.listEl.children];
    this._activeIndex = Math.max(0, Math.min(opts.length - 1, this._activeIndex + delta));
    opts.forEach((o, i) => o.classList.toggle('is-active', i === this._activeIndex));
  }

  _select(city) {
    this.labelInput.value = `${city.nameZh} ${city.nameEn}`;
    this.latInput.value = city.latitude;
    this.lngInput.value = city.longitude;
    this._closeList();
    this._emit();
  }

  _closeList() { this.listEl.style.display = 'none'; }

  _emit() { this.onChange(this.getValue()); }
}
