'use strict';

const ChartStrategy = require('./ChartStrategy');

/** Mean tropical year in days — the "day-for-a-year" key of secondary progression. */
const TROPICAL_YEAR_DAYS = 365.2422;
const MS_PER_DAY = 86400000;

/**
 * ProgressedChartStrategy — secondary progressions (二次推运). Symbolically, each
 * day after birth corresponds to one year of life: the progressed moment is
 * `birth + elapsedYears` days. Inner ring = natal, outer ring = progressed, with
 * cross aspects between them.
 */
class ProgressedChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, settings, options = {} } = request;
    const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();

    const natalFrame = this._castNatal(primary, settings);
    const natalPoints = this._enrichPoints(natalFrame);

    const birthMs = new Date(natalFrame.instantUtc).getTime();
    const elapsedYears = (targetDate.getTime() - birthMs) / (TROPICAL_YEAR_DAYS * MS_PER_DAY);
    const progressedMs = birthMs + elapsedYears * MS_PER_DAY;

    const place = primary.birthData.location;
    const progressedFrame = this._adapter(settings).castFromInstant(new Date(progressedMs), {
      latitude: place.latitude,
      longitude: place.longitude,
    });
    const progressedPoints = this._enrichPoints(progressedFrame);

    return this._assemble({
      meta: {
        type: 'progressed',
        typeNameZh: '次限',
        title: `${primary.nameZh || primary.nameEn || ''} · 次限`,
        subtitle: `次限推运 · Secondary Progressions @ ${this._fmt(targetDate)}`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: progressedFrame.instantUtc,
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(natalFrame.houses),
      angles: this.chartData.enrichAngles(natalFrame.angles),
      rings: [
        { id: 'natal', role: 'primary', label: '本命', points: natalPoints },
        { id: 'progressed', role: 'progressed', label: '推运', points: progressedPoints },
      ],
      aspects: this._crossAspects(natalPoints, progressedPoints, settings),
    });
  }

  _fmt(date) {
    return date.toISOString().slice(0, 10);
  }
}

module.exports = ProgressedChartStrategy;
