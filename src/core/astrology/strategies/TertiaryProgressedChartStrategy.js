'use strict';

const ChartStrategy = require('./ChartStrategy');

const LUNAR_MONTH_DAYS = 27.3216;
const MS_PER_DAY = 86400000;

class TertiaryProgressedChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, settings, options = {} } = request;
    const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();

    const natalFrame = this._castNatal(primary, settings);
    const natalPoints = this._enrichPoints(natalFrame);

    const birthMs = new Date(natalFrame.instantUtc).getTime();
    const elapsedLunarMonths = (targetDate.getTime() - birthMs) / (LUNAR_MONTH_DAYS * MS_PER_DAY);
    const progressedMs = birthMs + elapsedLunarMonths * MS_PER_DAY;

    const place = primary.birthData.location;
    const progressedFrame = this._adapter(settings).castFromInstant(new Date(progressedMs), {
      latitude: place.latitude,
      longitude: place.longitude,
    });
    const progressedPoints = this._enrichPoints(progressedFrame);

    return this._assemble({
      meta: {
        type: 'tertiaryProgressed',
        typeNameZh: '三限',
        title: `${primary.nameZh || primary.nameEn || ''} · 三限`,
        subtitle: `三限推运 · Tertiary Progressions @ ${this._fmt(targetDate)}`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: progressedFrame.instantUtc,
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(natalFrame.houses),
      angles: this.chartData.enrichAngles(natalFrame.angles),
      rings: [
        { id: 'natal', role: 'primary', label: '本命', points: natalPoints },
        { id: 'tertiary', role: 'progressed', label: '三限', points: progressedPoints },
      ],
      aspects: this._crossAspects(natalPoints, progressedPoints, settings),
    });
  }

  _fmt(date) {
    return date.toISOString().slice(0, 10);
  }
}

module.exports = TertiaryProgressedChartStrategy;
