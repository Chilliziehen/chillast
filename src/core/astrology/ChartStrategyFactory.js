'use strict';

const HoroscopeAdapter = require('./HoroscopeAdapter');
const AspectEngine = require('./AspectEngine');

const NatalChartStrategy = require('./strategies/NatalChartStrategy');
const TransitChartStrategy = require('./strategies/TransitChartStrategy');
const ProgressedChartStrategy = require('./strategies/ProgressedChartStrategy');
const SolarReturnChartStrategy = require('./strategies/SolarReturnChartStrategy');
const LunarReturnChartStrategy = require('./strategies/LunarReturnChartStrategy');
const SynastryChartStrategy = require('./strategies/SynastryChartStrategy');
const CompositeChartStrategy = require('./strategies/CompositeChartStrategy');
const DavisonChartStrategy = require('./strategies/DavisonChartStrategy');
const TertiaryProgressedChartStrategy = require('./strategies/TertiaryProgressedChartStrategy');
const SolarArcChartStrategy = require('./strategies/SolarArcChartStrategy');
const FirdariaChartStrategy = require('./strategies/FirdariaChartStrategy');
const ProfectionChartStrategy = require('./strategies/ProfectionChartStrategy');
const RelocationChartStrategy = require('./strategies/RelocationChartStrategy');

/**
 * ChartStrategyFactory — Factory pattern that maps a chart-type token to a fully
 * wired strategy instance. It owns the dependency wiring (adapter + aspect engine
 * classes) so neither the strategies nor their callers need to know how
 * collaborators are constructed. Strategies are stateless, so instances are
 * memoised and reused.
 */
class ChartStrategyFactory {
  constructor(deps = { HoroscopeAdapter, AspectEngine }) {
    this.deps = deps;
    this.registry = {
      natal: NatalChartStrategy,
      transit: TransitChartStrategy,
      progressed: ProgressedChartStrategy,
      solarReturn: SolarReturnChartStrategy,
      lunarReturn: LunarReturnChartStrategy,
      synastry: SynastryChartStrategy,
      composite: CompositeChartStrategy,
      davison: DavisonChartStrategy,
      tertiaryProgressed: TertiaryProgressedChartStrategy,
      solarArc: SolarArcChartStrategy,
      firdaria: FirdariaChartStrategy,
      profection: ProfectionChartStrategy,
      relocation: RelocationChartStrategy,
    };
    this._cache = new Map();
  }

  /** @returns {string[]} the supported chart-type tokens. */
  supportedTypes() {
    return Object.keys(this.registry);
  }

  /**
   * @param {string} type Chart-type token.
   * @returns {ChartStrategy}
   * @throws {Error} for an unknown type.
   */
  create(type) {
    const StrategyClass = this.registry[type];
    if (!StrategyClass) {
      throw new Error(`未知的星盘类型: ${type}`);
    }
    if (!this._cache.has(type)) {
      this._cache.set(type, new StrategyClass(this.deps));
    }
    return this._cache.get(type);
  }
}

module.exports = ChartStrategyFactory;
