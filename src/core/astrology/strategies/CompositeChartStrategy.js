'use strict';

const ChartStrategy = require('./ChartStrategy');

/**
 * CompositeChartStrategy — the midpoint composite chart (组合中点盘). It derives a
 * single symbolic chart representing the relationship by taking the circular
 * midpoint of each matching pair of points, angles and house cusps from the two
 * natal charts. No physical instant exists for a composite, so houses are derived
 * from midpoint cusps and bodies are placed into them geometrically.
 */
class CompositeChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, secondary, settings } = request;
    if (!secondary) throw new Error('组合盘需要两个档案');

    const frameA = this._castNatal(primary, settings);
    const frameB = this._castNatal(secondary, settings);

    const compositeHousesRaw = this._midpointHouses(frameA.houses, frameB.houses);
    const compositePointsRaw = this._midpointPoints(frameA.points, frameB.points, compositeHousesRaw);
    const compositeAngles = this._midpointAngles(frameA.angles, frameB.angles);

    const points = compositePointsRaw.map((p) => this.chartData.enrichPoint(p));

    return this._assemble({
      meta: {
        type: 'composite',
        typeNameZh: '组合盘',
        title: `${primary.nameZh || ''} ＋ ${secondary.nameZh || ''}`,
        subtitle: '组合盘 · Composite (Midpoint)',
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: null,
      },
      subjects: [
        this._subjectDescriptor(primary, 'primary'),
        this._subjectDescriptor(secondary, 'secondary'),
      ],
      houses: this.chartData.enrichHouses(compositeHousesRaw),
      angles: this.chartData.enrichAngles(compositeAngles),
      rings: [{ id: 'composite', role: 'composite', label: '组合', points }],
      aspects: this._intraAspects(points, settings),
    });
  }

  /** Circular midpoint of matching house cusps. */
  _midpointHouses(housesA, housesB) {
    const byIndexB = new Map(housesB.map((h) => [h.index, h]));
    return housesA
      .map((a) => {
        const b = byIndexB.get(a.index);
        const cuspLongitude = b
          ? this.angleMath.midpoint(a.cuspLongitude, b.cuspLongitude)
          : a.cuspLongitude;
        return { index: a.index, cuspLongitude };
      })
      .sort((x, y) => x.index - y.index);
  }

  /** Circular midpoint of matching celestial points, re-housed on composite cusps. */
  _midpointPoints(pointsA, pointsB, compositeHouses) {
    const byKeyB = new Map(pointsB.map((p) => [p.key, p]));
    const out = [];
    for (const a of pointsA) {
      const b = byKeyB.get(a.key);
      if (!b) continue;
      const longitude = this.angleMath.midpoint(a.longitude, b.longitude);
      out.push({
        key: a.key,
        kind: a.kind,
        longitude,
        signIndex: this.angleMath.signIndex(longitude),
        degreeInSign: this.angleMath.degreeInSign(longitude),
        retrograde: false, // a composite has no physical motion
        house: this.chartData.houseForLongitude(longitude, compositeHouses),
      });
    }
    return out;
  }

  /** Circular midpoint of the chart angles. */
  _midpointAngles(anglesA, anglesB) {
    const out = {};
    for (const key of Object.keys(anglesA)) {
      out[key] = this.angleMath.midpoint(anglesA[key], anglesB[key]);
    }
    return out;
  }
}

module.exports = CompositeChartStrategy;
