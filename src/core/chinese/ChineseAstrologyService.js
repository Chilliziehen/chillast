'use strict';

const sxwnl = require('./SxwnlLoader');
const ChineseAstrologyAdapter = require('./ChineseAstrologyAdapter');
const { analyze } = require('./BaZiAnalysis');
const {
  HEAVENLY_STEMS, EARTHLY_BRANCHES, FIVE_ELEMENTS, ZODIAC_ANIMALS,
} = require('./ChineseAstrologyConstants');

class ChineseAstrologyService {
  constructor() {
    this.adapter = new ChineseAstrologyAdapter(sxwnl);
  }

  referenceData() {
    return {
      stems: HEAVENLY_STEMS,
      branches: EARTHLY_BRANCHES,
      elements: FIVE_ELEMENTS,
      animals: ZODIAC_ANIMALS,
    };
  }

  computeBaZi(profileData) {
    const bd = profileData.birthData;
    if (!bd) throw new Error('缺少出生数据');
    if (!bd.location || bd.location.longitude == null) {
      throw new Error('缺少出生地经度，无法计算真太阳时');
    }

    const bazi = this.adapter.computeBaZi(bd, bd.location.longitude);
    const lunar = this.adapter.getLunarDate(bd.year, bd.month, bd.day);
    const analysis = analyze(bazi);

    return { bazi, lunar, analysis };
  }
}

module.exports = ChineseAstrologyService;
