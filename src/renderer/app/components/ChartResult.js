import { h, mount, clear } from '../Dom.js';
import { ChartWheel, PLANET_COLOR, ASPECT_TYPE_COLOR } from './ChartWheel.js';
import { positionsPanel, aspectsPanel, distributionsPanel } from './ChartTables.js';
import { notify } from './Toast.js';

const SVG_SIZE = 740;

const RING_LEGEND = {
  primary: '本命 / 主体', secondary: '次体', transit: '行运',
  progressed: '推运', composite: '组合', tertiary: '三限',
  solarArc: '太阳弧', profection: '小限', relocation: '重置',
};

export function renderChartResult(chartContainer, dataContainer, chart, reference, chartConfig) {
  const svgSize = (chartConfig && chartConfig.svgSize) || SVG_SIZE;
  const wheel = new ChartWheel(reference, chartConfig);

  const svgHost = h('div', { class: 'chart-svg-host' });
  wheel.render(svgHost, chart);

  const detailPopup = h('div', { class: 'planet-detail hidden' });

  const resetBtn = h('button', {
    class: 'btn btn-sm btn-ghost chart-overlay-btn',
    onclick: (e) => { e.stopPropagation(); resetView(); },
  }, '重置视图');

  const canvasWrap = h('div', { class: 'chart-canvas-wrap' }, [
    svgHost, detailPopup, resetBtn,
  ]);

  let vbX = 0, vbY = 0, vbW = svgSize, vbH = svgSize;
  let svgEl = svgHost.querySelector('svg');

  function applyViewBox() {
    if (!svgEl) svgEl = svgHost.querySelector('svg');
    if (svgEl) svgEl.setAttribute('viewBox', `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`);
  }

  function resetView() {
    vbX = 0; vbY = 0; vbW = svgSize; vbH = svgSize;
    applyViewBox();
  }

  canvasWrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 0.92;
    const rect = canvasWrap.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const newW = Math.min(svgSize * 2, Math.max(svgSize * 0.15, vbW * factor));
    const newH = Math.min(svgSize * 2, Math.max(svgSize * 0.15, vbH * factor));
    vbX += (vbW - newW) * mx;
    vbY += (vbH - newH) * my;
    vbW = newW;
    vbH = newH;
    applyViewBox();
  }, { passive: false });

  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;

  canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if ((t.closest && t.closest('.chart-overlay-btn')) || resetBtn.contains(t)) return;
    canvasWrap.setPointerCapture(e.pointerId);
    dragging = true;
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasWrap.style.cursor = 'grabbing';
  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = canvasWrap.getBoundingClientRect();
    const dx = (e.clientX - lastX) / rect.width * vbW;
    const dy = (e.clientY - lastY) / rect.height * vbH;
    if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2) dragMoved = true;
    vbX -= dx;
    vbY -= dy;
    lastX = e.clientX;
    lastY = e.clientY;
    applyViewBox();
  });

  canvasWrap.addEventListener('pointerup', (e) => {
    canvasWrap.releasePointerCapture(e.pointerId);
    dragging = false;
    canvasWrap.style.cursor = '';
  });

  canvasWrap.addEventListener('click', (e) => {
    if (dragMoved) { dragMoved = false; return; }
    const g = e.target.closest('[data-planet-key]');
    if (g) {
      showPlanetDetail(detailPopup, g.dataset.planetKey, chart, reference);
    } else {
      detailPopup.classList.add('hidden');
    }
  });

  const legend = h('div', { class: 'row wrap mt-2', style: { gap: '10px', fontSize: '11px', justifyContent: 'center' } }, [
    legendDot(ASPECT_TYPE_COLOR.conjunction, '合'),
    legendDot(ASPECT_TYPE_COLOR.opposition, '冲'),
    legendDot(ASPECT_TYPE_COLOR.trine, '拱'),
    legendDot(ASPECT_TYPE_COLOR.square, '刑'),
    legendDot(ASPECT_TYPE_COLOR.sextile, '六合'),
    legendDot(ASPECT_TYPE_COLOR.quincunx, '梅花'),
    ...(chart.rings.length > 1 ? [legendDot('#4fc1ff', '外环')] : []),
  ]);

  const exportBtn = h('button', { class: 'btn btn-sm btn-ghost', onclick: () => exportSvg(svgHost, chart) }, '导出 SVG');

  const titleRow = h('div', { class: 'chart-title-row' }, [
    h('div', {}, [
      h('h2', {}, chart.meta.title),
      h('div', { class: 'sub' }, chart.meta.subtitle),
    ]),
    h('div', { class: 'row', style: { gap: '8px' } }, [exportBtn]),
  ]);

  const subjectsLine = (chart.subjects || []).map((s) => h('span', { class: 'chip' }, [
    h('span', { class: 'glyph' }, s.role === 'secondary' ? '☽' : '☉'),
    `${s.nameZh || s.nameEn || '—'} · ${s.birthLabel}`,
  ]));

  const settingChips = h('div', { class: 'row wrap', style: { gap: '8px' } }, [
    h('span', { class: 'chip' }, chart.meta.typeNameZh),
    h('span', { class: 'chip' }, `宫制 ${chart.meta.settings.houseSystem}`),
    h('span', { class: 'chip' }, `黄道 ${chart.meta.settings.zodiac}`),
  ]);

  const chartNode = h('div', {}, [
    titleRow,
    h('div', { class: 'row wrap mt-2', style: { gap: '8px' } }, subjectsLine),
    h('div', { class: 'mt-2' }, settingChips),
    h('div', { class: 'mt-3' }, [canvasWrap, legend]),
  ]);

  mount(chartContainer, chartNode);

  const dataNode = h('div', {}, [
    positionsPanel(chart, reference),
    distributionsPanel(chart, reference),
    aspectsPanel(chart, reference),
  ]);
  mount(dataContainer, dataNode);
}

function showPlanetDetail(popup, key, chart, reference) {
  const meta = reference.points[key];
  if (!meta) return;

  let pointData = null;
  for (const ring of chart.rings) {
    const found = ring.points.find((p) => p.key === key);
    if (found) { pointData = found; break; }
  }
  if (!pointData) return;

  const related = (chart.aspects || []).filter(
    (a) => a.point1 === key || a.point2 === key,
  );

  const pColor = PLANET_COLOR[key] || '#d4d4d4';

  const aspectRows = related.slice(0, 10).map((a) => {
    const otherKey = a.point1 === key ? a.point2 : a.point1;
    const otherMeta = reference.points[otherKey];
    const otherName = otherMeta ? otherMeta.nameZh : otherKey;
    const dotColor = ASPECT_TYPE_COLOR[a.aspectKey] || '#555';
    return h('div', { style: { fontSize: '12px', padding: '2px 0', display: 'flex', gap: '6px', alignItems: 'center' } }, [
      h('span', { class: 'aspect-dot', style: { background: dotColor } }),
      `${otherName} ${a.nameZh} ${a.orb.toFixed(1)}°`,
    ]);
  });

  const content = h('div', {}, [
    h('div', { class: 'row between' }, [
      h('h3', { style: { color: pColor, fontSize: '14px' } }, `${meta.nameZh} ${meta.nameEn}`),
      h('button', {
        class: 'btn btn-sm btn-ghost',
        style: { padding: '2px 8px', fontSize: '14px', border: 'none' },
        onclick: () => popup.classList.add('hidden'),
      }, '×'),
    ]),
    h('div', { class: 'mt-2', style: { fontSize: '13px', lineHeight: '1.7' } }, [
      h('div', {}, `${pointData.signGlyph} ${pointData.signNameZh} ${pointData.dms.degrees}°${String(pointData.dms.minutes).padStart(2, '0')}′`),
      pointData.house ? h('div', {}, `第 ${pointData.house} 宫`) : null,
      pointData.retrograde ? h('div', { class: 'retro' }, '℞ 逆行中') : null,
    ]),
    related.length ? h('div', { class: 'mt-2' }, [
      h('div', { class: 'text-muted', style: { fontSize: '10px', marginBottom: '4px', letterSpacing: '0.08em' } }, `相位 (${related.length})`),
      ...aspectRows,
    ]) : null,
  ]);

  clear(popup);
  popup.appendChild(content);
  popup.classList.remove('hidden');
}

function legendDot(color, label) {
  return h('span', { class: 'row', style: { gap: '5px' } }, [
    h('span', { class: 'aspect-dot', style: { background: color } }), label,
  ]);
}

function exportSvg(svgHost, chart) {
  const svg = svgHost.querySelector('svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute('viewBox', `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(chart.meta.title || 'chart').replace(/[^\w一-龥-]+/g, '_')}.svg`;
  a.click();
  URL.revokeObjectURL(url);
  notify.success('已导出 SVG');
}
