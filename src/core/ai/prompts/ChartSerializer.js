'use strict';

function formatPoint(p) {
  const deg = p.dms ? `${p.dms.degrees}°${String(p.dms.minutes).padStart(2, '0')}′` : `${p.degreeInSign.toFixed(2)}°`;
  const retro = p.retrograde ? ' (逆行)' : '';
  const house = p.house ? ` 第${p.house}宫` : '';
  return `${p.glyph} ${p.nameZh}\t${p.signNameZh} ${deg}${house}${retro}`;
}

function formatAngle(a) {
  if (!a) return '';
  const deg = a.dms ? `${a.dms.degrees}°${String(a.dms.minutes).padStart(2, '0')}′` : `${a.degreeInSign.toFixed(2)}°`;
  return `${a.glyph} ${a.nameZh}: ${a.signNameZh || ''} ${deg}`;
}

function formatAspect(a) {
  const p1 = a.point1 || '?';
  const p2 = a.point2 || '?';
  return `${p1} ${a.glyph}${a.nameZh} ${p2} (容许度 ${a.orb.toFixed(1)}°)`;
}

function formatDistributions(dist) {
  if (!dist) return '';
  const e = dist.elements || {};
  const m = dist.modalities || {};
  const eLine = `元素: 火${e.fire || 0} 土${e.earth || 0} 风${e.air || 0} 水${e.water || 0}`;
  const mLine = `模式: 基本${m.cardinal || 0} 固定${m.fixed || 0} 变动${m.mutable || 0}`;
  return `${eLine}\n${mLine}`;
}

function toText(chartData) {
  if (!chartData) return '(无星盘数据)';
  const lines = [];

  const meta = chartData.meta || {};
  const subjects = (chartData.subjects || [])
    .map((s) => s.nameZh || s.nameEn || '')
    .filter(Boolean)
    .join(' · ');

  lines.push(`【${meta.typeNameZh || meta.type || '星盘'}】${subjects}`);
  if (meta.subtitle) lines.push(meta.subtitle);
  lines.push('');

  const rings = chartData.rings || [];
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    if (rings.length > 1) {
      lines.push(`━━ ${ring.label || (ri === 0 ? '内环' : '外环')} ━━`);
    }

    if (ring.points && ring.points.length) {
      lines.push('── 行星位置 ──');
      for (const p of ring.points) lines.push(formatPoint(p));
      lines.push('');
    }

    if (ring.angles) {
      lines.push('── 四轴 ──');
      for (const key of ['ascendant', 'midheaven', 'descendant', 'imumcoeli']) {
        const a = ring.angles[key];
        if (a) lines.push(formatAngle(a));
      }
      lines.push('');
    }

    if (ring.houses && ring.houses.length) {
      lines.push('── 宫位 ──');
      for (const h of ring.houses) {
        const deg = h.degreeInSign != null ? h.degreeInSign.toFixed(2) : '?';
        lines.push(`第${h.index}宫: ${h.signNameZh || h.signKey || ''} ${deg}°`);
      }
      lines.push('');
    }

    if (ring.distributions) {
      lines.push('── 分布 ──');
      lines.push(formatDistributions(ring.distributions));
      lines.push('');
    }
  }

  if (chartData.aspects && chartData.aspects.length) {
    lines.push('── 主要相位 ──');
    const shown = chartData.aspects.slice(0, 25);
    for (const a of shown) lines.push(formatAspect(a));
    if (chartData.aspects.length > 25) lines.push(`... 及其他 ${chartData.aspects.length - 25} 个相位`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { toText };
