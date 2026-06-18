'use strict';

const ChartStrategy = require('./ChartStrategy');
const { ZODIAC_SIGNS } = require('../Constants');

const TROPICAL_YEAR_DAYS = 365.2422;
const MS_PER_DAY = 86400000;

class ProfectionChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, settings, options = {} } = request;
    const targetDate = options.targetDate ? new Date(options.targetDate) : new Date();

    const frame = this._castNatal(primary, settings);
    const birthMs = new Date(frame.instantUtc).getTime();
    const age = Math.floor((targetDate.getTime() - birthMs) / (TROPICAL_YEAR_DAYS * MS_PER_DAY));

    const ascLongitude = frame.angles.ascendant;
    const profectedAsc = this.angleMath.normalize(ascLongitude + age * 30);
    const profectedSignIndex = this.angleMath.signIndex(profectedAsc);
    const profectedSign = ZODIAC_SIGNS[profectedSignIndex];
    const lordOfYear = profectedSign.ruler;

    const rotation = this.angleMath.normalize(profectedAsc - ascLongitude);

    const rotatedPoints = frame.points.map((p) => {
      const longitude = this.angleMath.normalize(p.longitude + rotation);
      return {
        key: p.key,
        kind: p.kind,
        longitude,
        signIndex: this.angleMath.signIndex(longitude),
        degreeInSign: this.angleMath.degreeInSign(longitude),
        retrograde: p.retrograde,
        house: p.house,
      };
    });
    const enrichedPoints = rotatedPoints.map((p) => this.chartData.enrichPoint(p));

    const rotatedHouses = frame.houses.map((h) => ({
      index: h.index,
      cuspLongitude: this.angleMath.normalize(h.cuspLongitude + rotation),
    })).sort((a, b) => a.index - b.index);

    const rotatedAngles = {};
    for (const key of Object.keys(frame.angles)) {
      rotatedAngles[key] = this.angleMath.normalize(frame.angles[key] + rotation);
    }

    return this._assemble({
      meta: {
        type: 'profection',
        typeNameZh: '小限盘',
        title: `${primary.nameZh || primary.nameEn || ''} · 小限`,
        subtitle: `小限盘 · Profection @ age ${age} — ${profectedSign.nameZh}`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: frame.instantUtc,
        profection: {
          age,
          profectedSign: profectedSign.key,
          profectedSignNameZh: profectedSign.nameZh,
          lordOfYear,
          rotation,
        },
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(rotatedHouses),
      angles: this.chartData.enrichAngles(rotatedAngles),
      rings: [{ id: 'profection', role: 'primary', label: '小限', points: enrichedPoints }],
      aspects: this._intraAspects(enrichedPoints, settings),
    });
  }
}

module.exports = ProfectionChartStrategy;
