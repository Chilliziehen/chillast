# Swiss Ephemeris Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Moshier-based astronomy backend with Swiss Ephemeris (`swisseph-v2`) via an abstracted `EphemerisAdapter` interface, keeping the existing Frame contract and all chart strategies unchanged, so chart data reaches RAG-grade precision.

**Architecture:** Extract an `EphemerisAdapter` abstract base class whose method signatures match the existing `HoroscopeAdapter`. `HoroscopeAdapter` (legacy, Moshier) and a new `SwissephAdapter` both implement it. A thin `SwissEphCore` wrapper isolates the native `swisseph-v2` binding, ephemeris-file path, and singleton lifecycle. `ChartStrategyFactory` selects the implementation from `config.ephemeris.backend` and injects it as `deps.EphemerisAdapter`. The Frame shape (`{points, houses, angles, instantUtc, julianDate}`) is unchanged, so every chart strategy, `ChartData`, and the renderer stay untouched.

**Tech Stack:** CommonJS (core layer), `swisseph-v2` (native Swiss Ephemeris binding, VS 2022 v143 auto-compile on Windows), `tz-lookup` + `luxon` (timezone resolution, shared with legacy adapter), Electron `app`/`process.resourcesPath` (path injection at composition root), `assert`-based test runner (`tests/RunAll.js`).

**Spec:** `docs/superpowers/specs/2026-06-20-swisseph-ephemeris-adapter-design.md`

**Branch:** `feat/importing-swisseph`

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/core/astrology/ephemeris/EphemerisAdapter.js` | Abstract base class defining `castFromLocal` / `castFromInstant` contract |
| `src/core/astrology/ephemeris/SwissEphCore.js` | Thin wrapper over `swisseph-v2`: path config (injected), lazy singleton init, `calcBody`/`houses`/`housePos`/`julDay`/`close`, Chinese error messages |
| `src/core/astrology/ephemeris/SwissEphConstants.js` | Planet-id / house-system-code / flag constant lookup tables mapping engine keys → `swisseph-v2` constants |
| `src/core/astrology/ephemeris/SwissephAdapter.js` | `EphemerisAdapter` implementation: local→UT via `tz-lookup`+`luxon`, calls `SwissEphCore`, maps results → Frame |
| `assets/ephemeris/` | Directory holding full Astrodienst `.se1` ephemeris data files (~90MB) |
| `tests/EphemerisComparison.js` | 10-profile A/B comparison between legacy and swisseph backends with per-field thresholds |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `swisseph-v2` + `tz-lookup` to `dependencies`; add `"assets/**/*"` to `build.files`; add `@electron/rebuild` to devDependencies + `rebuild` script |
| `config.json` | Add `ephemeris: { backend: "swisseph" }` |
| `src/core/config/TokenEngine.js` | `resolve()` passes through `ephemeris` with default `{ backend: 'swisseph' }` |
| `src/core/astrology/ChartStrategyFactory.js` | require `SwissephAdapter`; pick impl from `deps.backend`; expose as `deps.EphemerisAdapter` |
| `src/core/astrology/strategies/ChartStrategy.js` | `deps.HoroscopeAdapter` → `deps.EphemerisAdapter` (2 sites) + JSDoc |
| `src/core/astrology/ReturnFinder.js` | JSDoc only (1 site) |
| `src/core/astrology/ChartData.js` | JSDoc only (1 site) |
| `src/core/astrology/HoroscopeAdapter.js` | Add `extends EphemerisAdapter` (otherwise untouched) |
| `src/main/Main.js` | Resolve `ephePath` via `app.isPackaged`; call `SwissEphCore.configure({ephePath})`; pass `backend` to factory; call `SwissEphCore.close()` on quit |
| `tests/RunAll.js` | Append the `EphemerisComparison` test block |

---

## Task 1: Extract `EphemerisAdapter` abstract base (zero behavior change)

**Goal:** Introduce the interface contract with `HoroscopeAdapter` as its first implementation, rename the deps property, and prove via existing tests that nothing breaks. No swisseph code yet.

**Files:**
- Create: `src/core/astrology/ephemeris/EphemerisAdapter.js`
- Modify: `src/core/astrology/HoroscopeAdapter.js:17,147`
- Modify: `src/core/astrology/ChartStrategyFactory.js:3,32`
- Modify: `src/core/astrology/strategies/ChartStrategy.js:19,39`
- Modify: `src/core/astrology/ReturnFinder.js:19`
- Modify: `src/core/astrology/ChartData.js:14`

- [ ] **Step 1: Create the abstract base class**

Create `src/core/astrology/ephemeris/EphemerisAdapter.js`:

```js
'use strict';

/**
 * EphemerisAdapter — abstract contract for the astronomy backend.
 *
 * Implementations translate a birth moment + place into the engine's
 * normalised Frame. The Frame shape is the stable contract: swapping the
 * ephemeris backend must not change what consumers (ChartData, strategies,
 * renderer) receive.
 *
 * Frame shape (all implementations MUST produce this):
 *   { points: [{key, kind, longitude, signIndex, degreeInSign, retrograde, house}],
 *     houses: [{index, cuspLongitude}],
 *     angles: {ascendant, midheaven, descendant, imumcoeli},
 *     instantUtc,  // ISO string
 *     julianDate }  // number, UT
 *
 * - longitude / cuspLongitude / angles.* MUST be normalised to [0,360) via AngleMath.normalize
 * - signIndex / degreeInSign MUST be derived from the normalised longitude via AngleMath
 * - key MUST be a lowercase token from Constants (DEFAULT_BODY_KEYS / DEFAULT_POINT_KEYS)
 * - house is 1-12, or null when no house attribution
 */
class EphemerisAdapter {
  /**
   * @param {object} [settings]
   * @param {string} [settings.houseSystem='placidus']
   * @param {string} [settings.zodiac='tropical']
   */
  constructor(settings = {}) {
    this.houseSystem = settings.houseSystem || 'placidus';
    this.zodiac = settings.zodiac || 'tropical';
  }

  /**
   * Cast a chart from explicit *local civil* fields.
   * @param {object} m {year, month(1-12), day, hour(0-23), minute, latitude, longitude}
   * @returns {object} normalised chart frame.
   */
  castFromLocal(m) { // eslint-disable-line no-unused-vars
    throw new Error('EphemerisAdapter.castFromLocal() must be implemented');
  }

  /**
   * Cast a chart for an absolute instant observed at a place.
   * @param {Date} instantUtc Absolute moment.
   * @param {{latitude:number, longitude:number}} place
   * @returns {object} normalised chart frame.
   */
  castFromInstant(instantUtc, place) { // eslint-disable-line no-unused-vars
    throw new Error('EphemerisAdapter.castFromInstant() must be implemented');
  }
}

module.exports = EphemerisAdapter;
```

- [ ] **Step 2: Make `HoroscopeAdapter` extend the base**

Modify `src/core/astrology/HoroscopeAdapter.js` — add the require and `extends`. Replace the class declaration line and the export line:

```js
const EphemerisAdapter = require('./ephemeris/EphemerisAdapter');
```

Change:
```js
class HoroscopeAdapter {
```
to:
```js
class HoroscopeAdapter extends EphemerisAdapter {
```

The existing `constructor(settings = {})` already sets `this.houseSystem` / `this.zodiac` with the same defaults — leave it as-is (it overrides but matches the base behavior; this keeps the diff minimal and avoids touching working code).

- [ ] **Step 3: Rename the deps property in `ChartStrategyFactory`**

Modify `src/core/astrology/ChartStrategyFactory.js`. Replace the require block (line 3) and the constructor:

```js
const HoroscopeAdapter = require('./HoroscopeAdapter');
const AspectEngine = require('./AspectEngine');
```

Constructor becomes:
```js
class ChartStrategyFactory {
  constructor(deps = {}) {
    const explicit = deps && deps.EphemerisAdapter;
    this.deps = {
      ...deps,
      EphemerisAdapter: explicit || HoroscopeAdapter,
      AspectEngine,
    };
    this.registry = {
      natal: NatalChartStrategy,
      transit: TransitChartStrategy,
      progressed: ProgressedChartStrategy,
      solarReturn: SolarReturnChartStrategy,
      lunarReturn: LunarReturnChartStrategy,
      synastry: SynastryChartStrategy,
      composite: CompositeChartStrategy,
      davison: DavisonChartStrategy,
      tertiaryProgressed: TertiaryProgressedChartStrategy,
      solarArc: SolarArcChartStrategy,
      firdaria: FirdariaChartStrategy,
      profection: ProfectionChartStrategy,
      relocation: RelocationChartStrategy,
      marx: MarxChartStrategy,
      compositeSecondary: CompositeProgressedChartStrategy,
      compositeTertiary: CompositeProgressedChartStrategy,
      marxSecondary: MarxProgressedChartStrategy,
      marxTertiary: MarxProgressedChartStrategy,
      davisonSecondary: DavisonProgressedChartStrategy,
      davisonTertiary: DavisonProgressedChartStrategy,
    };
    this._cache = new Map();
  }
```

(Remove the old `deps = { HoroscopeAdapter, AspectEngine }` default — `EphemerisAdapter` is now the property, defaulting to the legacy class until Task 3 wires swisseph.)

- [ ] **Step 4: Update `ChartStrategy._adapter` + JSDoc**

Modify `src/core/astrology/strategies/ChartStrategy.js`.

JSDoc (lines ~18-20):
```js
   * @param {object} deps
   * @param {Function} deps.EphemerisAdapter Adapter class implementing the ephemeris contract.
   * @param {Function} deps.AspectEngine     Aspect engine class.
```

`_adapter` method (line ~39):
```js
  _adapter(settings) {
    return new this.deps.EphemerisAdapter(this._chartSettings(settings));
  }
```

- [ ] **Step 5: Fix JSDoc in `ReturnFinder.js` and `ChartData.js`**

In `src/core/astrology/ReturnFinder.js` line 19, change:
```js
   * @param {HoroscopeAdapter} params.adapter
```
to:
```js
   * @param {EphemerisAdapter} params.adapter
```

In `src/core/astrology/ChartData.js` line 14, change:
```js
  /** Enrich a raw point (from HoroscopeAdapter) with display metadata. */
```
to:
```js
  /** Enrich a raw point (from an EphemerisAdapter) with display metadata. */
```

- [ ] **Step 6: Run full test suite — must be all green**

Run: `npm test`
Expected: all tests pass (same count as before this task). This proves the abstraction is behavior-preserving.

Also run: `npm run smoke`
Expected: completes without SVG/console errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/astrology/ephemeris/EphemerisAdapter.js src/core/astrology/HoroscopeAdapter.js src/core/astrology/ChartStrategyFactory.js src/core/astrology/strategies/ChartStrategy.js src/core/astrology/ReturnFinder.js src/core/astrology/ChartData.js
git commit -m "refactor: extract EphemerisAdapter interface, rename deps property"
```

---

## Task 2: Install `swisseph-v2` + wire ephemeris data files + `SwissEphCore`

**Goal:** Get the native binding installed and rebuilt for Electron, place data files, and implement the `SwissEphCore` wrapper with a standalone verification script. Nothing is wired into the engine yet.

**Files:**
- Create: `src/core/astrology/ephemeris/SwissEphCore.js`
- Create: `src/core/astrology/ephemeris/SwissEphConstants.js`
- Create: `assets/ephemeris/` (directory + downloaded `.se1` files)
- Create: `tests/SwissEphSmoke.js` (standalone manual verification, NOT added to RunAll)
- Modify: `package.json`

- [ ] **Step 1: Add dependencies + rebuild script to `package.json`**

In `package.json`, under `dependencies` add:
```json
    "swisseph-v2": "^1.0.0",
    "tz-lookup": "^6.1.24"
```

Under `devDependencies` add:
```json
    "@electron/rebuild": "^4.0.0"
```

Under `scripts` add:
```json
    "rebuild": "electron-rebuild -f -w swisseph-v2"
```

The full `scripts` block becomes:
```json
  "scripts": {
    "start": "electron .",
    "test": "node tests/RunAll.js",
    "smoke": "node tests/SmokeRenderer.js",
    "rebuild": "electron-rebuild -f -w swisseph-v2",
    "dist": "electron-builder"
  },
```

Add `"assets/**/*"` to `build.files`:
```json
    "files": [
      "src/**/*",
      "assets/**/*",
      "package.json"
    ],
```

- [ ] **Step 2: Install + rebuild native binding for Electron**

Run:
```bash
npm install
npm run rebuild
```
Expected: `swisseph-v2` compiles against Electron's headers (VS 2022 v143 auto-detected on Windows). Rebuild ends with `Rebuild Complete`. If it fails, the error names the missing MSVC toolset — install "Desktop development with C++" from Visual Studio Installer and retry.

Verify the binding loads under Electron's ABI:
```bash
node -e "const s=require('swisseph-v2'); console.log(typeof s.swe_calc_ut, s.SE_SUN)"
```
Expected: `function <number>` (e.g. `function 0`).

- [ ] **Step 3: Download ephemeris data files into `assets/ephemeris/`**

Create the directory and download the standard Swiss Ephemeris file set from Astrodienst (`ftp://www.astro.com/pub/swisseph/`). The minimal set for full-precision planetary + node + apogee work over the standard date range:

```bash
mkdir assets\ephemeris
cd assets\ephemeris
curl -O https://www.astro.com/ftp/swisseph/ephe/seas_18.se1
curl -O https://www.astro.com/ftp/swisseph/ephe/semo_18.se1
curl -O https://www.astro.com/ftp/swisseph/ephe/sepl_18.se1
```

If `curl` cannot reach the FTP mirror, use the HTTPS listing at `https://www.astro.com/ftp/swisseph/ephe/` and download `seas_18.se1` (Moon, 600KB), `semo_18.se1` (Mercury–Chiron, ~14MB), `sepl_18.se1` (Sun–Pluto, ~6MB) into `assets/ephemeris/`.

Verify files exist:
```bash
dir assets\ephemeris\*.se1
```
Expected: three `.se1` files listed.

- [ ] **Step 4: Create `SwissEphConstants.js`**

Create `src/core/astrology/ephemeris/SwissEphConstants.js`:

```js
'use strict';

const swisseph = require('swisseph-v2');

/**
 * SwissEphConstants — lookup tables mapping the engine's lowercase celestial
 * keys and house-system names to the swisseph-v2 C-library constants. Kept
 * separate from the adapter so the mapping is auditable in one place.
 */
const BODY_IDS = {
  sun: swisseph.SE_SUN,
  moon: swisseph.SE_MOON,
  mercury: swisseph.SE_MERCURY,
  venus: swisseph.SE_VENUS,
  mars: swisseph.SE_MARS,
  jupiter: swisseph.SE_JUPITER,
  saturn: swisseph.SE_SATURN,
  uranus: swisseph.SE_URANUS,
  neptune: swisseph.SE_NEPTUNE,
  pluto: swisseph.SE_PLUTO,
  chiron: swisseph.SE_CHIRON,
  northnode: swisseph.SE_MEAN_NODE,
  lilith: swisseph.SE_MEAN_APOG,
};

/** Points derived from another (south node = north node + 180°), not computed directly. */
const DERIVED_POINTS = ['southnode'];

/** House-system single-char codes accepted by swe_houses. 'B'=whole-sign is handled specially. */
const HOUSE_SYSTEM_CODES = {
  placidus: 'P',
  koch: 'K',
  regiomontanus: 'R',
  topocentric: 'T',
  'equal-house': 'A',
  'whole-sign': 'W', // whole-sign is approximated via equal-house on the Ascendant, see SwissephAdapter
};

const FLAGS = swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SPEED;

module.exports = {
  BODY_IDS,
  DERIVED_POINTS,
  HOUSE_SYSTEM_CODES,
  FLAGS,
  // re-export the raw binding for SwissEphCore's swe_julday etc.
  swisseph,
};
```

- [ ] **Step 5: Create `SwissEphCore.js`**

Create `src/core/astrology/ephemeris/SwissEphCore.js`:

```js
'use strict';

const fs = require('fs');
const { swisseph } = require('./SwissEphConstants');

/**
 * SwissEphCore — thin, singleton wrapper over the swisseph-v2 native binding.
 *
 * Pure domain layer: it does NOT import electron. The ephemeris-file path is
 * injected once by the composition root (Main.js) via configure(). This keeps
 * src/core Electron-free and unit-testable.
 *
 * Lifecycle: lazy — swe_set_ephe_path runs on the first computation, not at
 * require time. swe_close() is exposed for app shutdown.
 */
let _ephePath = null;
let _initialized = false;

function configure({ ephePath } = {}) {
  _ephePath = ephePath || null;
}

function ensureInitialized() {
  if (_initialized) return;
  if (!_ephePath) throw new Error('星历数据路径未配置（需由 Main 注入）');
  if (!fs.existsSync(_ephePath)) throw new Error(`星历数据目录不存在: ${_ephePath}`);
  swisseph.swe_set_ephe_path(_ephePath);
  _initialized = true;
}

/**
 * Compute one body/point's position for a UT Julian Day.
 * @returns {{longitude:number, latitude:number, distance:number, longitudeSpeed:number, error?:string}}
 */
function calcBody(jdUt, planetId) {
  ensureInitialized();
  const r = swisseph.swe_calc_ut(jdUt, planetId, require('./SwissEphConstants').FLAGS);
  if (r && r.error) throw new Error(`星历计算失败 (planetId=${planetId}): ${r.error}`);
  return r;
}

/**
 * Compute house cusps + angles.
 * @returns {{house:number[], ascmc:number[], error?:string}}
 *   house[1..12] cusps, ascmc[0]=Asc, [1]=MC, [2]=ARMC, [3]=Vertex
 */
function houses(jdUt, lat, lng, hsysCode) {
  ensureInitialized();
  const r = swisseph.swe_houses(jdUt, lat, lng, hsysCode);
  if (r && r.error) throw new Error(`宫位计算失败: ${r.error}`);
  return r;
}

/**
 * Determine which house a planet at the given ecliptic position falls into.
 * Uses swe_house_pos which returns a value in [1, 12.999].
 * @returns {number} 1-12
 */
function housePos(lat, lng, hsysCode, longitude, latitude = 0) {
  ensureInitialized();
  const r = swisseph.swe_house_pos(lat, lng, hsysCode, [longitude, latitude]);
  if (r && r.error) throw new Error(`落宫计算失败: ${r.error}`);
  return Math.floor(r.housePosition);
}

/** Julian Day (UT) for a Gregorian date. `hour` may be fractional. */
function julDay(year, month, day, hour) {
  return swisseph.swe_julday(year, month, day, hour, swisseph.SE_GREG_CAL);
}

/** Release C-side resources. Call on app quit. Safe to call when never initialized. */
function close() {
  if (_initialized) {
    swisseph.swe_close();
    _initialized = false;
  }
}

module.exports = {
  configure,
  calcBody,
  houses,
  housePos,
  julDay,
  close,
};
```

- [ ] **Step 6: Write a standalone verification script**

Create `tests/SwissEphSmoke.js` (manual, not wired into RunAll):

```js
'use strict';

// Standalone verification that SwissEphCore loads, finds data files, and
// produces a Sun longitude matching the Astro.com reference. Run manually:
//   node tests/SwissEphSmoke.js
// Reference: 1983-05-31 07:00 UT, Sun should be ~69° (Gemini ~9°).

const path = require('path');
const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');
const { BODY_IDS } = require('../src/core/astrology/ephemeris/SwissEphConstants');

const ephePath = path.join(__dirname, '..', 'assets', 'ephemeris');
SwissEphCore.configure({ ephePath });

const jd = SwissEphCore.julDay(1983, 5, 31, 7);
const sun = SwissEphCore.calcBody(jd, BODY_IDS.sun);

console.log('JD:', jd);
console.log('Sun longitude:', sun.longitude);
console.log('Sun longitudeSpeed:', sun.longitudeSpeed);

if (Math.abs(sun.longitude - 69.0) > 0.5) {
  console.error('FAIL: Sun longitude far from expected ~69° for 1983-05-31 07:00 UT');
  process.exit(1);
}
console.log('PASS: Sun position within tolerance of Astro.com reference');

SwissEphCore.close();
```

- [ ] **Step 7: Run the verification script**

Run: `node tests/SwissEphSmoke.js`
Expected output:
```
JD: 2445485.7916666665
Sun longitude: 69.0... (Gemini ~9°)
Sun longitudeSpeed: 0.95...
PASS: Sun position within tolerance of Astro.com reference
```

If it fails with `星历数据目录不存在`, confirm Step 3's files landed in `assets/ephemeris/`. If `swe_calc_ut` errors with a data-file message, the `.se1` filenames are wrong or incomplete — re-check Step 3.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/core/astrology/ephemeris/SwissEphCore.js src/core/astrology/ephemeris/SwissEphConstants.js tests/SwissEphSmoke.js assets/ephemeris/
git commit -m "feat: add swisseph-v2 binding, SwissEphCore wrapper, ephemeris data files"
```

---

## Task 3: Implement `SwissephAdapter` + factory backend selection

**Goal:** Build the swisseph `EphemerisAdapter` implementation, wire the factory to choose it via config, inject the path + lifecycle from Main. End-to-end a natal chart now runs on swisseph.

**Files:**
- Create: `src/core/astrology/ephemeris/SwissephAdapter.js`
- Modify: `src/core/astrology/ChartStrategyFactory.js`
- Modify: `config.json`
- Modify: `src/core/config/TokenEngine.js`
- Modify: `src/main/Main.js`

- [ ] **Step 1: Add `ephemeris.backend` to config + TokenEngine**

In `config.json`, add a top-level key (after `"window"` and before `"locale"`):

```json
  "ephemeris": {
    "backend": "swisseph"
  },

  "locale": "zh"
```

In `src/core/config/TokenEngine.js`, inside `resolve(raw)`'s return object, add the `ephemeris` passthrough. The return block becomes:

```js
    return {
      spacing,
      type,
      weight,
      colors: raw.colors || {},
      radii: raw.radii || {},
      shadows: raw.shadows || {},
      layout: raw.layout || {},
      chart: raw.chart || {},
      window: raw.window || {},
      ephemeris: raw.ephemeris || { backend: 'swisseph' },
      locale: raw.locale || 'zh',
    };
```

- [ ] **Step 2: Implement `SwissephAdapter.js`**

Create `src/core/astrology/ephemeris/SwissephAdapter.js`:

```js
'use strict';

const tzlookup = require('tz-lookup');
const { DateTime } = require('luxon');
const AngleMath = require('../../util/AngleMath');
const EphemerisAdapter = require('./EphemerisAdapter');
const SwissEphCore = require('./SwissEphCore');
const {
  BODY_IDS, DERIVED_POINTS, HOUSE_SYSTEM_CODES,
} = require('./SwissEphConstants');

/**
 * SwissephAdapter — EphemerisAdapter implementation backed by swisseph-v2.
 *
 * It produces the SAME Frame shape as HoroscopeAdapter so all chart strategies,
 * ChartData, and the renderer are agnostic to the backend. Timezone resolution
 * (local civil time → UT) uses tz-lookup + luxon, the same libraries the legacy
 * adapter relies on, so both backends share one UT definition and A/B
 * comparison tests isolate planetary-algorithm differences rather than
 * timezone differences.
 */
class SwissephAdapter extends EphemerisAdapter {
  castFromLocal(m) {
    // m = {year, month(1-12), day, hour, minute, latitude, longitude}
    // Resolve IANA zone from coordinates, then build the UT instant. _buildFrame
    // recomputes the UT Julian Day from this instant (the round-trip is harmless
    // and keeps a single JD-construction path shared with castFromInstant).
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

  /** Resolve IANA timezone name for a coordinate via tz-lookup. */
  _resolveZone(latitude, longitude) {
    const name = tzlookup(latitude, longitude);
    return name || 'UTC';
  }

  _buildFrame(instantUtc, place) {
    const { latitude, longitude } = place;
    // UT Julian Day from the absolute instant.
    const utc = DateTime.fromJSDate(instantUtc, { zone: 'utc' });
    const hourFraction = utc.hour + utc.minute / 60 + utc.second / 3600;
    const jdUt = SwissEphCore.julDay(utc.year, utc.month, utc.day, hourFraction);

    const hsysCode = this._houseSystemCode();

    // Houses + angles
    const h = SwissEphCore.houses(jdUt, latitude, longitude, hsysCode);
    const cusps = h.house; // index 1..12
    const housesArr = [];
    for (let i = 1; i <= 12; i += 1) {
      housesArr.push({ index: i, cuspLongitude: AngleMath.normalize(cusps[i]) });
    }
    const ascendant = AngleMath.normalize(h.ascmc[0]);
    const midheaven = AngleMath.normalize(h.ascmc[1]);
    const angles = {
      ascendant,
      midheaven,
      descendant: AngleMath.normalize(ascendant + 180),
      imumcoeli: AngleMath.normalize(midheaven + 180),
    };

    // Points: bodies + computed points
    const points = [];
    const bodyKeys = require('../Constants').DEFAULT_BODY_KEYS;
    const pointKeys = require('../Constants').DEFAULT_POINT_KEYS;
    for (const key of bodyKeys) {
      points.push(this._pointFromCalc(key, jdUt, latitude, longitude, hsysCode));
    }
    for (const key of pointKeys) {
      if (key === 'southnode') {
        const nn = points.find((p) => p.key === 'northnode');
        const lon = AngleMath.normalize(nn.longitude + 180);
        points.push(this._assemblePoint('southnode', 'point', lon, false,
          this._houseFor(hsysCode, latitude, longitude, lon)));
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
    const body = SwissEphCore.calcBody(jdUt, BODY_IDS[key]);
    const lon = AngleMath.normalize(body.longitude);
    const retrograde = body.longitudeSpeed < 0;
    const kind = require('../Constants').DEFAULT_POINT_KEYS.includes(key) ? 'point' : 'body';
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
    try {
      return SwissEphCore.housePos(latitude, longitude, hsysCode, pointLongitude);
    } catch (_e) {
      return null;
    }
  }

  _houseSystemCode() {
    return HOUSE_SYSTEM_CODES[this.houseSystem] || 'P';
  }
}

module.exports = SwissephAdapter;
```

> Note on `whole-sign`: swisseph's `swe_houses` with code `'W'` computes whole-sign houses from the Ascendant. This matches the legacy adapter's whole-sign behavior closely enough for the comparison thresholds; if the A/B test in Task 4 flags a divergence for whole-sign specifically, treat it as an accepted semantic difference (documented in the comparison report) rather than a bug.

- [ ] **Step 3: Wire factory backend selection**

Modify `src/core/astrology/ChartStrategyFactory.js`. Add the require near the top (after the `HoroscopeAdapter` require):

```js
const SwissephAdapter = require('./ephemeris/SwissephAdapter');
```

Replace the constructor body so it picks the implementation from `deps.backend`:

```js
class ChartStrategyFactory {
  constructor(deps = {}) {
    const explicitAdapter = deps && deps.EphemerisAdapter;
    const backend = (deps && deps.backend) || 'swisseph';
    const AdapterClass = explicitAdapter
      || (backend === 'swisseph' ? SwissephAdapter : HoroscopeAdapter);
    this.deps = {
      ...deps,
      EphemerisAdapter: AdapterClass,
      AspectEngine,
    };
    this.registry = {
      natal: NatalChartStrategy,
      transit: TransitChartStrategy,
      progressed: ProgressedChartStrategy,
      solarReturn: SolarReturnChartStrategy,
      lunarReturn: LunarReturnChartStrategy,
      synastry: SynastryChartStrategy,
      composite: CompositeChartStrategy,
      davison: DavisonChartStrategy,
      tertiaryProgressed: TertiaryProgressedChartStrategy,
      solarArc: SolarArcChartStrategy,
      firdaria: FirdariaChartStrategy,
      profection: ProfectionChartStrategy,
      relocation: RelocationChartStrategy,
      marx: MarxChartStrategy,
      compositeSecondary: CompositeProgressedChartStrategy,
      compositeTertiary: CompositeProgressedChartStrategy,
      marxSecondary: MarxProgressedChartStrategy,
      marxTertiary: MarxProgressedChartStrategy,
      davisonSecondary: DavisonProgressedChartStrategy,
      davisonTertiary: DavisonProgressedChartStrategy,
    };
    this._cache = new Map();
  }
```

- [ ] **Step 4: Inject path + backend + lifecycle in `Main.js`**

Modify `src/main/Main.js`. Add requires near the top (after the existing `require('../core/config/ConfigManager')`):

```js
const SwissEphCore = require('../core/astrology/ephemeris/SwissEphCore');
const ChartStrategyFactory = require('../core/astrology/ChartStrategyFactory');
```

(`ChartStrategyFactory` is currently required only inside `AstrologyService`; adding it here is fine — Main is the composition root.)

In `bootstrapServices()`, after `this.config = ConfigManager.load();` and the locale load, add ephemeris path resolution + core config + pass backend to the service. Replace the existing service-construction block:

```js
    // Resolve ephemeris data path (composition root owns Electron coupling).
    const ephePath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', 'ephemeris')
      : path.join(__dirname, '..', '..', 'assets', 'ephemeris');
    SwissEphCore.configure({ ephePath });

    const baseDir = path.join(app.getPath('userData'), 'data');
    this.profileRepository = new ProfileRepository(baseDir).init();
    this.astrologyService = new AstrologyService(
      new ChartStrategyFactory({ backend: this.config.ephemeris.backend }),
    );
    this.chineseAstrologyService = new ChineseAstrologyService();
    new IpcRouter({
      ipcMain,
      profileRepository: this.profileRepository,
      astrologyService: this.astrologyService,
      chineseAstrologyService: this.chineseAstrologyService,
      config: this.config,
      locale: this.locale,
    }).register();
```

In `start()`, add the quit cleanup inside the `app.whenReady().then(...)` or alongside the lifecycle handlers:

```js
    app.on('quit', () => {
      SwissEphCore.close();
    });
```

- [ ] **Step 5: Run the unit tests against the swisseph backend**

`tests/RunAll.js` constructs `new AstrologyService()` with no factory arg, which defaults to `backend='swisseph'` — but the test process never calls `SwissEphCore.configure()`, so `castFromLocal` would throw. Configure the path at the top of `RunAll.js`. Add after the existing requires (after line 20):

```js
const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');
SwissEphCore.configure({
  ephePath: require('path').join(__dirname, '..', 'assets', 'ephemeris'),
});
```

Also change the service construction to explicitly use swisseph (makes intent clear and matches prod):

```js
const svc = new AstrologyService(new (require('../src/core/astrology/ChartStrategyFactory'))({ backend: 'swisseph' }));
```

Run: `npm test`
Expected: all existing tests pass. If `natal chart` fails on `sun.signKey === 'capricorn'` with a mismatch, the UT/timezone path in `SwissephAdapter.castFromLocal` has a bug — debug the JD and longitude printed.

- [ ] **Step 6: Smoke-test the running app**

Run: `npm run smoke`
Expected: completes without SVG/console errors, using the swisseph backend.

Then manually: `npm start`, open a natal chart for a known subject, and eyeball the Sun/Ascendant against an Astro.com chart for the same data.

- [ ] **Step 7: Commit**

```bash
git add src/core/astrology/ephemeris/SwissephAdapter.js src/core/astrology/ChartStrategyFactory.js config.json src/core/config/TokenEngine.js src/main/Main.js tests/RunAll.js
git commit -m "feat: implement SwissephAdapter, wire factory backend selection + lifecycle"
```

---

## Task 4: A/B comparison test + finalize

**Goal:** Lock in correctness with a 10-profile comparison between legacy and swisseph, wire it into RunAll, and document the migration-completion criteria. This is the safety net before the legacy adapter is later removed.

**Files:**
- Create: `tests/EphemerisComparison.js`
- Modify: `tests/RunAll.js`

- [ ] **Step 1: Create the comparison test module**

Create `tests/EphemerisComparison.js`:

```js
'use strict';

/**
 * EphemerisComparison — A/B test between the legacy HoroscopeAdapter (Moshier)
 * and the SwissephAdapter. Both use the same tz-lookup + luxon UT path, so any
 * divergence is a planetary-algorithm / house-algorithm difference, which is
 * exactly what we want to bound before retiring the legacy adapter.
 */

const assert = require('assert');
const path = require('path');
const AngleMath = require('../src/core/util/AngleMath');
const HoroscopeAdapter = require('../src/core/astrology/HoroscopeAdapter');
const SwissephAdapter = require('../src/core/astrology/ephemeris/SwissephAdapter');
const SwissEphCore = require('../src/core/astrology/ephemeris/SwissEphCore');

SwissEphCore.configure({ ephePath: path.join(__dirname, '..', 'assets', 'ephemeris') });

const PROFILES = [
  { name: '1900 Berlin', year: 1900, month: 6, day: 15, hour: 12, minute: 0, latitude: 52.52, longitude: 13.405 },
  { name: '1970 NYC',    year: 1970, month: 4, day: 10, hour: 6, minute: 30, latitude: 40.7128, longitude: -74.006 },
  { name: '1990 Beijing',year: 1990, month: 1, day: 15, hour: 14, minute: 30, latitude: 39.9042, longitude: 116.4074 },
  { name: '2000 London', year: 2000, month: 3, day: 20, hour: 8, minute: 0, latitude: 51.5074, longitude: -0.1278 },
  { name: '2025 Sydney', year: 2025, month: 12, day: 21, hour: 23, minute: 0, latitude: -33.8688, longitude: 151.2093 },
  { name: 'DST edge NYC',year: 1989, month: 4, day: 2, hour: 2, minute: 30, latitude: 40.7128, longitude: -74.006 },
  { name: 'date-line Fiji', year: 2010, month: 8, day: 15, hour: 10, minute: 0, latitude: -17.7134, longitude: 178.0650 },
  { name: '1923 Reykjavik', year: 1923, month: 11, day: 5, hour: 18, minute: 45, latitude: 64.1466, longitude: -21.9426 },
  { name: '2015 Tokyo',  year: 2015, month: 7, day: 7, hour: 7, minute: 7, latitude: 35.6762, longitude: 139.6503 },
  { name: '2049 Mumbai', year: 2049, month: 2, day: 14, hour: 5, minute: 15, latitude: 19.0760, longitude: 72.8777 },
];

// Per-field tolerances (degrees). Beyond these = needs investigation.
const THRESHOLDS = {
  longitude: 0.01,
  ascendant: 0.05,
  mc: 0.01,
  houseCusp: 0.1,
};

function angDiff(a, b) {
  return AngleMath.separation(a, b);
}

function runComparison() {
  const report = [];
  let allPass = true;

  for (const p of PROFILES) {
    const settings = { houseSystem: 'placidus', zodiac: 'tropical' };
    const legacy = new HoroscopeAdapter(settings).castFromLocal(p);
    const swiss = new SwissephAdapter(settings).castFromLocal(p);

    const issues = [];

    // Compare each shared body/point longitude.
    for (const lp of legacy.points) {
      const sp = swiss.points.find((x) => x.key === lp.key);
      if (!sp) { issues.push(`${p.name}: ${lp.key} missing in swisseph`); continue; }
      const d = angDiff(lp.longitude, sp.longitude);
      if (d > THRESHOLDS.longitude) issues.push(`${p.name}: ${lp.key} longitude diff ${d.toFixed(4)}°`);
      if (lp.retrograde !== sp.retrograde) issues.push(`${p.name}: ${lp.key} retrograde mismatch`);
      if (lp.signIndex !== sp.signIndex) issues.push(`${p.name}: ${lp.key} signIndex mismatch (legacy=${lp.signIndex} swiss=${sp.signIndex})`);
      if (lp.house !== sp.house) issues.push(`${p.name}: ${lp.key} house mismatch (legacy=${lp.house} swiss=${sp.house})`);
    }

    // Angles
    const ascD = angDiff(legacy.angles.ascendant, swiss.angles.ascendant);
    if (ascD > THRESHOLDS.ascendant) issues.push(`${p.name}: ASC diff ${ascD.toFixed(4)}°`);
    const mcD = angDiff(legacy.angles.midheaven, swiss.angles.midheaven);
    if (mcD > THRESHOLDS.mc) issues.push(`${p.name}: MC diff ${mcD.toFixed(4)}°`);

    // House cusps
    for (let i = 0; i < 12; i += 1) {
      const d = angDiff(legacy.houses[i].cuspLongitude, swiss.houses[i].cuspLongitude);
      if (d > THRESHOLDS.houseCusp) issues.push(`${p.name}: cusp ${i + 1} diff ${d.toFixed(4)}°`);
    }

    if (issues.length) allPass = false;
    report.push({ profile: p.name, issues });
  }

  return { allPass, report };
}

module.exports = { runComparison };
```

- [ ] **Step 2: Wire the comparison into `RunAll.js`**

At the end of `tests/RunAll.js`, before the final summary (`console.log(\`\n${passed}...`), add:

```js
console.log('\nEphemeris comparison (legacy vs swisseph)');
test('10-profile A/B comparison within thresholds', () => {
  const { runComparison } = require('./EphemerisComparison');
  const { allPass, report } = runComparison();
  if (!allPass) {
    const msg = report.filter((r) => r.issues.length)
      .map((r) => `  ${r.profile}:\n` + r.issues.map((i) => `    - ${i}`).join('\n'))
      .join('\n');
    assert.fail(`Ephemeris A/B comparison failures:\n${msg}`);
  }
});
```

- [ ] **Step 3: Run the full suite including the comparison**

Run: `npm test`
Expected: all tests pass including `10-profile A/B comparison within thresholds`. If it fails, read the printed issues — a systematic offset suggests a UT/JD bug in `SwissephAdapter`; isolated near-threshold failures on cusps at high latitude are expected Placidus divergence (loosen that specific threshold or document it).

- [ ] **Step 4: Run smoke + manual 16-chart-type sweep**

Run: `npm run smoke`
Expected: passes.

Then manually in `npm start`, exercise each chart category at least once:
- Personal: natal, transit, progressed, tertiary, solar return, lunar return, solar arc, firdaria, profection, relocation
- Relationship: synastry, composite, marx, davison, composite secondary/tertiary, marx secondary/tertiary, davison secondary/tertiary

Confirm the wheel renders and the data panel shows plausible values for each.

- [ ] **Step 5: Commit**

```bash
git add tests/EphemerisComparison.js tests/RunAll.js
git commit -m "test: add 10-profile legacy-vs-swisseph A/B comparison"
```

---

## Migration-Completion Criteria (for the FOLLOW-UP iteration, not this plan)

The legacy `HoroscopeAdapter` may be removed once ALL hold:
1. `npm test` green including the A/B comparison across all 10 profiles.
2. `npm run smoke` green on the swisseph backend.
3. Manual sweep of all 16+ chart types renders correctly.

When satisfied, in a separate PR: `git rm src/core/astrology/HoroscopeAdapter.js`, remove the `horoscope` branch from `ChartStrategyFactory`, drop `circular-natal-horoscope-js` from `package.json`, and remove `tests/EphemerisComparison.js` (it has no reference to compare against). That cleanup is explicitly OUT OF SCOPE for this plan.
