'use strict';

const sxwnl = require('./SxwnlLoader');

function getSolarTermCalendar(year) {
  const { Lunar } = sxwnl;
  const terms = [];

  for (let month = 1; month <= 12; month++) {
    const lun = new Lunar();
    lun.yueLiCalc(year, month);
    for (let d = 0; d < lun.dn; d++) {
      const ob = lun.lun[d];
      if (ob.jqmc) {
        terms.push({
          name: ob.jqmc,
          date: `${year}-${String(month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`,
          time: ob.jqsj || '',
          lunarDate: `${ob.Lmc}月${ob.Ldc}`,
        });
      }
    }
  }

  const lun = new Lunar();
  lun.yueLiCalc(year, 1);

  return { year, terms, lunarYear: lun.Ly || '', zodiac: lun.ShX || '' };
}

module.exports = { getSolarTermCalendar };
