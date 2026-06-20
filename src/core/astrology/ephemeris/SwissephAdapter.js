'use strict';

const tzlookup = require('tz-lookup');
const { DateTime } = require('luxon');
const AngleMath = require('../../util/AngleMath');
const EphemerisAdapter = require('./EphemerisAdapter');
const SwissEphCore = require('./SwissEphCore');
const {
  BODY_IDS, HOUSE_SYSTEM_CODES,
} = require('./SwissEphConstants');

class SwissephAdapter extends EphemerisAdapter {
  castFromLocal(m) {
    const zone = this._resolveZone(m.latitude, m.longitude);
    const local = DateTime.fromObject(
      { year: m.year, month: m.month, day: m.day, hour: m.hour, minute: m.minute },
      { zone },
    );
    const instantUtc = new Date(local.toUTC().toMillis());
    return this._buildFrame(instantUtc, { latitude: m.latitude, longitude: m.longitude });
  }

  castFromInstant(instantUtc, place) {
    return this._buildFrame(instantUtc, place);
  }

  _resolveZone(latitude, longitude) {
    const name = tzlookup(latitude, longitude);
    return name || 'UTC';
  }

  _buildFrame(instantUtc, place) {
    const { latitude, longitude } = place;
    const utc = DateTime.fromJSDate(instantUtc, { zone: 'utc' });
    const hourFraction = utc.hour + utc.minute / 60 + utc.second / 3600;
    const jdUt = SwissEphCore.julDay(utc.year, utc.month, utc.day, hourFraction);

    const hsysCode = this._houseSystemCode();

    const h = SwissEphCore.houses(jdUt, latitude, longitude, hsysCode);
    const cusps = h.house;
    const housesArr = [];
    for (let i = 1; i <= 12; i += 1) {
      housesArr.push({ index: i, cuspLongitude: AngleMath.normalize(cusps[i - 1]) });
    }
    this._lastHouses = housesArr;
    const ascendant = AngleMath.normalize(h.ascendant || h.ascmc[0]);
    const midheaven = AngleMath.normalize(h.mc || h.ascmc[1]);
    const angles = {
      ascendant,
      midheaven,
      descendant: AngleMath.normalize(ascendant + 180),
      imumcoeli: AngleMath.normalize(midheaven + 180),
    };

    const points = [];
    const Constants = require('../Constants');
    const bodyKeys = Constants.DEFAULT_BODY_KEYS;
    const pointKeys = Constants.DEFAULT_POINT_KEYS;
    for (const key of bodyKeys) {
      points.push(this._pointFromCalc(key, jdUt, latitude, longitude, hsysCode));
    }
    for (const key of pointKeys) {
      if (key === 'southnode') {
        const nn = points.find((p) => p.key === 'northnode');
        if (nn) {
          const lon = AngleMath.normalize(nn.longitude + 180);
          points.push(this._assemblePoint('southnode', 'point', lon, false,
            this._houseFor(hsysCode, latitude, longitude, lon)));
        }
        continue;
      }
      points.push(this._pointFromCalc(key, jdUt, latitude, longitude, hsysCode));
    }

    return {
      points,
      houses: housesArr,
      angles,
      instantUtc: instantUtc.toISOString(),
      julianDate: jdUt,
    };
  }

  _pointFromCalc(key, jdUt, latitude, longitude, hsysCode) {
    const Constants = require('../Constants');
    const body = SwissEphCore.calcBody(jdUt, BODY_IDS[key]);
    const lon = AngleMath.normalize(body.longitude);
    const retrograde = body.longitudeSpeed < 0;
    const kind = Constants.DEFAULT_POINT_KEYS.includes(key) ? 'point' : 'body';
    return this._assemblePoint(key, kind, lon, retrograde,
      this._houseFor(hsysCode, latitude, longitude, lon));
  }

  _assemblePoint(key, kind, longitude, retrograde, house) {
    return {
      key,
      kind,
      longitude,
      signIndex: AngleMath.signIndex(longitude),
      degreeInSign: AngleMath.degreeInSign(longitude),
      retrograde,
      house,
    };
  }

  _houseFor(hsysCode, latitude, longitude, pointLongitude) {
    const houses = this._lastHouses;
    if (!houses || !houses.length) return null;
    const lon = AngleMath.normalize(pointLongitude);
    for (let i = 0; i < houses.length; i += 1) {
      const start = AngleMath.normalize(houses[i].cuspLongitude);
      const end = AngleMath.normalize(houses[(i + 1) % houses.length].cuspLongitude);
      const span = AngleMath.normalize(end - start);
      const offset = AngleMath.normalize(lon - start);
      if (offset < span || span === 0) return houses[i].index;
    }
    return null;
  }

  _houseSystemCode() {
    return HOUSE_SYSTEM_CODES[this.houseSystem] || 'P';
  }
}

module.exports = SwissephAdapter;
