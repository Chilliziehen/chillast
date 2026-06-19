# BaZi Enhancement + Chart UX + sxwnl Feature Expansion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix BaZi pillar interaction, add chart auto-refresh, and unlock 6 new features from the already-imported sxwnl library (festivals, era names, moon phases, 12-hour pillars, solar term calendar, Chinese city picker).

**Architecture:** The adapter layer (`ChineseAstrologyAdapter`) forwards more fields from sxwnl's computed day objects. New renderer components display the additional data. Chart auto-refresh uses `onchange` listeners. The city picker wraps sxwnl's JWv database via a new IPC channel.

**Tech Stack:** CommonJS (core), ES modules (renderer), sxwnl vendor library, CSS custom properties

---

## Task 1: BaZi Pillar Click Interaction

**Files:**
- Modify: `src/renderer/app/components/BaZiChart.js`
- Modify: `src/renderer/app/components/BaZiTables.js`
- Modify: `src/renderer/styles/Components.css`

Currently the four pillars (年柱/月柱/日柱/时柱) are static display. Make them clickable tabs — clicking a pillar highlights it and shows its detailed analysis in the data column.

- [ ] **Step 1: Add click handler and selected state to BaZiChart.js**

Modify `renderBaZiChart` to accept an `onSelect` callback and track the selected pillar:

```js
export function renderBaZiChart(baziData, onSelect) {
  const pillars = PILLAR_ORDER.map((key, i) => {
    const p = baziData.pillars[key];
    const isDayMaster = key === 'day';
    const stemColor = ELEMENT_CSS_VAR[p.stem.element] || 'var(--text-primary)';
    const branchColor = ELEMENT_CSS_VAR[p.branch.element] || 'var(--text-primary)';

    return h('div', {
      class: `bazi-pillar${isDayMaster ? ' is-day-master' : ''}`,
      onclick: () => onSelect && onSelect(key),
      style: { cursor: 'pointer' },
    }, [
      h('div', { class: 'bazi-pillar-label' }, t(PILLAR_LABELS[i])),
      h('div', { class: 'bazi-stem', style: { color: stemColor } }, p.stem.char),
      h('div', { class: 'bazi-yinyang' }, `${t(ELEMENT_KEY_TO_LOCALE[p.stem.element])} ${t(YINYANG_LOCALE[p.stem.yinYang])}`),
      h('div', { class: 'bazi-branch', style: { color: branchColor } }, p.branch.char),
      h('div', { class: 'bazi-yinyang' }, `${t(ELEMENT_KEY_TO_LOCALE[p.branch.element])} ${t(YINYANG_LOCALE[p.branch.yinYang])}`),
      p.branch.animal
        ? h('div', { class: 'bazi-element-tag' }, p.branch.animal)
        : null,
    ]);
  });

  return h('div', { class: 'bazi-chart' }, pillars);
}
```

- [ ] **Step 2: Add `pillarDetailPanel` single-pillar view to BaZiTables.js**

Add a new export `singlePillarPanel(baziData, pillarKey)` that shows detailed info about one selected pillar (stem element, branch element, hidden stems, relationships):

```js
export function singlePillarPanel(baziData, pillarKey) {
  const labelMap = { year: 'chinese.pillarYear', month: 'chinese.pillarMonth', day: 'chinese.pillarDay', hour: 'chinese.pillarHour' };
  const p = baziData.pillars[pillarKey];
  const stemColor = ELEMENT_COLOR[p.stem.element] || '';
  const branchColor = ELEMENT_COLOR[p.branch.element] || '';

  return panel(t(labelMap[pillarKey]) + ' ' + p.full, [
    h('div', { class: 'flex gap-4 items-center mt-2' }, [
      h('div', { style: { fontSize: '48px', fontWeight: '700', color: stemColor } }, p.stem.char),
      h('div', { style: { fontSize: '48px', fontWeight: '700', color: branchColor } }, p.branch.char),
    ]),
    h('table', { class: 'data-table mt-3' }, [
      h('tbody', {}, [
        h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.heavenlyStem')), h('td', {}, `${p.stem.char} — ${t(ELEMENT_KEY_TO_ZH[p.stem.element])} ${t(p.stem.yinYang === 'yang' ? 'chinese.yang' : 'chinese.yin')}`)]),
        h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.earthlyBranch')), h('td', {}, `${p.branch.char} — ${t(ELEMENT_KEY_TO_ZH[p.branch.element])} ${t(p.branch.yinYang === 'yang' ? 'chinese.yang' : 'chinese.yin')}`)]),
        p.branch.animal ? h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.zodiacAnimal')), h('td', {}, p.branch.animal)]) : null,
        pillarKey === 'day' ? h('tr', {}, [h('td', { class: 'text-muted' }, t('chinese.dayMaster')), h('td', { class: 'fw-semibold' }, `${p.stem.char} (${t(ELEMENT_KEY_TO_ZH[p.stem.element])})`)]) : null,
      ]),
    ]),
  ]);
}
```

- [ ] **Step 3: Update ChineseAstrologyView to handle pillar selection**

In `_compute()`, after rendering BaZiChart, wire the `onSelect` callback to re-render the data column with `singlePillarPanel`:

```js
const selectPillar = (key) => {
  mount(this.dataCol, [
    singlePillarPanel(result.bazi, key),
    fiveElementsPanel(result.bazi),
    lunarInfoPanel(result.lunar),
  ]);
};

mount(this.chartCol, h('div', { class: 'p-4' }, [
  renderBaZiChart(result.bazi, selectPillar),
]));
```

Add import of `singlePillarPanel` from BaZiTables.js.

- [ ] **Step 4: Add CSS for pillar hover/selected states**

In Components.css, add after existing `.bazi-pillar` rules:

```css
.bazi-pillar:hover { background: rgba(79, 193, 255, 0.06); }
.bazi-pillar.is-selected { border-color: var(--accent); background: rgba(79, 193, 255, 0.08); }
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add -A && git commit -m "feat: clickable BaZi pillars with detail panel"
```

---

## Task 2: Chart Auto-Refresh + Button Text Change

**Files:**
- Modify: `src/renderer/app/views/ChartWorkbenchView.js`
- Modify: `locale/zh.json`

When user changes profile/type/settings after a chart has been generated, auto-recompute. Button text changes from "✶ 生成" to "✶ 重新生成" after first generation.

- [ ] **Step 1: Add auto-refresh logic to ChartWorkbenchView.js**

Add a `_hasGenerated` flag and attach `onchange` listeners to all selects. In `_draw()`:

```js
this.primarySelect.addEventListener('change', () => this._autoRefresh());
this.secondarySelect.addEventListener('change', () => this._autoRefresh());
this.typeSelect.addEventListener('change', () => { this.state.type = this.typeSelect.value; this._updateOptions(); this._autoRefresh(); });
this.houseSelect.addEventListener('change', () => this._autoRefresh());
this.zodiacSelect.addEventListener('change', () => this._autoRefresh());
```

The existing `onchange` on `typeSelect` should be merged — not replaced — so it still calls `_updateOptions()`.

Add the method:

```js
_autoRefresh() {
  if (this._hasGenerated) this._compute();
}
```

- [ ] **Step 2: Change button text after first generation**

In `_compute()`, after successful chart generation:

```js
this._hasGenerated = true;
if (this.generateBtn) this.generateBtn.textContent = t('chart.regenerate');
```

Store a reference to the generate button:

```js
this.generateBtn = h('button', {
  class: 'btn btn-primary',
  onclick: () => this._compute(),
}, t('chart.generate'));
```

- [ ] **Step 3: Add locale key**

In `locale/zh.json` under `"chart"`:

```json
"regenerate": "✶ 重新生成",
```

- [ ] **Step 4: Handle options auto-refresh**

For date/year/location inputs in `_updateOptions()`, add `onchange`/`oninput` listeners that also call `_autoRefresh()`:

```js
this.dateInput = h('input', { class: 'input', type: 'datetime-local', value: defaultDateTimeLocal(), onchange: () => this._autoRefresh() });
```

Same for `yearInput`, `latInput`, `lngInput`.

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add -A && git commit -m "feat: auto-refresh charts on param change, button text toggles"
```

---

## Task 3: Forward Rich Lunar Data (Festivals, Era, Moon Phase)

**Files:**
- Modify: `src/core/chinese/ChineseAstrologyAdapter.js`
- Modify: `src/renderer/app/components/BaZiTables.js`
- Modify: `locale/zh.json`
- Modify: `tests/RunAll.js`

Forward already-computed fields from the sxwnl day object that the adapter currently ignores.

- [ ] **Step 1: Add failing test**

```js
test('lunar data includes festivals and era name', () => {
  const svc = new (require('../src/core/chinese/ChineseAstrologyService'))();
  const result = svc.computeBaZi({
    birthData: { year: 1990, month: 1, day: 15, hour: 14, minute: 30, location: { label: '北京', latitude: 39.9, longitude: 116.4 } },
  });
  assert.ok(result.lunar.eraName, 'has era name');
  assert.ok(typeof result.lunar.festivals === 'object', 'has festivals');
  assert.ok(typeof result.lunar.moonPhase === 'object', 'has moon phase');
});
```

- [ ] **Step 2: Update `getLunarDate()` in ChineseAstrologyAdapter.js**

Add these fields to the returned object:

```js
getLunarDate(year, month, day) {
  const { Lunar, obb } = this.sxwnl;
  const lun = new Lunar();
  lun.yueLiCalc(year, month);
  const ob = lun.lun[day - 1];

  const c = ob.Lyear + 12000;
  const animalChar = obb.ShX[c % 12];

  return {
    lunarYear: ob.Lyear2,
    lunarMonth: ob.Lmc,
    lunarDay: ob.Ldc,
    isLeapMonth: ob.Lleap === '闰',
    zodiacAnimal: animalChar,
    solarTerm: ob.Ljq || null,
    constellation: ob.XiZ,
    huangdiYear: ob.Lyear4,
    eraName: lun.nianhao || '',
    monthSize: ob.Ldn || 0,
    festivals: {
      major: ob.A || '',
      important: ob.B || '',
      minor: ob.C || '',
      isHoliday: Boolean(ob.Fjia),
    },
    moonPhase: {
      name: ob.yxmc || '',
      time: ob.yxsj || '',
    },
    dayOfWeek: ob.week,
  };
}
```

- [ ] **Step 3: Add festival/era/moon phase panels to BaZiTables.js**

Update `lunarInfoPanel` to display the new fields:

```js
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
  // ...rest of panel rendering
}
```

- [ ] **Step 4: Add locale keys**

```json
"eraName": "年号",
"moonPhase": "月相",
"festival": "节日",
"festivalImportant": "纪念日",
"monthSize": "月大小"
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add -A && git commit -m "feat: forward festivals, era name, moon phase from sxwnl"
```

---

## Task 4: Twelve Hour Pillars Display (十二时辰全表)

**Files:**
- Modify: `src/core/chinese/ChineseAstrologyAdapter.js`
- Create: `src/renderer/app/components/HourPillarsTable.js`
- Modify: `src/renderer/app/views/ChineseAstrologyView.js`
- Modify: `locale/zh.json`

The adapter already parses `ob.bz_JS` (all-hour pillars string) but only strips HTML. Parse it into structured data and render a 12-row table.

- [ ] **Step 1: Improve `_parseHourPillars` in adapter**

```js
_parseHourPillars(raw, currentHourStem) {
  const clean = raw.replace(/<[^>]+>/g, '').trim();
  const pairs = clean.match(/[\u4e00-\u9fff]{2}/g) || [];
  const SHICHEN = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const HOURS = ['23-01','01-03','03-05','05-07','07-09','09-11','11-13','13-15','15-17','17-19','19-21','21-23'];
  return pairs.slice(0, 12).map((gz, i) => ({
    shichen: SHICHEN[i],
    hours: HOURS[i],
    stem: this._parseStem(gz[0]),
    branch: this._parseBranch(gz[1]),
    full: gz,
    isCurrent: gz[0] === currentHourStem,
  }));
}
```

Update `computeBaZi()` to call:

```js
allHourPillars: this._parseHourPillars(ob.bz_JS || '', ob.bz_js[0]),
```

- [ ] **Step 2: Create `HourPillarsTable.js`**

```js
import { h } from '../Dom.js';
import { t } from '../I18n.js';

const ELEMENT_COLOR = {
  wood: 'var(--c-wood)', fire: 'var(--c-fire)', earth: 'var(--c-earth)',
  metal: 'var(--c-metal)', water: 'var(--c-water)',
};

export function hourPillarsPanel(baziData) {
  const hours = baziData.allHourPillars || [];
  if (!hours.length) return null;

  const rows = hours.map((hp) => {
    const stemColor = ELEMENT_COLOR[hp.stem.element] || '';
    const branchColor = ELEMENT_COLOR[hp.branch.element] || '';
    return h('tr', { class: hp.isCurrent ? 'is-current-hour' : '' }, [
      h('td', { class: 'fw-medium' }, `${hp.shichen}时`),
      h('td', { class: 'text-muted' }, hp.hours),
      h('td', { style: { color: stemColor, fontSize: 'var(--fs-lg)' } }, hp.stem.char),
      h('td', { style: { color: branchColor, fontSize: 'var(--fs-lg)' } }, hp.branch.char),
      h('td', {}, hp.full),
    ]);
  });

  return h('div', { class: 'panel' }, [
    h('div', { class: 'panel-header' }, [h('h3', {}, t('chinese.allShichen'))]),
    h('div', { class: 'panel-body' }, [
      h('table', { class: 'data-table' }, [
        h('thead', {}, h('tr', {}, [
          h('th', {}, '时辰'), h('th', {}, '时段'), h('th', {}, '天干'), h('th', {}, '地支'), h('th', {}, '干支'),
        ])),
        h('tbody', {}, rows),
      ]),
    ]),
  ]);
}
```

- [ ] **Step 3: Add to ChineseAstrologyView data column**

Import `hourPillarsPanel` and add it to the data column render:

```js
mount(this.dataCol, [
  dayMasterPanel(result.bazi),
  fiveElementsPanel(result.bazi),
  lunarInfoPanel(result.lunar),
  pillarDetailPanel(result.bazi),
  hourPillarsPanel(result.bazi),
]);
```

- [ ] **Step 4: Add CSS for current-hour highlight**

```css
.is-current-hour td { background: rgba(79, 193, 255, 0.08); font-weight: var(--fw-semibold); }
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add -A && git commit -m "feat: twelve hour pillars (十二时辰) display"
```

---

## Task 5: Solar Term Annual Calendar View (节气年历)

**Files:**
- Create: `src/core/chinese/SolarTermCalendar.js`
- Create: `src/renderer/app/components/SolarTermCalendar.js`
- Modify: `src/core/chinese/ChineseAstrologyService.js`
- Modify: `src/main/IpcRouter.js`
- Modify: `src/preload/Preload.js`
- Modify: `src/renderer/app/ApiClient.js`
- Modify: `src/renderer/app/views/ChineseAstrologyView.js`
- Modify: `locale/zh.json`
- Modify: `tests/RunAll.js`

Build a visual calendar showing all 24 solar terms for a given year with precise times, plus lunar month boundaries.

- [ ] **Step 1: Create `src/core/chinese/SolarTermCalendar.js`**

```js
'use strict';

const sxwnl = require('./SxwnlLoader');

function getSolarTermCalendar(year) {
  const { Lunar, SSQ, JD, J2000, obb } = sxwnl;
  const lun = new Lunar();
  const terms = [];

  for (let month = 1; month <= 12; month++) {
    lun.yueLiCalc(year, month);
    for (let d = 0; d < lun.dn; d++) {
      const ob = lun.lun[d];
      if (ob.jqmc) {
        terms.push({
          name: ob.jqmc,
          date: `${year}-${String(month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`,
          time: ob.jqsj || '',
          lunarDate: `${ob.Lmc}月${ob.Ldc}`,
          isLeapMonth: ob.Lleap === '闰',
        });
      }
    }
  }

  const lunarMonths = [];
  lun.yueLiCalc(year, 1);
  const lunarYear = lun.Ly;
  const zodiac = lun.ShX;

  return { year, terms, lunarYear, zodiac };
}

module.exports = { getSolarTermCalendar };
```

- [ ] **Step 2: Add to service + IPC pipeline**

In `ChineseAstrologyService.js`:

```js
getSolarTermCalendar(year) {
  const { getSolarTermCalendar } = require('./SolarTermCalendar');
  return getSolarTermCalendar(year);
}
```

In `IpcRouter.js`, add channel:

```js
this._handle('chinese:solarTerms', (_e, year) => this.chineseService.getSolarTermCalendar(year));
```

In `Preload.js` and `ApiClient.js`, add:

```js
getSolarTerms: (year) => invoke('chinese:solarTerms', year),
```

```js
getSolarTerms: (year) => unwrap(api.chinese.getSolarTerms(year)),
```

- [ ] **Step 3: Create renderer component `SolarTermCalendar.js`**

Renders a table with 24 rows (one per solar term) showing name, date, time, and lunar date:

```js
import { h } from '../Dom.js';
import { t } from '../I18n.js';

export function renderSolarTermCalendar(data) {
  const rows = data.terms.map((term) =>
    h('tr', {}, [
      h('td', { class: 'fw-medium' }, term.name),
      h('td', {}, term.date),
      h('td', { class: 'text-muted' }, term.time),
      h('td', { class: 'text-muted' }, term.lunarDate),
    ])
  );

  return h('div', {}, [
    h('div', { class: 'mb-3' }, [
      h('span', { class: 'chip' }, `${data.lunarYear}`),
      h('span', { class: 'chip ml-2' }, `${data.zodiac}年`),
    ]),
    h('table', { class: 'data-table' }, [
      h('thead', {}, h('tr', {}, [
        h('th', {}, '节气'), h('th', {}, '公历'), h('th', {}, '时间'), h('th', {}, '农历'),
      ])),
      h('tbody', {}, rows),
    ]),
  ]);
}
```

- [ ] **Step 4: Add year selector tab to ChineseAstrologyView**

Add a tab strip at the top of the workbench bar to switch between "八字排盘" and "节气年历" modes. When in calendar mode, show a year input + the solar term table.

- [ ] **Step 5: Add locale keys + test + commit**

```json
"solarTermCalendar": "节气年历",
"solarTermDate": "公历日期",
"solarTermTime": "精确时间"
```

```bash
npm test
git add -A && git commit -m "feat: solar term annual calendar with 24 terms"
```

---

## Task 6: Chinese City Picker from JWv Database

**Files:**
- Create: `src/core/chinese/ChineseCityDatabase.js`
- Modify: `src/main/IpcRouter.js`
- Modify: `src/preload/Preload.js`
- Modify: `src/renderer/app/ApiClient.js`
- Modify: `src/renderer/app/components/CityPicker.js`
- Modify: `tests/RunAll.js`

sxwnl includes `JWv` with 2500+ Chinese cities. Create a search endpoint and integrate it into the existing CityPicker.

- [ ] **Step 1: Create `ChineseCityDatabase.js`**

```js
'use strict';

const sxwnl = require('./SxwnlLoader');

function searchChineseCities(query) {
  const { JWv, JWdecode } = sxwnl;
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 1) return [];

  const results = [];
  for (const entry of JWv) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const province = entry[0];
    for (let i = 1; i < entry.length; i++) {
      const raw = entry[i];
      if (typeof raw !== 'string') continue;
      const code = raw.substring(0, 4);
      const name = raw.substring(4);
      if (!name.toLowerCase().includes(q) && !province.toLowerCase().includes(q)) continue;
      try {
        const jw = new JWdecode(code);
        results.push({
          nameZh: name,
          province,
          latitude: +(jw.W * 180 / Math.PI).toFixed(4),
          longitude: +(jw.J * 180 / Math.PI).toFixed(4),
        });
      } catch (_) {}
      if (results.length >= 30) return results;
    }
  }
  return results;
}

module.exports = { searchChineseCities };
```

- [ ] **Step 2: Add IPC channel**

In `IpcRouter.js`:

```js
this._handle('chinese:searchCities', (_e, query) => {
  const { searchChineseCities } = require('../core/chinese/ChineseCityDatabase');
  return searchChineseCities(query);
});
```

Add to Preload/ApiClient:

```js
searchChineseCities: (query) => invoke('chinese:searchCities', query),
```

```js
searchChineseCities: (query) => unwrap(api.chinese.searchChineseCities(query)),
```

- [ ] **Step 3: Integrate into CityPicker.js**

In `_onSearch()`, merge results from both the existing `ApiClient.searchCities()` and the new `ApiClient.chinese.searchChineseCities()`:

```js
async _onSearch() {
  const query = this.labelInput.value.trim();
  try {
    const [western, chinese] = await Promise.all([
      ApiClient.searchCities(query),
      ApiClient.chinese.searchChineseCities(query).catch(() => []),
    ]);
    const merged = [...chinese.map((c) => ({ ...c, nameEn: c.province, country: 'CN' })), ...western];
    const seen = new Set();
    const unique = merged.filter((c) => {
      const key = `${c.latitude.toFixed(2)},${c.longitude.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this._renderList(unique);
  } catch (_) { this._closeList(); }
}
```

- [ ] **Step 4: Add test**

```js
test('chinese city search returns results', () => {
  const { searchChineseCities } = require('../src/core/chinese/ChineseCityDatabase');
  const results = searchChineseCities('北京');
  assert.ok(results.length > 0, 'found cities');
  assert.ok(results[0].latitude > 30, 'has valid latitude');
  assert.ok(results[0].longitude > 100, 'has valid longitude');
});
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add -A && git commit -m "feat: Chinese city picker from sxwnl JWv database (2500+ cities)"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

- [ ] **Step 2: Manual verification with `npm start`**

Verify:
1. BaZi pillars are clickable, show detail on click
2. Star chart auto-refreshes when profile/type changes
3. Button text changes to "✶ 重新生成" after first generation
4. Lunar info shows festivals, era name, moon phase
5. 十二时辰全表 renders below pillar detail
6. 节气年历 tab shows 24 solar terms
7. City picker shows sxwnl Chinese cities in results

- [ ] **Step 3: Commit and push**

```bash
git add -A && git commit -m "chore: BaZi enhancement + chart UX complete"
git push
```
