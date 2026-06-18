'use strict';

const ChartStrategy = require('./ChartStrategy');

/**
 * DavisonChartStrategy — the Davison relationship chart (戴维森时空中点盘). Unlike a
 * composite, this is a *real* chart cast for the midpoint in both time and space
 * between the two births, so it has genuine houses and planetary motion.
 */
class DavisonChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, secondary, settings } = request;
    if (!secondary) throw new Error('戴维森盘需要两个档案');

    const adapter = this._adapter(settings);
    const frameA = this._castNatal(primary, settings);
    const frameB = this._castNatal(secondary, settings);

    const midInstant = new Date(
      (new Date(frameA.instantUtc).getTime() + new Date(frameB.instantUtc).getTime()) / 2,
    );
    const locA = primary.birthData.location;
    const locB = secondary.birthData.location;
    const midPlace = {
      latitude: (locA.latitude + locB.latitude) / 2,
      longitude: this._midLongitude(locA.longitude, locB.longitude),
    };

    const frame = adapter.castFromInstant(midInstant, midPlace);
    const points = this._enrichPoints(frame);

    return this._assemble({
      meta: {
        type: 'davison',
        typeNameZh: '时空盘',
        title: `${primary.nameZh || ''} ⊕ ${secondary.nameZh || ''}`,
        subtitle: `时空中点盘 · Davison @ ${midInstant.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: frame.instantUtc,
      },
      subjects: [
        this._subjectDescriptor(primary, 'primary'),
        this._subjectDescriptor(secondary, 'secondary'),
      ],
      houses: this.chartData.enrichHouses(frame.houses),
      angles: this.chartData.enrichAngles(frame.angles),
      rings: [{ id: 'davison', role: 'composite', label: '戴维森', points }],
      aspects: this._intraAspects(points, settings),
    });
  }

  /** Geographic-longitude midpoint using a circular mean, returned in [-180,180). */
  _midLongitude(lngA, lngB) {
    const mid = this.angleMath.midpoint(lngA, lngB); // 0..360
    return mid > 180 ? mid - 360 : mid;
  }
}

module.exports = DavisonChartStrategy;
