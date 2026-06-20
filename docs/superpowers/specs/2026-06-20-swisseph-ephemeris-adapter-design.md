# Swiss Ephemeris Adapter 设计 · Design

> 日期：2026-06-20
> 分支：`feat/importing-swisseph`
> 状态：待 review

## 0. 背景与动机

当前西方占星引擎的天文计算由 `circular-natal-horoscope-js`（内部 bundle 了 `ephemeris` 包，基于 **Moshier 行星历表**）承担，封装在 `src/core/astrology/HoroscopeAdapter.js`。

**调查结论——当前后端是否完整？**

| 能力 | 现状 |
|---|---|
| 行星/月亮黄经 | ✅ Moshier 历表（JPL DE 级精度，约 1 角秒级） |
| 章动 / 光行差 / 视差 | ✅ 库内已处理 |
| 地心 / 日心 / topocentric | ✅ 支持 |
| 10 大行星 + 凯龙 | ✅ 完整 |
| 时间范围 | ⚠️ Moshier 历表覆盖 **约 1800–2050** |
| 恒星 (fixed stars) | ❌ 未对外暴露 |
| 小行星扩展（除凯龙） | ❌ 不支持 |

对日常星盘（10 行星 + 凯龙 + 交点 + 莉莉丝，时间在 1800–2050 内）当前后端**计算完整、精度专业可接受**。真正缺的是：历史/未来超长时段、恒星、小行星扩展、超高精度档位。

**动机**：目标是做到**精准的西方命理分析**，并向未来 LLM-RAG 提供精准的结构化占星数据。因此要把天文后端换成占星界公认的精度基准 **Swiss Ephemeris**（Astrodienst 出品），作为长期主实现。

**选用的 npm 包**：**`swisseph-v2`**（[`drvinaayaksingh/swisseph`](https://github.com/drvinaayaksingh/swisseph)）。它是原 `mivion/swisseph`（已停止维护）的现代化续作，Node.js ≥16 / VS 2022 v143 自动编译，CommonJS 原生支持（与项目 `"type": "commonjs"` 契合）。API 是 Swiss Ephemeris C 库的直接绑定（`swe_calc_ut` / `swe_houses` / `swe_julday` / `SE_*` / `SEFLG_*`），与本设计的接口映射天然吻合。License 随 Swiss Ephemeris 官方（AGPL-3.0 / 商业双许可——单机桌面自用无合规问题，未来若分发需评估）。

**调查发现**：`Architecture.md` 第 7 节已明确预留了这个扩展点——「更换天文后端仅重写 `HoroscopeAdapter`，保持帧结构不变即可」。本设计正是这句话的忠实落地。

---

## 1. 架构总览

把"天文计算"从 `HoroscopeAdapter` 这个具体类里**抽出来变成一个接口契约** `EphemerisAdapter`，让 swisseph 和旧库都成为它的实现。

```
                         ┌─────────────────────────────────────┐
                         │  AstrologyService (Facade, 不变)      │
                         │   computeChart() → ChartStrategy      │
                         └────────────────┬────────────────────┘
                                          │ 注入 deps.EphemerisAdapter
                                          ▼
                ┌─────────────────────────────────────────────┐
                │  ChartStrategyFactory                        │
                │   按 config.ephemeris.backend 选实现并注入     │
                └────────────────┬────────────────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                      ▼
   ┌─────────────────────┐               ┌──────────────────────┐
   │ EphemerisAdapter     │  ←接口契约→    │  Frame 结构不变        │
   │  (abstract)          │               │  {points,houses,      │
   │  castFromLocal()     │               │   angles,instantUtc,  │
   │  castFromInstant()   │               │   julianDate}         │
   └──────────┬──────────┘               └──────────────────────┘
              │ 实现
   ┌──────────┴───────────────┬──────────────────────────┐
   ▼                          ▼
┌─────────────────┐  ┌──────────────────┐
│ HoroscopeAdapter│  │ SwissephAdapter   │
│ (旧, Moshier)   │  │ (新, C 原版)       │
│ 迁移期保留对照   │  │ 长期主实现         │
└─────────────────┘  └──────────────────┘
                          │
                          ▼
                 ┌────────────────────────┐
                 │ SwissEphCore (薄封装)   │
                 │  require('swisseph')   │
                 │  设置 ephe_path        │
                 │  单例初始化             │
                 └────────────────────────┘
```

**关键设计原则**：

1. **Frame 结构保持不变**（`{ points, houses, angles, instantUtc, julianDate }`）。swisseph 算出来的数据映射回同一个 Frame 形状，`ChartData` 富化层、渲染层、所有 Strategy 全部零改动。**这是降低风险的核心**——Frame 是稳定契约，后端换了但消费者无感。
2. **`EphemerisAdapter` 方法签名完全沿用 `HoroscopeAdapter` 现有的** `castFromLocal(m)` / `castFromInstant(instantUtc, place)`——抽接口对现有调用方零破坏。
3. **接线点收敛在 `ChartStrategyFactory` 与基类 `ChartStrategy._adapter()`**——16+ 个 Strategy 子类零改动（已核实：它们从不直接访问 `deps`，全走基类）。
4. **迁移期双实现并存**，可通过 config 切换；对照测试通过后再删旧库。

---

## 2. `EphemerisAdapter` 接口契约 + Frame 映射

### 2.1 接口契约

新增 `src/core/astrology/ephemeris/EphemerisAdapter.js`：

```js
/**
 * EphemerisAdapter — abstract contract for the astronomy backend.
 * Implementations translate a birth moment + place into the engine's
 * normalised Frame. The Frame shape is the stable contract: swapping the
 * ephemeris backend must not change what consumers (ChartData, strategies,
 * renderer) receive.
 */
class EphemerisAdapter {
  constructor(settings = {}) {
    this.houseSystem = settings.houseSystem || 'placidus';
    this.zodiac = settings.zodiac || 'tropical';
  }

  /**
   * Cast from local civil time (clock time at the birth place).
   * @param {object} m  {year, month(1-12), day, hour(0-23), minute, latitude, longitude}
   * @returns {Frame}  normalised chart frame
   */
  castFromLocal(m) { throw new Error('not implemented'); }

  /**
   * Cast from an absolute UTC instant observed at a place.
   * @param {Date} instantUtc
   * @param {{latitude:number, longitude:number}} place
   * @returns {Frame}
   */
  castFromInstant(instantUtc, place) { throw new Error('not implemented'); }
}
```

**决策**：

- **签名完全沿用现有方法**——`HoroscopeAdapter` 只需 `extends EphemerisAdapter` 即成合法实现，零行为改动。
- **不在此接口加恒星/小行星方法**（YAGNI）。当前目标是精准西方命理 + RAG 数据，Frame 内 10 行星 + 凯龙 + 交点 + 莉莉丝已是完整命理数据集。恒星/小行星是后续扩展，真要做时再加接口方法，避免现在设计无人调用的抽象。

### 2.2 Frame 结构（保持不变，字段契约）

```js
{
  points: [
    { key, kind,           // 'body' | 'point'
      longitude,           // 0-360 黄经（已 normalize）
      signIndex,           // 0-11（由 longitude 派生）
      degreeInSign,        // 0-29.999（由 longitude 派生）
      retrograde,          // boolean
      house }              // 1-12 | null
  ],
  houses: [
    { index,               // 1-12
      cuspLongitude }      // 0-360（宫始点黄经，已 normalize）
  ],
  angles: { ascendant, midheaven, descendant, imumcoeli },  // 全 0-360
  instantUtc,              // ISO string
  julianDate               // number（UT JD）
}
```

**契约保证**（写进接口 JSDoc，作为实现的硬约束）：

| 字段 | 规范 |
|---|---|
| `longitude` / `cuspLongitude` / `angles.*` | **必须**经 `AngleMath.normalize()` 归一化到 `[0, 360)` |
| `signIndex` / `degreeInSign` | **必须**由归一化后的 longitude 经 `AngleMath.signIndex()` / `degreeInSign()` 派生——保证与旧库语义一致 |
| `key` | **必须**用 `Constants.js` 的小写 token（`'sun'`, `'northnode'`, `'lilith'`...），与现有 `DEFAULT_BODY_KEYS` / `DEFAULT_POINT_KEYS` 对齐 |
| `retrograde` | swisseph 通过 `swe_calc_ut` 返回标志位 `SE_RETROGRADE` 判定 |
| `house`（行星落宫）| swisseph `swe_house_pos()` 算出，1-12；**无归属返回 null** |
| `julianDate` | swisseph 用 `swe_julday()` 算 **UT（世界时）JD** |

### 2.3 swisseph C API → Frame 映射

`SwissephAdapter` 调用对应关系（`SwissEphCore` 薄封装，Adaptor 负责映射）：

| Frame 字段 | swisseph 调用 | 备注 |
|---|---|---|
| `points`（body）| `swe_calc_ut(jd_ut, planetId, flags)` | `flags = SEFLG_SWIEPH \| SEFLG_SPEED`；用返回标志判逆行 |
| `points`（northnode/southnode）| `swe_calc_ut(jd_ut, MEAN_NODE)` | 南交点 = 北交点 + 180°（与旧库一致）|
| `points`（lilith）| `swe_calc_ut(jd_ut, MEAN_APOG)` | 真黑月 `OSCU_APOG` 可后续加 |
| `houses` + `angles` | `swe_houses(jd_ut, lat, lng, hsys)` | 返回 cusps[1-12] + ascmc[Asc,MC,...]；宫位代码 `'P'`=Placidus 等 |
| `house`（行星落宫）| `swe_house_pos(lat, lng, hsys, xpin)` | `xpin = [longitude, latitude]` |
| `julianDate` | `swe_julday(y,m,d,h, SE_GREG_CAL)` | **UT**，非 TT |

**行星 ID 映射**（`SwissEphConstants.js` 内部常量表）：
```
sun:SE_SUN  moon:SE_MOON  mercury:SE_MERCURY ... pluto:SE_PLUTO
chiron:SE_CHIRON   northnode:SE_MEAN_NODE   lilith:SE_MEAN_APOG
```

### 2.4 时区与 UT 一致性（关键约束）

swisseph **本身不做时区**——`swe_calc_ut` 要的是 **UT**。`SwissephAdapter.castFromLocal` 收到的是"当地民用时"，内部仍需一次"当地民用时 → UT"转换。

**决策**：`SwissephAdapter` **用与 `HoroscopeAdapter` 相同的底层库做时区解析**（`tz-lookup` 解析 IANA 时区名 + luxon 转换当地民用时↔UT），保证两套后端用的是**同一套 UT**——否则对照测试无法区分"是行星算法差异还是时区差异"。

> 注意：`HoroscopeAdapter._resolveZone` 是靠**旧库的 `new Origin()` probe** 拿时区名的（那是旧后端的内部机制）。`SwissephAdapter` 不能 piggyback 旧库，必须**自己直接调 `tz-lookup(latitude, longitude)` 取时区名**，再用 luxon 做转换。`tz-lookup` 因此成为 `SwissephAdapter` 的直接依赖（旧库本就传递依赖它）。

**已知风险**（迁移期对照验证会发现，**以 swisseph UT JD 为准**）：
- `julianDate` 旧库语义需对照确认（可能 TT 或混合）；swisseph 必须用 UT JD。
- `instantUtc` 由输入民用时 + 地点经度反推，两库应一致。

---

## 3. `SwissEphCore` 薄封装 + 数据文件加载 + 生命周期

### 3.1 文件位置与职责划分

```
src/core/astrology/ephemeris/
  EphemerisAdapter.js     ← 抽象基类（§2 定义）
  SwissephAdapter.js      ← 实现 EphemerisAdapter，做 Frame 映射
  SwissEphCore.js         ← 薄封装 require('swisseph') + 路径 + 单例
  SwissEphConstants.js    ← 行星ID/宫位码/flag 常量表
```

**职责边界**：
- `SwissEphCore` = **"swisseph 怎么用"**（路径、初始化、调用封装、错误转换）
- `SwissephAdapter` = **"swisseph 输出 → Frame"**（映射逻辑、归一化、逆行判定）

两者分离的理由：Core 是纯技术封装（换 swisseph 版本只动这里），Adapter 是纯领域映射（换 Frame 形状只动这里）。

`HoroscopeAdapter.js` **留在 `src/core/astrology/` 根不动**（只加 `extends EphemerisAdapter`）——它是旧实现、迁移期对照用、稳定后要删；放新目录反而暗示是"正统一员"，语义不符。删除时一行 `git rm` 干净利落。

### 3.2 数据文件加载（约束：全量内置 + 仅 Windows）

**路径定位**——开发态与打包态不同，但都是固定相对路径，**无下载、无降级**。

**关键约束**：`src/core/` 是严禁依赖 Electron 的领域层（`Architecture.md` 第 1 节："src/core 完全不依赖 Electron，可用纯 Node 直接单元测试"）。因此 `SwissEphCore` **不能 import electron 的 `app`**，路径解析由组合根 `Main.js`（主进程，可用 `app.isPackaged`）完成后注入 Core。

```js
// Main.js bootstrapServices() —— 组合根解析路径
const path = require('path');
const ephePath = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'ephemeris')
  : path.join(__dirname, '..', '..', 'assets', 'ephemeris');
const SwissEphCore = require('../core/astrology/ephemeris/SwissEphCore');
SwissEphCore.configure({ ephePath });   // 主进程注入，core 不碰 electron
```

```js
// SwissEphCore.js —— 纯领域层，接收注入的路径
let _ephePath = null;
let _initialized = false;
function configure({ ephePath }) { _ephePath = ephePath; }
function ensureInitialized() {
  if (_initialized) return;
  if (!_ephePath) throw new Error('星历数据路径未配置（需由 Main 注入）');
  if (!fs.existsSync(_ephePath)) throw new Error(`星历数据目录不存在: ${_ephePath}`);
  swisseph.swe_set_ephe_path(_ephePath);
  _initialized = true;
}
module.exports = { configure, calcBody, houses, housePos, julDay, close };
```

这样 `SwissEphCore` 保持纯 Node 可测（测试里 `configure({ ephePath: <tmp> })` 即可），`Main.js` 承担所有 Electron 耦合。

**配套改动**：

| 位置 | 改动 |
|---|---|
| `assets/ephemeris/` | **新增目录**，放置全量 `.se1` 文件（Astrodienst 标准全集，约 90MB）|
| `package.json` `build.files` | **新增 `"assets/**/*"`**（当前只有 `src/**/*`）|
| `.gitignore` | **不忽略** `assets/ephemeris/`（用户不在乎仓库体积，直接 commit 全量）|

**初始化时机**：lazy（首次 cast 时触发），**不在每次 cast 重复 set path**（swisseph 文档明确这是进程级设置）。不阻塞应用启动——用户可能只看档案不画盘，没必要启动就加载 90MB 数据文件索引。

### 3.3 单例与生命周期

```js
// SwissEphCore.js（路径由 Main 注入，见 §3.2）
const swisseph = require('swisseph');
const fs = require('fs');
let _ephePath = null;
let _initialized = false;

function configure({ ephePath }) { _ephePath = ephePath; }

function ensureInitialized() {
  if (_initialized) return;
  if (!_ephePath) throw new Error('星历数据路径未配置（需由 Main 注入）');
  if (!fs.existsSync(_ephePath)) throw new Error(`星历数据目录不存在: ${_ephePath}`);
  swisseph.swe_set_ephe_path(_ephePath);
  _initialized = true;
}

module.exports = {
  configure,
  calcBody(jdUt, planetId) {
    ensureInitialized();
    const r = swisseph.swe_calc_ut(jdUt, planetId, swisseph.SEFLG_SWIEPH | swisseph.SEFLG_SPEED);
    if (r.error) throw new Error(`星历计算失败 (${planetId}): ${r.error}`);
    return r;
  },
  houses(jdUt, lat, lng, hsys) { /* ensure + swe_houses + error */ },
  housePos(lat, lng, hsys, xpin) { /* ensure + swe_house_pos + error */ },
  julDay(year, month, day, hour) {
    return swisseph.swe_julday(year, month, day, hour, swisseph.SE_GREG_CAL);
  },
  close() {
    if (_initialized) { swisseph.swe_close(); _initialized = false; }
  },
};
```

- **初始化**：lazy（首次 cast 触发）。
- **清理**：`Main.js` 在 `app.on('quit')` 调用 `SwissEphCore.close()`（`swe_close()` 释放 C 端资源），避免退出时 native 内存告警。
- **单例合理性**：swisseph 的 ephe_path 是进程级全局状态，多实例无意义且会互相覆盖路径——单例是唯一正确选择。

### 3.4 错误处理

Core 把 swisseph 的 `r.error`（C 端英文错误串）**转成中文可读错误抛出**，符合 `Architecture.md` 第 5 节「领域层抛中文可读错误」。抛出的 Error 一路冒泡到 `AstrologyService.computeChart()` → `IpcRouter._handle` 的 try/catch → 自动包成 `{ ok:false, error }` 信封。**无需额外接线**，复用现有错误管线。

---

## 4. 工厂切换 + config 配置项 + 对照验证

### 4.1 config.json 新增配置段

```json
{
  "ephemeris": {
    "backend": "swisseph"
  }
}
```

- **只暴露 `backend` 一个开关**，值 `"swisseph" | "horoscope"`。不在 config 里放 ephe 路径、flag、精度档位——这些是实现内部细节，暴露给 config 只会让用户能改坏。
- **默认值 `"swisseph"`**（目标是 swisseph 成为主实现；deepMerge 保证旧 config.json 也能拿到默认值）。
- `TokenEngine.resolve()` 透传：`ephemeris: raw.ephemeris || { backend: 'swisseph' }`。

### 4.2 `ChartStrategyFactory` 改造

**已核实接线面**（实际改动极小）：

| 文件 | 引用处 | 改动 |
|---|---|---|
| `ChartStrategyFactory.js` | require + deps 默认值 | require 新 Adapter + 按 backend 选实现 + deps 属性名改 `EphemerisAdapter` |
| `ChartStrategy.js` | JSDoc + `_adapter()` 的 `this.deps.HoroscopeAdapter`（2 处）| 改为 `this.deps.EphemerisAdapter` |
| `ReturnFinder.js` | 仅 JSDoc 注释（1 处）| 改注释 |
| `ChartData.js` | 仅 JSDoc 注释（1 处）| 改注释 |

**16+ 个 Strategy 子类零改动**——它们都通过基类 `ChartStrategy._adapter()` 间接访问，从不直接碰 `this.deps`。

```js
// ChartStrategyFactory 构造器改造
const HoroscopeAdapter = require('../HoroscopeAdapter');
const SwissephAdapter = require('./ephemeris/SwissephAdapter');

class ChartStrategyFactory {
  constructor(deps) {
    const backend = (deps && deps.backend) || 'swisseph';
    const AdapterClass = backend === 'swisseph' ? SwissephAdapter : HoroscopeAdapter;
    this.deps = {
      ...deps,
      EphemerisAdapter: AdapterClass,   // 重命名属性，反映"这是抽象接口"
      AspectEngine,
    };
    // ...registry 不变
  }
}
```

**关键决策**：
1. **属性名重命名为 `EphemerisAdapter`**（用户明确要求可读性优先）。改动面经核实仅 4 文件、约 6 处，几乎零成本。
2. **backend 通过 `deps` 注入工厂**（保持工厂"纯构造、不碰 fs/config"的现有风格），配置由组合根 `Main.js` 决定后传入。
3. **Strategy 子类零改动**——项目原设计 DI 兜住了这次迁移。

```js
// Main.js bootstrapServices()
new AstrologyService(new ChartStrategyFactory({ backend: this.config.ephemeris.backend }))
```

### 4.3 对照验证策略（迁移期安全网）

**新增** `tests/EphemerisComparison.js`（纯 Node，归入 `tests/RunAll.js`）：

**目标**：证明 swisseph 的 Frame 输出与旧库在"应该一致的地方"一致，差异都在"可解释的精度/语义差"范围内。

```
测试集设计：
1. 固定出生数据集（10 个代表性档案）：
   - 不同年代（1900 / 1970 / 2000 / 2025）
   - 不同经纬度（北京 / 纽约 / 伦敦 / 南半球悉尼）
   - 含夏令时边界、跨日期线

2. 每个档案用两套 Adapter 各 cast 一次，对比 Frame：
   ┌─────────────┬───────────────────────────────────────┐
   │ 字段         │ 容许阈值                                │
   ├─────────────┼───────────────────────────────────────┤
   │ longitude    │ < 0.01°（超此标记为需调查）              │
   │ retrograde   │ 必须一致                                │
   │ signIndex    │ 必须一致（除非恰跨 30° 边界，单列报告）   │
   │ house        │ 必须一致                                │
   │ angles.Asc   │ < 0.05°（宫位算法实现差异较大，放宽）    │
   │ angles.MC    │ < 0.01°（MC 是纯天文量，应高度一致）     │
   │ houses.cusp  │ < 0.1°（Placidus 等在近极地有奇点，放宽） │
   └─────────────┴───────────────────────────────────────┘

3. 输出对照报告（控制台 + JSON 文件）：列出全部一致档案、超阈值字段 + 实际差值 + 诊断。
```

**迁移完成判据**（"何时删旧库"的标准）：
1. 对照测试 10 个档案全部通过阈值；
2. `npm run smoke` 在 swisseph 后端下渲染无 SVG 异常；
3. 至少手动跑过一次全部 16+ 星盘类型。

满足后，下一迭代 `git rm HoroscopeAdapter.js` + 工厂去掉 horoscope 分支 + 移除 `circular-natal-horoscope-js` 依赖。

---

## 5. RAG 数据产出 + 文件清单 + 迁移步骤

### 5.1 RAG 数据产出（终极目标的划界）

**核心判断**：swisseph 引入后，**Frame / ChartData 本身就是高质量 RAG 数据源**——归一化、可序列化、字段稳定的纯对象。**不另建 RAG 导出管线**。

| RAG 需求 | ChartData DTO 已满足 |
|---|---|
| 结构化（JSON 可入库）| ✅ 纯对象，IPC 已序列化 |
| 精度高（swisseph 角秒级）| ✅ 迁移后达标 |
| 可复现（同输入同输出）| ✅ swisseph 确定性计算 |
| 字段语义明确 | ✅ `key` 用标准 token、有 signIndex/degreeInSign |
| 含逆行/落宫等命理维度 | ✅ retrograde + house 字段 |

**RAG 数据获取路径（现有 IPC 即可，无需新通道）**：
```
未来 RAG 摄取脚本 → IPC chart:compute（或直接调 AstrologyService）
                  → 拿到 ChartData DTO（含富化后的 Frame）
                  → 序列化进向量库
```

`ChartData` 富化层已把 Frame 加工成带符号/星座名/度分秒的展示对象，对 LLM 更友好（"太阳在白羊座 15°23′" 比 "longitude:15.38" 更易理解）。**RAG 直接灌 ChartData DTO，不灌裸 Frame**。

**本设计不为 RAG 做的（明确划界）**：
- ❌ 不建向量库、不做 embedding、不做检索——那是"未来 RAG 系统"的职责，不在本次 swisseph 迁移范围。
- ❌ 不加新的"RAG 导出"IPC 通道——`chart:compute` 产出的 ChartData 就是导出物。
- ✅ 本次只保证：**后端换成 swisseph 后，ChartData 的数值精度达到 RAG 可信数据标准**。这是为 RAG 铺路的"数据地基"，RAG 系统是上层建筑。

### 5.2 完整文件清单

**新增**：

| 文件 | 作用 |
|---|---|
| `src/core/astrology/ephemeris/EphemerisAdapter.js` | 抽象基类（§2.1 接口契约）|
| `src/core/astrology/ephemeris/SwissephAdapter.js` | swisseph 实现，做 Frame 映射 |
| `src/core/astrology/ephemeris/SwissEphCore.js` | 薄封装 + 路径定位 + 单例 |
| `src/core/astrology/ephemeris/SwissEphConstants.js` | 行星ID/宫位码/flag 常量表 |
| `assets/ephemeris/*.se1` | 全量 Astrodienst 数据文件（~90MB）|
| `tests/EphemerisComparison.js` | 10 档案对照验证测试 |

**修改**：

| 文件 | 改动 |
|---|---|
| `package.json` | `dependencies` 加 `swisseph-v2` + `tz-lookup`（SwissephAdapter 直接用时区解析，原为旧库传递依赖，现需显式声明）；`build.files` 加 `"assets/**/*"` |
| `config.json` | 新增 `ephemeris: { backend: "swisseph" }` 段 |
| `src/core/config/TokenEngine.js` | `resolve()` 透传 `ephemeris` 段（+默认值）|
| `src/core/astrology/ChartStrategyFactory.js` | require 新 Adapter + 按 backend 选实现 + deps 属性名改 `EphemerisAdapter` |
| `src/core/astrology/strategies/ChartStrategy.js` | `deps.HoroscopeAdapter` → `deps.EphemerisAdapter`（2 处）+ JSDoc |
| `src/core/astrology/ReturnFinder.js` | JSDoc 注释（1 处）|
| `src/core/astrology/ChartData.js` | JSDoc 注释（1 处）|
| `src/main/Main.js` | `bootstrapServices()` 传 `backend` 给工厂 + 解析 `ephePath` 调 `SwissEphCore.configure()`；`app.on('quit')` 调 `SwissEphCore.close()` |
| `src/core/astrology/HoroscopeAdapter.js` | 加 `extends EphemerisAdapter`（其余不动，迁移期对照用）|

### 5.3 迁移步骤（分 4 步，每步可独立验证）

**第 1 步：抽象接口（零行为变化）**
- 新建 `EphemerisAdapter.js` 抽象基类
- `HoroscopeAdapter extends EphemerisAdapter`，方法签名不动
- `ChartStrategyFactory` / `ChartStrategy` 属性名改 `EphemerisAdapter`
- 跑 `npm test` + `npm run smoke`——**必须全绿，证明抽象层零破坏**
- ✅ 验证点：现有所有测试通过 = 抽象正确

**第 2 步：接入 swisseph 数据文件 + Core**
- 建 `assets/ephemeris/`，下载全量 `.se1`
- `package.json` 加依赖（`swisseph` + `tz-lookup`）+ build.files
- 实现 `SwissEphCore.js`（`configure()` 接收路径 + 单例 + 封装函数）
- **此时还没接工厂**，单独写个 Node 脚本：`SwissEphCore.configure({ ephePath })` 后验证 `swe_calc_ut` 能跑通
- ✅ 验证点：手动脚本算出一个行星位置，与 Astro.com 官方查表对比

**第 3 步：实现 SwissephAdapter + 工厂切换**
- 实现 `SwissephAdapter.js`（Frame 映射 + 时区复用旧库路径）
- `SwissEphConstants.js` 常量表
- 工厂按 `config.ephemeris.backend` 选实现
- `Main.js` 注入 backend + quit 时 close
- config 默认切 swisseph
- ✅ 验证点：`npm start` 实际起一个本命盘，肉眼对比 Astro.com

**第 4 步：对照验证 + 稳定**
- 写 `tests/EphemerisComparison.js`，10 档案阈值表
- 归入 `tests/RunAll.js`
- 跑 `npm test` 全绿 + `npm run smoke` 无 SVG 异常
- 手动过一遍 16+ 星盘类型
- ✅ 验证点：对照测试通过 = 达到"删旧库判据"

**后续迭代（不在本次 spec）**：对照稳定后 `git rm HoroscopeAdapter.js` + 工厂去掉 horoscope 分支 + 移除 `circular-natal-horoscope-js` 依赖。

---

## 6. 不在本次范围内（明确排除）

- 恒星（fixed stars）位置计算
- 小行星扩展（除凯龙外，如谷神/智神/婚神/灶神）
- 真黑月（OSCU_APOG）切换、月交点真值/平均值切换
- 删除旧库 `HoroscopeAdapter`（迁移期保留，对照稳定后下一迭代删）
- 多平台 native binding（仅 Windows）
- 运行时按需下载 ephemeris 文件（全量内置）
- RAG 向量库 / embedding / 检索系统
- 中式命理（sxwnl）后端替换
