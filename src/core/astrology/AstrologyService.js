'use strict';

const ChartStrategyFactory = require('./ChartStrategyFactory');
const Profile = require('../models/Profile');
const {
  ZODIAC_SIGNS, CELESTIAL_POINTS, ASPECTS, ELEMENTS, MODALITIES, HOUSE_SYSTEMS,
} = require('./Constants');

/**
 * Catalogue of chart types exposed to the UI. `requiresSecondary` drives whether
 * a second profile must be chosen; `options` lists the extra inputs each type
 * understands so the renderer can render the right controls generically.
 */
const CHART_TYPES = [
  { type: 'natal', nameZh: '本命盘', nameEn: 'Natal', category: 'personal', requiresSecondary: false, options: [] },
  { type: 'transit', nameZh: '行运盘', nameEn: 'Transit', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'progressed', nameZh: '二次推运', nameEn: 'Progressed', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'solarReturn', nameZh: '太阳返照', nameEn: 'Solar Return', category: 'personal', requiresSecondary: false, options: ['year'] },
  { type: 'lunarReturn', nameZh: '月亮返照', nameEn: 'Lunar Return', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'tertiaryProgressed', nameZh: '三限', nameEn: 'Tertiary Progressed', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'solarArc', nameZh: '太阳弧', nameEn: 'Solar Arc', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'firdaria', nameZh: '法达盘', nameEn: 'Firdaria', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'profection', nameZh: '小限盘', nameEn: 'Profection', category: 'personal', requiresSecondary: false, options: ['targetDate'] },
  { type: 'relocation', nameZh: '重置盘', nameEn: 'Relocation', category: 'personal', requiresSecondary: false, options: ['location'] },
  { type: 'synastry', nameZh: '比较盘', nameEn: 'Synastry', category: 'relationship', requiresSecondary: true, options: [] },
  { type: 'composite', nameZh: '组合中点盘', nameEn: 'Composite', category: 'relationship', requiresSecondary: true, options: [] },
  { type: 'davison', nameZh: '戴维森盘', nameEn: 'Davison', category: 'relationship', requiresSecondary: true, options: [] },
];

/**
 * AstrologyService — Facade over the whole astrology engine. It is the single
 * entry point the application (IPC layer) talks to. Responsibilities:
 *   • validate and normalise the incoming request
 *   • select the appropriate strategy via the factory
 *   • return a plain, serialisable ChartData DTO
 *   • surface static reference data and the chart-type catalogue
 */
class AstrologyService {
  constructor(factory = new ChartStrategyFactory()) {
    this.factory = factory;
  }

  /** @returns {Array} the chart-type catalogue (copied). */
  chartTypes() {
    return CHART_TYPES.map((t) => ({ ...t }));
  }

  /** @returns {object} immutable reference data for the renderer. */
  referenceData() {
    return {
      signs: ZODIAC_SIGNS,
      points: CELESTIAL_POINTS,
      aspects: ASPECTS,
      elements: ELEMENTS,
      modalities: MODALITIES,
      houseSystems: HOUSE_SYSTEMS,
      chartTypes: this.chartTypes(),
    };
  }

  /**
   * Compute a chart.
   *
   * @param {object} request
   * @param {string} request.type One of the catalogue tokens.
   * @param {object} request.primary Profile JSON (required).
   * @param {object} [request.secondary] Profile JSON (relationship charts).
   * @param {object} [request.settings] { houseSystem, zodiac, aspects }.
   * @param {object} [request.options]  Type-specific options.
   * @returns {object} ChartData DTO.
   */
  computeChart(request) {
    const definition = CHART_TYPES.find((t) => t.type === request.type);
    if (!definition) throw new Error(`未知的星盘类型: ${request.type}`);

    const primary = this._normalizeSubject(request.primary, '主体档案');
    const secondary = definition.requiresSecondary
      ? this._normalizeSubject(request.secondary, '次体档案')
      : (request.secondary ? this._normalizeSubject(request.secondary, '次体档案') : null);

    const strategy = this.factory.create(request.type);
    return strategy.build({
      type: request.type,
      primary,
      secondary,
      settings: request.settings || {},
      options: request.options || {},
    });
  }

  /** Validate a subject and return an enriched, frozen plain object. */
  _normalizeSubject(raw, label) {
    if (!raw) throw new Error(`${label}不能为空`);
    const profile = Profile.fromJSON(raw);
    const errors = profile.validate();
    if (errors.length) {
      throw new Error(`${label}数据有误: ${errors.join('；')}`);
    }
    return { ...profile.toJSON(), displayName: profile.displayName };
  }
}

module.exports = AstrologyService;
module.exports.CHART_TYPES = CHART_TYPES;
