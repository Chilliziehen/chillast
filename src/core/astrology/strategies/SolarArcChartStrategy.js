'use strict';

const ChartStrategy = require('./ChartStrategy');

const TROPICAL_YEAR_DAYS = 365.2422;
const MS_PER_DAY = 86400000;

class SolarArcChartStrategy extends ChartStrategy {
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

    const natalSun = natalFrame.points.find((p) => p.key === 'sun');
    const progressedSun = progressedFrame.points.find((p) => p.key === 'sun');
    const arc = this.angleMath.normalize(progressedSun.longitude - natalSun.longitude);

    const arcPoints = natalFrame.points.map((p) => {
      const longitude = this.angleMath.normalize(p.longitude + arc);
      return {
        key: p.key,
        kind: p.kind,
        longitude,
        signIndex: this.angleMath.signIndex(longitude),
        degreeInSign: this.angleMath.degreeInSign(longitude),
        retrograde: false,
        house: p.house,
      };
    });
    const enrichedArcPoints = arcPoints.map((p) => this.chartData.enrichPoint(p));

    return this._assemble({
      meta: {
        type: 'solarArc',
        typeNameZh: '太阳弧',
        title: `${primary.nameZh || primary.nameEn || ''} · 太阳弧`,
        subtitle: `太阳弧推向 · Solar Arc @ ${this._fmt(targetDate)} (arc ${arc.toFixed(2)}°)`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: null,
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(natalFrame.houses),
      angles: this.chartData.enrichAngles(natalFrame.angles),
      rings: [
        { id: 'natal', role: 'primary', label: '本命', points: natalPoints },
        { id: 'solarArc', role: 'progressed', label: '太阳弧', points: enrichedArcPoints },
      ],
      aspects: this._crossAspects(natalPoints, enrichedArcPoints, settings),
    });
  }

  _fmt(date) {
    return date.toISOString().slice(0, 10);
  }
}

module.exports = SolarArcChartStrategy;
