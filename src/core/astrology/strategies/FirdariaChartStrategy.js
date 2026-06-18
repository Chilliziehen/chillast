'use strict';

const ChartStrategy = require('./ChartStrategy');
const FirdariaCalc = require('../FirdariaCalc');

const TROPICAL_YEAR_DAYS = 365.2422;
const MS_PER_DAY = 86400000;

class FirdariaChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, settings, options = {} } = request;
    const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();

    const frame = this._castNatal(primary, settings);
    const points = this._enrichPoints(frame);

    const birthMs = new Date(frame.instantUtc).getTime();
    const age = (targetDate.getTime() - birthMs) / (TROPICAL_YEAR_DAYS * MS_PER_DAY);

    const natalSun = frame.points.find((p) => p.key === 'sun');
    const sect = (natalSun && natalSun.house && natalSun.house <= 6) ? 'night' : 'day';

    const firdaria = FirdariaCalc.activePeriod(age, sect);

    return this._assemble({
      meta: {
        type: 'firdaria',
        typeNameZh: '法达盘',
        title: `${primary.nameZh || primary.nameEn || ''} · 法达`,
        subtitle: `法达盘 · Firdaria @ age ${Math.floor(age)} — ${firdaria.major.ruler}`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: frame.instantUtc,
        firdaria,
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(frame.houses),
      angles: this.chartData.enrichAngles(frame.angles),
      rings: [{ id: 'natal', role: 'primary', label: '本命', points }],
      aspects: this._intraAspects(points, settings),
    });
  }
}

module.exports = FirdariaChartStrategy;
