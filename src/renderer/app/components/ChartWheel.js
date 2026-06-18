// ChartWheel.js — renders a professional astrological wheel as inline SVG.
//
// Structure (outside → inside):
//   1. Dark zodiac band with Chinese sign characters (dividers only within band)
//   2. Degree ticks on inner edge of band
//   3. Planet labels near the band, each with a short leader line pointing INWARD
//      to a dot on the aspect circle
//   4. Aspect lines connecting those dots across the full inner area
//   5. House lines & angle axes from center to zodiac inner edge
//
// All planet groups are wrapped in <g data-planet-key="..."> for click detection.

const SIZE = 740;
const CX = SIZE / 2;
const CY = SIZE / 2;

const R = {
  outerRim: 364,
  zodiacOuter: 356,
  zodiacInner: 305,
  houseOuter: 305,
  houseNumber: 130,
};

const PLANET_RADIUS = {
  single: 256,
  inner: 216,
  outer: 272,
};

const LEADER_LEN = 32;

const PLANET_COLOR = {
  sun:       '#dcdcaa',
  moon:      '#9cdcfe',
  mercury:   '#4ec9b0',
  venus:     '#ce9178',
  mars:      '#f44747',
  jupiter:   '#c586c0',
  saturn:    '#6a9955',
  uranus:    '#569cd6',
  neptune:   '#4fc1ff',
  pluto:     '#d16969',
  chiron:    '#b5cea8',
  northnode: '#9cdcfe',
  southnode: '#808080',
  lilith:    '#c586c0',
};

const PLANET_LABEL = {
  sun: '日', moon: '月', mercury: '水', venus: '金', mars: '火',
  jupiter: '木', saturn: '土', uranus: '天', neptune: '海', pluto: '冥',
  chiron: '凯', northnode: '北', southnode: '南', lilith: '莉',
};

// Each aspect type gets its own distinct color.
const ASPECT_TYPE_COLOR = {
  conjunction:     '#dcdcaa',   // warm yellow
  opposition:      '#f44747',   // red
  trine:           '#4ec9b0',   // teal
  square:          '#d97340',   // orange
  sextile:         '#56b6c2',   // cyan
  quincunx:        '#c586c0',   // purple
  sesquiquadrate:  '#d19a66',   // amber
  semisquare:      '#e06c75',   // rose
  semisextile:     '#98c379',   // green
  quintile:        '#7c7ce0',   // violet
};

const ELEMENT_COLOR = {
  fire: '#ce9178',
  earth: '#6a9955',
  air: '#9cdcfe',
  water: '#4ec9b0',
};

export { PLANET_COLOR, ASPECT_TYPE_COLOR };

export class ChartWheel {
  constructor(reference) {
    this.signs = reference.signs;
  }

  render(container, chart) {
    container.innerHTML = this.toSvg(chart);
  }

  toSvg(chart) {
    const rotation = chart.angles && chart.angles.ascendant
      ? chart.angles.ascendant.longitude : 0;
    const isBiWheel = (chart.rings || []).length > 1;
    const ctx = { rotation, isBiWheel };

    const layers = [
      this._zodiacBand(ctx),
      this._degreeTicks(ctx),
      this._houseLines(chart, ctx),
      this._aspects(chart, ctx),
      this._angleMarkers(chart, ctx),
      this._planetRings(chart, ctx),
    ];

    const svgFont = `<defs><style>text{font-family:'Maple Mono NF CN','Segoe UI',sans-serif}</style></defs>`;
    return `<svg viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg" role="img">${svgFont}${layers.join('')}</svg>`;
  }

  _polar(r, longitude, rotation) {
    const theta = (180 + (longitude - rotation)) * Math.PI / 180;
    return { x: CX + r * Math.cos(theta), y: CY - r * Math.sin(theta) };
  }

  _signShort(longitude) {
    const idx = Math.floor((((longitude % 360) + 360) % 360) / 30);
    return this.signs[idx] ? this.signs[idx].shortZh : '';
  }

  // —— layers ——————————————————————————————————————————————————

  _zodiacBand(ctx) {
    let out = '';
    out += circle(CX, CY, R.outerRim, 'fill:none;stroke:rgba(50,50,50,0.4);stroke-width:0.8');
    out += circle(CX, CY, R.zodiacOuter, 'fill:none;stroke:rgba(55,55,55,0.55);stroke-width:1');
    out += circle(CX, CY, R.zodiacInner, 'fill:none;stroke:rgba(55,55,55,0.40);stroke-width:0.8');

    const signMidR = (R.zodiacInner + R.zodiacOuter) / 2;

    for (let i = 0; i < 12; i += 1) {
      const sign = this.signs[i];
      const a0 = i * 30;
      const a1 = a0 + 30;

      out += this._sector(R.zodiacInner, R.zodiacOuter, a0, a1, ctx.rotation,
        'fill:rgba(10,10,10,0.90);stroke:none');

      const pIn = this._polar(R.zodiacInner, a0, ctx.rotation);
      const pOut = this._polar(R.zodiacOuter, a0, ctx.rotation);
      out += line(pIn.x, pIn.y, pOut.x, pOut.y,
        'stroke:rgba(60,60,60,0.5);stroke-width:0.8');

      const c = this._polar(signMidR, a0 + 15, ctx.rotation);
      const color = ELEMENT_COLOR[sign.element] || '#888';
      out += text(c.x, c.y, sign.shortZh || sign.glyph,
        `fill:${color};font-size:24px;font-weight:400`);
    }
    return out;
  }

  _degreeTicks(ctx) {
    let out = '';
    for (let d = 0; d < 360; d += 5) {
      const long = d % 10 === 0 ? 6 : 3;
      const p1 = this._polar(R.zodiacInner, d, ctx.rotation);
      const p2 = this._polar(R.zodiacInner - long, d, ctx.rotation);
      out += line(p1.x, p1.y, p2.x, p2.y,
        'stroke:rgba(75,75,75,0.25);stroke-width:0.5');
    }
    return out;
  }

  _houseLines(chart, ctx) {
    const houses = chart.houses || [];
    if (!houses.length) return '';
    let out = '';
    for (let i = 0; i < houses.length; i += 1) {
      const cusp = houses[i];
      const isAngle = [1, 4, 7, 10].includes(cusp.index);
      if (!isAngle) {
        const inner = this._polar(6, cusp.cuspLongitude, ctx.rotation);
        const outer = this._polar(R.houseOuter, cusp.cuspLongitude, ctx.rotation);
        out += line(inner.x, inner.y, outer.x, outer.y,
          'stroke:rgba(60,60,60,0.22);stroke-width:0.5');
      }
      const next = houses[(i + 1) % houses.length];
      const mid = midLongitude(cusp.cuspLongitude, next.cuspLongitude);
      const np = this._polar(R.houseNumber, mid, ctx.rotation);
      out += text(np.x, np.y, String(cusp.index),
        'fill:rgba(100,100,100,0.38);font-size:10px;font-weight:400');
    }
    return out;
  }

  _angleMarkers(chart, ctx) {
    const angles = chart.angles || {};
    const labels = {
      ascendant: '升', midheaven: '顶',
      descendant: '降', imumcoeli: '底',
    };
    let out = '';
    for (const [key, label] of Object.entries(labels)) {
      const a = angles[key];
      if (!a) continue;
      const inner = this._polar(5, a.longitude, ctx.rotation);
      const outer = this._polar(R.zodiacOuter, a.longitude, ctx.rotation);
      out += line(inner.x, inner.y, outer.x, outer.y,
        'stroke:rgba(200,200,200,0.45);stroke-width:1.2');
      const lp = this._polar(R.outerRim + 5, a.longitude, ctx.rotation);
      out += text(lp.x, lp.y, label,
        'fill:#4fc1ff;font-size:11px;font-weight:400');
    }
    return out;
  }

  _aspects(chart, ctx) {
    const aspects = chart.aspects || [];
    if (!aspects.length) return '';
    const rings = chart.rings || [];
    const isBiWheel = rings.length > 1;

    const buildMap = (pts, dotR) => {
      const m = new Map();
      for (const p of (pts || [])) m.set(p.key, { lon: p.longitude, dotR });
      return m;
    };

    let map0, map1;
    if (isBiWheel) {
      map0 = buildMap(rings[0].points, PLANET_RADIUS.inner - LEADER_LEN);
      map1 = buildMap(rings[1].points, PLANET_RADIUS.outer - LEADER_LEN);
    } else {
      map0 = buildMap(rings[0] ? rings[0].points : [], PLANET_RADIUS.single - LEADER_LEN);
      map1 = new Map();
    }

    let out = '';
    for (const asp of aspects) {
      const i1 = map0.get(asp.point1) || map1.get(asp.point1);
      const i2 = isBiWheel
        ? (map1.get(asp.point2) || map0.get(asp.point2))
        : (map0.get(asp.point2) || map1.get(asp.point2));
      if (!i1 || !i2) continue;
      const a = this._polar(i1.dotR, i1.lon, ctx.rotation);
      const b = this._polar(i2.dotR, i2.lon, ctx.rotation);
      const color = ASPECT_TYPE_COLOR[asp.aspectKey] || '#555';
      const isMajor = ['conjunction', 'opposition', 'trine', 'square', 'sextile'].includes(asp.aspectKey);
      const opacity = (0.35 + 0.45 * (asp.strength || 0)).toFixed(2);
      const width = isMajor ? 1.2 : 0.6;
      const dash = isMajor ? '' : 'stroke-dasharray:3 3;';
      out += line(a.x, a.y, b.x, b.y,
        `stroke:${color};stroke-width:${width};stroke-opacity:${opacity};${dash}`);
    }
    return out;
  }

  _planetRings(chart, ctx) {
    const rings = chart.rings || [];
    let out = '';
    if (rings.length <= 1) {
      out += this._planets(rings[0] ? rings[0].points : [], PLANET_RADIUS.single, ctx, 'primary');
    } else {
      out += this._planets(rings[0].points, PLANET_RADIUS.inner, ctx, 'inner');
      out += this._planets(rings[1].points, PLANET_RADIUS.outer, ctx, 'outer');
    }
    return out;
  }

  _planets(points, radius, ctx, ringRole) {
    if (!points || !points.length) return '';
    const plotted = points.filter((p) => p.kind === 'body' || p.kind === 'point');
    const display = spreadAngles(plotted.map((p) => p.longitude), 11);
    const dotR = radius - LEADER_LEN;

    let out = '';
    plotted.forEach((p, i) => {
      const pColor = PLANET_COLOR[p.key] || '#d4d4d4';
      const pLabel = PLANET_LABEL[p.key] || p.glyph;
      const dispLong = display[i];
      const glyphPos = this._polar(radius, dispLong, ctx.rotation);
      const dotPos = this._polar(dotR, p.longitude, ctx.rotation);
      const leaderStart = this._polar(radius - 14, dispLong, ctx.rotation);

      out += `<g data-planet-key="${p.key}" data-planet-ring="${ringRole}" style="cursor:pointer">`;

      out += line(leaderStart.x, leaderStart.y, dotPos.x, dotPos.y,
        `stroke:${pColor};stroke-opacity:0.30;stroke-width:0.6`);

      out += `<circle cx="${f(dotPos.x)}" cy="${f(dotPos.y)}" r="2" style="fill:${pColor};opacity:0.70"/>`;

      out += text(glyphPos.x, glyphPos.y, pLabel,
        `fill:${pColor};font-size:20px;font-weight:400`);

      const signChar = this._signShort(p.longitude);
      const degPos = this._polar(radius + 13, dispLong, ctx.rotation);
      const retroMark = p.retrograde ? '℞' : '';
      const degLabel = `${signChar}${Math.floor(p.degreeInSign)}°${retroMark}`;
      out += text(degPos.x, degPos.y, degLabel,
        `fill:${p.retrograde ? '#f44747' : 'rgba(130,130,130,0.60)'};font-size:8.5px;font-weight:400`);

      out += '</g>';
    });
    return out;
  }

  _sector(ri, ro, a0, a1, rotation, style) {
    const p1 = this._polar(ro, a0, rotation);
    const p2 = this._polar(ro, a1, rotation);
    const p3 = this._polar(ri, a1, rotation);
    const p4 = this._polar(ri, a0, rotation);
    const d = [
      `M ${f(p1.x)} ${f(p1.y)}`,
      `A ${ro} ${ro} 0 0 0 ${f(p2.x)} ${f(p2.y)}`,
      `L ${f(p3.x)} ${f(p3.y)}`,
      `A ${ri} ${ri} 0 0 1 ${f(p4.x)} ${f(p4.y)}`,
      'Z',
    ].join(' ');
    return `<path d="${d}" style="${style}"/>`;
  }
}

// —— SVG helpers ——————————————————————————————————————————————————

function f(n) { return n.toFixed(2); }
function circle(cx, cy, r, style) { return `<circle cx="${cx}" cy="${cy}" r="${r}" style="${style}"/>`; }
function line(x1, y1, x2, y2, style) { return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" style="${style}"/>`; }
function text(x, y, content, style) { return `<text x="${f(x)}" y="${f(y)}" text-anchor="middle" dominant-baseline="central" style="${style}">${escapeXml(content)}</text>`; }
function escapeXml(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

function midLongitude(a, b) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return ((a + d / 2) % 360 + 360) % 360;
}

function spreadAngles(longitudes, minSep) {
  const order = longitudes
    .map((lon, idx) => ({ lon: ((lon % 360) + 360) % 360, idx }))
    .sort((a, b) => a.lon - b.lon);
  const disp = order.map((o) => o.lon);
  const n = disp.length;
  if (n > 1) {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < n; i += 1) {
        if (disp[i] - disp[i - 1] < minSep) disp[i] = disp[i - 1] + minSep;
      }
      const wrapGap = disp[0] + 360 - disp[n - 1];
      if (wrapGap < minSep) {
        const shift = (minSep - wrapGap) / 2;
        disp[0] += shift;
        for (let i = 1; i < n; i += 1) {
          if (disp[i] - disp[i - 1] < minSep) disp[i] = disp[i - 1] + minSep;
        }
      }
    }
  }
  const result = new Array(longitudes.length);
  order.forEach((o, i) => { result[o.idx] = disp[i] % 360; });
  return result;
}
