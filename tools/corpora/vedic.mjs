// 印度占星 / 吠陀占星 (Jyotish) corpus.
export default {
  name: '印度占星',
  clean: {
    subject: '印度占星（吠陀占星 Jyotish）书籍',
    preserve: '梵文术语与其中文译名（如 graha 行星、rashi 星座、bhava 宫位、dasha 大运、nakshatra 星宿、yoga 瑜伽），以及九曜、二十七宿名',
    fixHint: '明显错字与被拆断的梵文音译词（如 Vimshottari 被错误切分），并保留原文星盘命例',
  },
  domains: [
    { id: 'grahas', zh: '行星', desc: '九曜（太阳、月亮、火星、水星、木星、金星、土星、罗睺 Rahu、计都 Ketu）的性质、喜忌、庙旺落陷',
      kw: ['行星', '九曜', '罗睺', '计都', 'Rahu', 'Ketu', '太阳', '月亮', '火星', '水星', '木星', '金星', '土星', '庙旺', '落陷', '曜主', 'graha'] },
    { id: 'rashis', zh: '星座', desc: '十二星座（rashi）及其属性、主星',
      kw: ['星座', 'rashi', '白羊', '金牛', '双子', '巨蟹', '狮子', '处女', '天秤', '天蝎', '人马', '射手', '摩羯', '水瓶', '双鱼', '星座主'] },
    { id: 'bhavas', zh: '宫位', desc: '十二宫（bhava）的含义、宫主星与吉凶宫',
      kw: ['宫位', 'bhava', '宫主', '上升', 'Lagna', '第一宫', '第二宫', '第三宫', '第四宫', '第五宫', '第六宫', '第七宫', '第八宫', '第九宫', '第十宫', '第十一宫', '第十二宫', '三方宫', '始宫', '凶宫'] },
    { id: 'nakshatra', zh: '星宿', desc: '二十七星宿（nakshatra）及其主管、象征',
      kw: ['星宿', 'nakshatra', '二十七宿', '宿主', 'pada', '月宿'] },
    { id: 'dasha', zh: '大运', desc: '大运系统（Vimshottari dasha 等）、大运周期与流年推断',
      kw: ['大运', 'dasha', 'Vimshottari', '维姆肖塔里', '周期', 'antardasha', '小限', '运程'] },
    { id: 'yoga', zh: '瑜伽组合', desc: '瑜伽（yoga）组合（Raja yoga、Dhana yoga、Gaja-Kesari 等）的成立与效应',
      kw: ['瑜伽', 'yoga', 'Raja', 'Dhana', 'Kesari', '组合', '富贵组合', '成局'] },
    { id: 'aspects', zh: '相映', desc: '行星相映（drishti）、特殊相映与互映',
      kw: ['相映', 'drishti', '相位', '互映', '特殊相映', '七分相映'] },
  ],
};
