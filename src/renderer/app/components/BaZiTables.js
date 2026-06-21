import { h } from '../Dom.js';
import { t } from '../I18n.js';

const ELEMENT_COLOR = {
  wood: 'var(--c-wood)', fire: 'var(--c-fire)', earth: 'var(--c-earth)',
  metal: 'var(--c-metal)', water: 'var(--c-water)',
};

const ELEMENT_KEY_TO_ZH = {
  wood: 'chinese.elementWood', fire: 'chinese.elementFire', earth: 'chinese.elementEarth',
  metal: 'chinese.elementMetal', water: 'chinese.elementWater',
};

function panel(title, body) {
  return h('div', { class: 'panel' }, [
    h('div', { class: 'panel-header' }, [h('h3', {}, title)]),
    h('div', { class: 'panel-body' }, body),
  ]);
}

function bar(label, count, total, color) {
  const pct = Math.round((count / total) * 100);
  return h('div', { class: 'dist-row' }, [
    h('span', { style: { fontSize: '13px' } }, label),
    h('div', { class: 'dist-bar' }, [h('span', { style: { width: `${pct}%`, background: color } })]),
    h('span', { class: 'text-muted', style: { fontSize: '12px', textAlign: 'right' } }, String(count)),
  ]);
}

export function fiveElementsPanel(baziData) {
  const counts = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  for (const key of ['year', 'month', 'day', 'hour']) {
    const p = baziData.pillars[key];
    if (counts[p.stem.element] != null) counts[p.stem.element]++;
    if (counts[p.branch.element] != null) counts[p.branch.element]++;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const bars = Object.entries(counts).map(([key, count]) =>
    bar(t(ELEMENT_KEY_TO_ZH[key]), count, total, ELEMENT_COLOR[key]));

  return panel(t('chinese.fiveElementsDist'), bars);
}

const PILLAR_LABEL_KEY = {
  year: 'chinese.pillarYear', month: 'chinese.pillarMonth',
  day: 'chinese.pillarDay', hour: 'chinese.pillarHour',
};

export function tenGodsPanel(analysis) {
  if (!analysis || !analysis.pillars) return h('div');

  const header = h('tr', {}, [
    h('th', { style: { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 'var(--fw-normal)' } }, t('chinese.colPillar')),
    h('th', { style: { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 'var(--fw-normal)' } }, t('chinese.colStem')),
    h('th', { style: { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 'var(--fw-normal)' } }, t('chinese.colBranch')),
    h('th', { style: { textAlign: 'left', color: 'var(--text-muted)', fontWeight: 'var(--fw-normal)' } }, t('chinese.colHidden')),
  ]);

  const rows = analysis.pillars.map((p) => h('tr', {}, [
    h('td', { style: { color: 'var(--text-muted)', padding: '4px 0' } }, t(PILLAR_LABEL_KEY[p.key] || '')),
    h('td', { style: { padding: '4px 0' } }, [
      h('span', { style: { color: ELEMENT_COLOR[p.stemElement] || 'var(--text-primary)', fontWeight: 'var(--fw-semibold)' } }, p.stemChar),
      h('span', { class: 'text-muted', style: { marginLeft: '6px', fontSize: '12px' } }, p.stemTenGod),
    ]),
    h('td', { style: { padding: '4px 0' } }, [
      h('span', { style: { color: ELEMENT_COLOR[p.branchElement] || 'var(--text-primary)' } }, p.branchChar),
      p.branchAnimal ? h('span', { class: 'text-muted', style: { marginLeft: '4px', fontSize: '12px' } }, p.branchAnimal) : null,
    ]),
    h('td', { style: { fontSize: '12px', padding: '4px 0' } }, p.hidden.map((hs) =>
      h('span', { style: { marginRight: '8px', whiteSpace: 'nowrap' } }, [
        h('span', { style: { color: ELEMENT_COLOR[hs.element] || 'var(--text-primary)' } }, hs.char),
        hs.tenGod ? h('span', { class: 'text-muted' }, `·${hs.tenGod}`) : null,
      ]))),
  ]));

  const table = h('table', { style: { width: '100%', fontSize: '13px', borderCollapse: 'collapse' } }, [
    h('thead', {}, header),
    h('tbody', {}, rows),
  ]);

  const s = analysis.strength;
  const strength = h('div', { class: 'text-muted', style: { marginTop: '10px', fontSize: '12px' } },
    t('chinese.dayMasterStrength', { label: s.label, n: s.supportive, total: s.total }));

  return panel(t('chinese.tenGodsTitle'), [table, strength]);
}

export function dayMasterPanel(baziData) {
  const dm = baziData.dayMaster;
  const color = ELEMENT_COLOR[dm.element] || 'var(--text-primary)';
  const elementZh = t(ELEMENT_KEY_TO_ZH[dm.element]);

  return panel(t('chinese.dayMasterAnalysis'), [
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } }, [
      h('div', {
        style: {
          fontSize: '36px', fontWeight: '700', color,
          width: '64px', height: '64px', display: 'grid', placeItems: 'center',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
          border: '2px solid ' + color,
        },
      }, dm.char),
      h('div', {}, [
        h('div', { style: { fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-semibold)' } },
          t('chinese.dayMasterIs', { element: elementZh })),
        h('div', { class: 'text-muted', style: { marginTop: '4px' } },
          `${t('chinese.dayMaster')}: ${dm.char} (${elementZh})`),
      ]),
    ]),
  ]);
}

export function lunarInfoPanel(lunarData) {
  const rows = [
    [t('chinese.lunarBirthday'), `${lunarData.lunarYear}年 ${lunarData.lunarMonth}月 ${lunarData.lunarDay}`],
    [t('chinese.zodiacAnimal'), lunarData.zodiacAnimal],
    [t('chinese.huangdiYear'), String(lunarData.huangdiYear)],
  ];
  if (lunarData.eraName) rows.push([t('chinese.eraName'), lunarData.eraName]);
  if (lunarData.solarTerm) rows.push([t('chinese.solarTerm'), lunarData.solarTerm]);
  if (lunarData.moonPhase && lunarData.moonPhase.name) {
    rows.push([t('chinese.moonPhase'), `${lunarData.moonPhase.name} ${lunarData.moonPhase.time}`]);
  }
  if (lunarData.festivals && lunarData.festivals.major) {
    rows.push([t('chinese.festival'), lunarData.festivals.major]);
  }
  if (lunarData.festivals && lunarData.festivals.important) {
    rows.push([t('chinese.festivalImportant'), lunarData.festivals.important]);
  }

  const tableRows = rows.map(([label, value]) =>
    h('tr', {}, [
      h('td', { style: { color: 'var(--text-muted)', width: '100px' } }, label),
      h('td', {}, value),
    ]));

  return panel(t('chinese.lunarTitle'), [
    h('table', { class: 'data-table' }, [h('tbody', {}, tableRows)]),
  ]);
}

export function pillarDetailPanel(baziData) {
  const pillarKeys = ['year', 'month', 'day', 'hour'];
  const labelKeys = ['chinese.pillarYear', 'chinese.pillarMonth', 'chinese.pillarDay', 'chinese.pillarHour'];

  const rows = pillarKeys.map((key, i) => {
    const p = baziData.pillars[key];
    const stemColor = ELEMENT_COLOR[p.stem.element] || '';
    const branchColor = ELEMENT_COLOR[p.branch.element] || '';
    return h('tr', {}, [
      h('td', { style: { fontWeight: 'var(--fw-semibold)' } }, t(labelKeys[i])),
      h('td', { style: { color: stemColor, fontSize: 'var(--fs-lg)' } }, p.stem.char),
      h('td', { style: { color: branchColor, fontSize: 'var(--fs-lg)' } }, p.branch.char),
      h('td', {}, p.full),
      h('td', {}, `${t(ELEMENT_KEY_TO_ZH[p.stem.element])}/${t(ELEMENT_KEY_TO_ZH[p.branch.element])}`),
    ]);
  });

  return panel(t('chinese.pillarDetail'), [
    h('table', { class: 'data-table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', {}, ''),
        h('th', {}, t('chinese.heavenlyStem')),
        h('th', {}, t('chinese.earthlyBranch')),
        h('th', {}, '干支'),
        h('th', {}, t('chinese.fiveElements')),
      ])),
      h('tbody', {}, rows),
    ]),
  ]);
}

export function singlePillarPanel(baziData, pillarKey) {
  const labelMap = { year: 'chinese.pillarYear', month: 'chinese.pillarMonth', day: 'chinese.pillarDay', hour: 'chinese.pillarHour' };
  const p = baziData.pillars[pillarKey];
  const stemColor = ELEMENT_COLOR[p.stem.element] || '';
  const branchColor = ELEMENT_COLOR[p.branch.element] || '';

  const rows = [
    h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.heavenlyStem')), h('td', {}, `${p.stem.char} — ${t(ELEMENT_KEY_TO_ZH[p.stem.element])} ${t(p.stem.yinYang === 'yang' ? 'chinese.yang' : 'chinese.yin')}`)]),
    h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.earthlyBranch')), h('td', {}, `${p.branch.char} — ${t(ELEMENT_KEY_TO_ZH[p.branch.element])} ${t(p.branch.yinYang === 'yang' ? 'chinese.yang' : 'chinese.yin')}`)]),
  ];
  if (p.branch.animal) {
    rows.push(h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.zodiacAnimal')), h('td', {}, p.branch.animal)]));
  }
  if (pillarKey === 'day') {
    rows.push(h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.dayMaster')), h('td', { class: 'fw-semibold' }, `${p.stem.char} (${t(ELEMENT_KEY_TO_ZH[p.stem.element])})`)]));
  }

  return panel(t(labelMap[pillarKey]) + ' ' + p.full, [
    h('div', { style: { display: 'flex', gap: 'var(--sp-6)', alignItems: 'center', marginBottom: 'var(--sp-3)' } }, [
      h('div', { style: { fontSize: '48px', fontWeight: '700', color: stemColor } }, p.stem.char),
      h('div', { style: { fontSize: '48px', fontWeight: '700', color: branchColor } }, p.branch.char),
    ]),
    h('table', { class: 'data-table' }, [h('tbody', {}, rows)]),
  ]);
}
