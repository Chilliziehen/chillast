'use strict';

const ChartStrategy = require('./ChartStrategy');

class RelocationChartStrategy extends ChartStrategy {
  build(request) {
    const { primary, settings, options = {} } = request;

    const lat = options.latitude;
    const lng = options.longitude;
    if (lat == null || lng == null) throw new Error('重置盘需要提供新地点的经纬度');

    const natalFrame = this._castNatal(primary, settings);

    const bd = primary.birthData;
    const relocFrame = this._adapter(settings).castFromLocal({
      year: bd.year,
      month: bd.month,
      day: bd.day,
      hour: bd.hour,
      minute: bd.minute,
      latitude: lat,
      longitude: lng,
    });

    const relocPoints = natalFrame.points.map((np) => {
      const rp = relocFrame.points.find((p) => p.key === np.key);
      return {
        key: np.key,
        kind: np.kind,
        longitude: np.longitude,
        signIndex: np.signIndex,
        degreeInSign: np.degreeInSign,
        retrograde: np.retrograde,
        house: rp ? rp.house : np.house,
      };
    });
    const enrichedPoints = relocPoints.map((p) => this.chartData.enrichPoint(p));

    const locationLabel = options.locationLabel || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;

    return this._assemble({
      meta: {
        type: 'relocation',
        typeNameZh: '重置盘',
        title: `${primary.nameZh || primary.nameEn || ''} · 重置`,
        subtitle: `重置盘 · Relocation @ ${locationLabel}`,
        settings: this._chartSettings(settings),
        generatedAt: new Date().toISOString(),
        instantUtc: natalFrame.instantUtc,
      },
      subjects: [this._subjectDescriptor(primary, 'primary')],
      houses: this.chartData.enrichHouses(relocFrame.houses),
      angles: this.chartData.enrichAngles(relocFrame.angles),
      rings: [{ id: 'relocation', role: 'primary', label: '重置', points: enrichedPoints }],
      aspects: this._intraAspects(enrichedPoints, settings),
    });
  }
}

module.exports = RelocationChartStrategy;
