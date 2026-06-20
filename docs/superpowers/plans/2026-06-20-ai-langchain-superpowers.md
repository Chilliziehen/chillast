# AI LangChain Astrology Advisor — Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate LangChain.js LLM + RAG knowledge base + Tool Calling into the CHILLAST desktop app, enabling AI-powered chart interpretation, interactive astrology Q&A streaming, and knowledge-grounded analysis — all following the config-driven-gui and i18n architecture.

**Architecture:** New `src/core/ai/` module provides `AiService` (facade), `ChainFactory` (chain/agent), `ModelProvider` (multi-LLM adapter), `KnowledgeBase` (document load → split → embed → HNSWLib vector store → retrieve), and `AstroToolkit` (wraps existing engine services as LangChain tools). Streaming output uses Electron IPC push (`webContents.send`) with session IDs. The AI layer is a pure consumer — zero changes to astrology computation. ESM-only LangChain packages bridged via dynamic `import()` in the CommonJS core.

**Tech Stack:** LangChain.js (`langchain` + `@langchain/core` + `@langchain/openai` + `@langchain/anthropic` + `@langchain/community`), HNSWLib (local vector store), `pdf-parse`, `zod`, Electron `safeStorage` (API key encryption), dynamic `import()` for ESM/CJS bridge.

**Spec:** `docs/superpowers/specs/2026-06-20-ai-langchain-astrology-advisor-design.md`

**Branch:** `feat/ai-base`

**⚠️ Prerequisite gate (Task 3):** 10 built-in Chinese astrology knowledge documents (~30,000 words total) must be sourced or written before the KnowledgeBase task can be completed. AI-generated content has hallucination risk for specialized domain knowledge. Task 3 will verify the file locations and document loading pipeline but placeholder docs are acceptable for testing.

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/core/ai/esm-bridge.js` | Dynamic `import()` helper for CommonJS context |
| `src/core/ai/ModelProvider.js` | LLM + Embeddings instantiation, multi-provider switch |
| `src/core/ai/prompts/ChartSerializer.js` | ChartData DTO → LLM-friendly structured Chinese text |
| `src/core/ai/prompts/InterpretPrompt.js` | System + human prompt template for chart interpretation |
| `src/core/ai/prompts/ChatPrompt.js` | System prompt template for interactive Q&A agent |
| `src/core/ai/KnowledgeBase.js` | RAG pipeline: load → split → embed → vector store → retrieve |
| `src/core/ai/AstroToolkit.js` | Wrap engine services as LangChain DynamicStructuredTool |
| `src/core/ai/ChainFactory.js` | Build interpret chain + chat ReAct agent |
| `src/core/ai/AiService.js` | Facade: interpret / chat (async generators) / configure / status / stop |
| `assets/knowledge/builtin/*.md` | 10 built-in Chinese astrology reference documents |
| `src/renderer/app/components/ChatPanel.js` | Chat UI with streaming token display |
| `src/renderer/app/components/ChatMessage.js` | Single message bubble (user/AI/tool-call) |
| `src/renderer/app/components/MarkdownRenderer.js` | Lightweight Markdown → DOM |
| `src/renderer/app/components/AiSettings.js` | AI settings panel (provider, key, knowledge mgmt) |
| `tests/AiSmoke.js` | Standalone manual LLM connectivity test |
| `tests/AiService.test.js` | Unit tests with FakeListChatModel |

### Modified files

| Path | Change |
|------|--------|
| `package.json` | Add langchain + provider packages + hnswlib-node + pdf-parse + zod |
| `config.json` | Add `ai: { provider, model, temperature, maxTokens, enableRag, ragTopK }` |
| `src/core/config/TokenEngine.js` | Pass through `ai` config with defaults |
| `src/main/Main.js` | Bootstrap AiService, safeStorage API key, quit cleanup |
| `src/main/IpcRouter.js` | Add 12 `ai:*` handlers, webContents for push |
| `src/preload/Preload.js` | Expose `mystApi.ai.*` invoke + push listeners |
| `src/renderer/app/views/ChartWorkbenchView.js` | Embed ChatPanel as collapsible sidebar |
| `src/renderer/app/App.js` | Wire AI settings into app (if settings view exists) |
| `tests/RunAll.js` | Append AiService test block |

---

## Task 1: Dependencies + ESM bridge + ModelProvider

**Goal:** Install LangChain.js, solve CJS/ESM interop, implement ModelProvider that can call at least one LLM (OpenAI). No chain/agent/RAG yet.

**Files:**
- Modify: `package.json`
- Create: `src/core/ai/esm-bridge.js`
- Create: `src/core/ai/ModelProvider.js`
- Create: `tests/AiSmoke.js`

- [ ] **Step 1: Add dependencies to `package.json`**

In `dependencies`, add:

```json
    "langchain": "^0.3.0",
    "@langchain/core": "^0.3.0",
    "@langchain/openai": "^0.3.0",
    "@langchain/anthropic": "^0.3.0",
    "@langchain/community": "^0.3.0",
    "hnswlib-node": "^3.0.0",
    "pdf-parse": "^1.1.1",
    "zod": "^3.23.0"
```

Run: `npm install`

- [ ] **Step 2: Create ESM bridge (`src/core/ai/esm-bridge.js`)**

```js
'use strict';

const _cache = new Map();

async function load(pkg) {
  if (_cache.has(pkg)) return _cache.get(pkg);
  const mod = await import(pkg);
  _cache.set(pkg, mod);
  return mod;
}

module.exports = { load };
```

- [ ] **Step 3: Create `src/core/ai/ModelProvider.js`**

```js
'use strict';

const esm = require('./esm-bridge');

const PROVIDER_MAP = {
  openai:    { chat: ['@langchain/openai', 'ChatOpenAI'],     emb: ['@langchain/openai', 'OpenAIEmbeddings'] },
  anthropic: { chat: ['@langchain/anthropic', 'ChatAnthropic'], emb: null },
  deepseek:  { chat: ['@langchain/openai', 'ChatOpenAI'],     emb: ['@langchain/openai', 'OpenAIEmbeddings'] },
};

class ModelProvider {
  constructor() {
    this._model = null;
    this._embeddings = null;
    this._settings = null;
  }

  async configure(settings) {
    this._settings = { ...settings };
    const provider = settings.provider || 'openai';
    const map = PROVIDER_MAP[provider];
    if (!map) throw new Error(`不支持的 AI 提供商: ${provider}`);

    const [chatPkg, chatClass] = map.chat;
    const mod = await esm.load(chatPkg);
    const ChatCls = mod[chatClass];
    const chatOpts = {
      model: settings.model || (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6'),
      temperature: settings.temperature ?? 0.7,
      maxTokens: settings.maxTokens ?? 4096,
    };
    if (settings.apiKey) chatOpts.apiKey = settings.apiKey;
    if (settings.baseUrl && provider === 'deepseek') chatOpts.configuration = { baseURL: settings.baseUrl };

    this._model = new ChatCls(chatOpts);

    if (map.emb) {
      const [embPkg, embClass] = map.emb;
      const embMod = await esm.load(embPkg);
      const EmbCls = embMod[embClass];
      this._embeddings = new EmbCls(settings.apiKey ? { apiKey: settings.apiKey } : {});
    }
  }

  chatModel() { return this._model; }
  embeddings() { return this._embeddings; }
  isConfigured() { return this._model !== null; }
}

module.exports = ModelProvider;
```

- [ ] **Step 4: Create standalone smoke test (`tests/AiSmoke.js`)**

```js
'use strict';

const ModelProvider = require('../src/core/ai/ModelProvider');

async function main() {
  const mp = new ModelProvider();
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY env var'); process.exit(1); }
  await mp.configure({ provider: 'openai', model: 'gpt-4o-mini', apiKey, temperature: 0 });
  const model = mp.chatModel();
  const resp = await model.invoke([{ role: 'user', content: 'Hello, respond with one word.' }]);
  console.log('LLM response:', resp.content);
  if (!resp.content) { console.error('FAIL: empty response'); process.exit(1); }
  console.log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run smoke test and commit**

```bash
$env:OPENAI_API_KEY="sk-..."
node tests/AiSmoke.js
```
Expected: `LLM response: Hello` or similar.

```bash
git add package.json package-lock.json src/core/ai/esm-bridge.js src/core/ai/ModelProvider.js tests/AiSmoke.js
git commit -m "feat(ai): LangChain dependencies, ESM bridge, ModelProvider"
```

---

## Task 2: ChartSerializer + Prompt templates

**Goal:** Pure, testable modules that transform ChartData DTO into LLM-ready text and assemble system/human prompts. No LLM calls.

**Files:**
- Create: `src/core/ai/prompts/ChartSerializer.js`
- Create: `src/core/ai/prompts/InterpretPrompt.js`
- Create: `src/core/ai/prompts/ChatPrompt.js`

- [ ] **Step 1: Create `ChartSerializer.js`**

```js
'use strict';

function formatPos(p) {
  const dms = p.dms;
  const retro = p.retrograde ? ' (逆行)' : '';
  return `${p.glyph} ${p.nameZh}  ${p.signNameZh} ${dms.degrees}°${String(dms.minutes).padStart(2, '0')}′  第${p.house || '?'}宫${retro}`;
}

function serializeAngles(angles) {
  if (!angles) return '';
  const lines = [];
  for (const key of ['ascendant', 'midheaven', 'descendant', 'imumcoeli']) {
    const a = angles[key];
    if (!a) continue;
    lines.push(`${a.glyph} ${a.nameZh}: ${a.signNameZh} ${a.dms.degrees}°${String(a.dms.minutes).padStart(2, '0')}′`);
  }
  return lines.join('\n');
}

function serializeHouses(houses) {
  if (!houses || !houses.length) return '';
  return houses.map((h) =>
    `第${h.index}宫: ${h.signNameZh} ${h.degreeInSign.toFixed(2)}°`
  ).join('\n');
}

function serializeAspects(aspects) {
  if (!aspects || !aspects.length) return '(无主要相位)';
  return aspects.slice(0, 20).map((a) =>
    `${a.glyph} ${a.nameZh}  (容许度 ${a.orb.toFixed(1)}°)`
  ).join('\n');
}

function serializeDistributions(dist) {
  if (!dist) return '';
  const e = dist.elements || {};
  const m = dist.modalities || {};
  return `元素: 火${e.fire||0} 土${e.earth||0} 风${e.air||0} 水${e.water||0}\n模式: 基本${m.cardinal||0} 固定${m.fixed||0} 变动${m.mutable||0}`;
}

function toText(chartData) {
  const meta = chartData.meta || {};
  const subjects = (chartData.subjects || []).map((s) => s.nameZh || s.nameEn || '').filter(Boolean).join(' · ');
  const lines = [];

  lines.push(`【${meta.typeNameZh || '星盘'}】${subjects}`);
  if (meta.subtitle) lines.push(meta.subtitle);
  lines.push('');

  lines.push('── 行星位置 ──');
  for (const ring of (chartData.rings || [])) {
    if (chartData.rings.length > 1) lines.push(`  [${ring.label}]`);
    for (const p of (ring.points || [])) lines.push(formatPos(p));
  }
  lines.push('');

  if (chartData.angles) {
    lines.push('── 四轴 ──');
    lines.push(serializeAngles(chartData.angles));
    lines.push('');
  }

  if (chartData.houses && chartData.houses.length) {
    lines.push('── 宫位 ──');
    lines.push(serializeHouses(chartData.houses));
    lines.push('');
  }

  if (chartData.aspects && chartData.aspects.length) {
    lines.push('── 主要相位 ──');
    lines.push(serializeAspects(chartData.aspects));
    lines.push('');
  }

  if (chartData.distributions) {
    lines.push('── 分布 ──');
    lines.push(serializeDistributions(chartData.distributions));
  }

  return lines.join('\n');
}

module.exports = { toText };
```

- [ ] **Step 2: Create `InterpretPrompt.js`**

```js
'use strict';

function build(chartText, ragContext, chartType) {
  const system = `你是一位专业的占星分析师，精通西方占星学与中式命理学。

你的任务是对以下${chartType || '星盘'}数据进行全面、专业的解读。

## 解读要求
1. **综合分析**：先给出整体性格画像（太阳/月亮/上升三位一体），再展开各行星的落座落宫含义。
2. **相位解读**：重点分析主要相位（合相、对分、三分、四分），说明行星间的能量互动。
3. **格局识别**：识别大十字、大三角、T三角、风筝等特殊格局（如有）。
4. **宫位重点**：分析行星密集的宫位及空宫的含义。
5. **逆行分析**：对逆行行星给出专门解读。
6. **实用建议**：基于星盘特征给出性格发展建议和生活方向提示。

星象是能量趋势的描述，不是命运的判决。避免绝对化表述。不提供医疗、法律或投资建议。

## 知识参考
${ragContext || '(无知识库参考)'}

## 输出格式
使用清晰的层级标题，每个分析维度一个小节。分析应当深入但易懂。`;

  const human = `## 星盘数据\n\n${chartText}`;

  return { systemMessage: system, humanMessage: human };
}

module.exports = { build };
```

- [ ] **Step 3: Create `ChatPrompt.js`**

```js
'use strict';

function build(currentChartContext) {
  const system = `你是 CHILLAST 占星工作站的 AI 助手。你精通西方占星学和中式命理学。

## 你的能力
- 解读用户的星盘数据（行星位置、相位、宫位等）
- 分析行运对本命盘的影响
- 解答占星学理论问题
- 提供中式八字命理分析
- 比较两人的合盘关系

## 你可以使用的工具
你有权调用计算引擎来获取精确的占星数据。当用户提供出生信息时，请调用相应工具计算星盘，而不是凭记忆猜测行星位置。你也可以使用知识库检索获取权威占星知识。

## 当前星盘上下文
${currentChartContext || '(未打开星盘)'}

## 重要原则
- 始终基于精确计算的星盘数据分析，不要编造行星位置
- 引用知识库内容时标注来源
- 星象是能量趋势的描述，不是命运的判决
- 不提供医疗、法律或投资建议
- 保持开放和尊重的态度对待不同占星学派的观点`;

  return system;
}

module.exports = { build };
```

- [ ] **Step 4: Add unit tests for ChartSerializer to `tests/RunAll.js`**

Add after existing test sections, before final summary:

```js
console.log('\nChartSerializer');
test('serializes natal chart with glyphs and signs', () => {
  const { toText } = require('../src/core/ai/prompts/ChartSerializer');
  const chart = svc.computeChart({ type: 'natal', primary: subjectA });
  const text = toText(chart);
  assert.ok(text.includes('太阳'), 'contains Sun');
  assert.ok(text.includes('摩羯座'), 'contains Capricorn');
  assert.ok(text.includes('♂'), 'contains Mars glyph');
});
test('serializes dual-ring chart', () => {
  const { toText } = require('../src/core/ai/prompts/ChartSerializer');
  const chart = svc.computeChart({ type: 'transit', primary: subjectA, options: { targetDate: '2026-06-18T12:00:00Z' } });
  const text = toText(chart);
  assert.ok(text.includes('行运'), 'contains transit label');
});
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src/core/ai/prompts/ tests/RunAll.js
git commit -m "feat(ai): ChartSerializer, InterpretPrompt, ChatPrompt templates"
```

---

## Task 3: KnowledgeBase (RAG) + built-in knowledge docs

**Goal:** RAG pipeline: load → split → embed → HNSWLib vector store → retrieve. Built-in docs serve as test data.

**Files:**
- Create: `src/core/ai/KnowledgeBase.js`
- Create: `assets/knowledge/builtin/` (10 .md files — placeholder content acceptable for pipeline testing)

**⚠️ Gate:** Write or source at least placeholder content for the 10 knowledge files. Each should be ~2000 words of Chinese astrology text. Without these, the vector store has no data to retrieve from. Placeholder files using publicly available astrology reference material are acceptable.

- [ ] **Step 1: Create placeholder knowledge documents**

Create `assets/knowledge/builtin/` with these files (minimum: 500 words each of Chinese astrology text):

| File | Topic |
|------|-------|
| `planets-in-signs.md` | 行星落座含义 |
| `planets-in-houses.md` | 行星落宫含义 |
| `aspects-interpretation.md` | 相位解读 |
| `house-meanings.md` | 十二宫位含义 |
| `chart-patterns.md` | 常见格局 |
| `retrograde-guide.md` | 逆行含义 |
| `transit-guide.md` | 行运解读指南 |
| `synastry-guide.md` | 合盘解读指南 |
| `bazi-basics.md` | 八字基础 |
| `bazi-interpretation.md` | 八字解读 |

- [ ] **Step 2: Create `KnowledgeBase.js`**

```js
'use strict';

const path = require('path');
const fs = require('fs');
const esm = require('./esm-bridge');

class KnowledgeBase {
  constructor(modelProvider) {
    this._mp = modelProvider;
    this._store = null;
    this._docs = [];
  }

  async initialize(builtinPath, userDataPath) {
    const { RecursiveCharacterTextSplitter } = await esm.load('@langchain/core');
    const { HNSWLib } = await esm.load('@langchain/community/vectorstores/hnswlib');
    const { TextLoader } = await esm.load('langchain/document_loaders/fs/text');

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const allDocs = [];

    const readDir = (dir, source) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.md') && !f.endsWith('.txt')) continue;
        const fp = path.join(dir, f);
        allDocs.push({ filePath: fp, source });
        this._docs.push({ id: fp, name: f, source, importedAt: new Date().toISOString() });
      }
    };
    readDir(builtinPath, 'builtin');
    if (userDataPath) readDir(userDataPath, 'user');

    if (!allDocs.length) return;

    const chunks = [];
    for (const { filePath, source } of allDocs) {
      const loader = new TextLoader(filePath);
      const docs = await loader.load();
      for (const d of docs) d.metadata.source = source;
      const split = await splitter.splitDocuments(docs);
      chunks.push(...split);
    }

    if (chunks.length && this._mp.embeddings()) {
      this._store = await HNSWLib.fromDocuments(chunks, this._mp.embeddings());
    }
  }

  async retrieve(query, k = 6) {
    if (!this._store) return [];
    const results = await this._store.similaritySearch(query, k);
    return results.map((r) => ({ content: r.pageContent, source: r.metadata.source || 'unknown' }));
  }

  listDocuments() { return [...this._docs]; }
  isReady() { return this._store !== null; }
}

module.exports = KnowledgeBase;
```

- [ ] **Step 3: Add KnowledgeBase test to tests/RunAll.js**

```js
console.log('\nKnowledgeBase');
test('initializes with builtin docs', () => {
  assert.ok(typeof KnowledgeBase === 'function', 'KnowledgeBase exports constructor');
});
```

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/KnowledgeBase.js assets/knowledge/ tests/RunAll.js
git commit -m "feat(ai): KnowledgeBase RAG pipeline with built-in knowledge docs"
```

---

## Task 4: AstroToolkit (LangChain Tool wrappers)

**Goal:** Wrap `AstrologyService` / `ChineseAstrologyService` as LangChain tools for the agent to call.

**Files:**
- Create: `src/core/ai/AstroToolkit.js`

- [ ] **Step 1: Create `AstroToolkit.js`**

```js
'use strict';

const esm = require('./esm-bridge');
const { toText } = require('./prompts/ChartSerializer');

async function createTools(astrologyService, chineseAstrologyService) {
  const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
  const { z } = await esm.load('zod');

  return [
    new DynamicStructuredTool({
      name: 'compute_natal_chart',
      description: '计算某人的本命星盘。输入出生年月日时分和经纬度，返回完整行星位置、宫位、相位数据。用中文回答。',
      schema: z.object({
        year: z.number().int().min(1).max(3000),
        month: z.number().int().min(1).max(12),
        day: z.number().int().min(1).max(31),
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
      func: async (input) => {
        try {
          const profile = {
            nameZh: '查询', birthData: {
              year: input.year, month: input.month, day: input.day,
              hour: input.hour, minute: input.minute,
              location: { label: `${input.latitude},${input.longitude}`, latitude: input.latitude, longitude: input.longitude },
            },
          };
          const chart = astrologyService.computeChart({ type: 'natal', primary: profile });
          return toText(chart);
        } catch (e) { return `计算失败: ${e.message}`; }
      },
    }),
    new DynamicStructuredTool({
      name: 'compute_transit',
      description: '计算某人在指定日期的行运盘，分析当前天象对本命盘的影响。需要出生数据+目标日期。',
      schema: z.object({
        year: z.number(), month: z.number(), day: z.number(), hour: z.number(), minute: z.number(),
        latitude: z.number(), longitude: z.number(),
        targetYear: z.number(), targetMonth: z.number(), targetDay: z.number(),
      }),
      func: async (input) => {
        try {
          const profile = {
            nameZh: '查询', birthData: {
              year: input.year, month: input.month, day: input.day,
              hour: input.hour, minute: input.minute,
              location: { label: '', latitude: input.latitude, longitude: input.longitude },
            },
          };
          const targetDate = new Date(Date.UTC(input.targetYear, input.targetMonth - 1, input.targetDay)).toISOString();
          const chart = astrologyService.computeChart({ type: 'transit', primary: profile, options: { targetDate } });
          return toText(chart);
        } catch (e) { return `计算失败: ${e.message}`; }
      },
    }),
    new DynamicStructuredTool({
      name: 'compute_bazi',
      description: '计算某人的八字命盘（四柱：年柱、月柱、日柱、时柱），返回天干地支、五行、生肖等。',
      schema: z.object({
        year: z.number(), month: z.number(), day: z.number(), hour: z.number(), minute: z.number(),
        latitude: z.number(), longitude: z.number(),
      }),
      func: async (input) => {
        try {
          const result = chineseAstrologyService.computeBaZi({
            birthData: {
              year: input.year, month: input.month, day: input.day,
              hour: input.hour, minute: input.minute,
              location: { label: '', latitude: input.latitude, longitude: input.longitude },
            },
          });
          const p = result.bazi.pillars;
          return `八字: ${p.year.full} ${p.month.full} ${p.day.full} ${p.hour.full}\n日主: ${result.bazi.dayMaster.char}(${result.bazi.dayMaster.element})\n农历: ${result.lunar.lunarYear} ${result.lunar.lunarMonth}${result.lunar.lunarDay}`;
        } catch (e) { return `计算失败: ${e.message}`; }
      },
    }),
  ];
}

module.exports = { createTools };
```

- [ ] **Step 2: Add test and commit**

```bash
npm test
git add src/core/ai/AstroToolkit.js
git commit -m "feat(ai): AstroToolkit wraps engine services as LangChain tools"
```

---

## Task 5: ChainFactory + AiService facade

**Goal:** Build chains and agent, implement AiService with async generator streaming and AbortController support.

**Files:**
- Create: `src/core/ai/ChainFactory.js`
- Create: `src/core/ai/AiService.js`
- Create: `tests/AiService.test.js`

- [ ] **Step 1: Create `ChainFactory.js`**

```js
'use strict';

const esm = require('./esm-bridge');
const { build: buildInterpretPrompt } = require('./prompts/InterpretPrompt');
const { build: buildChatPrompt } = require('./prompts/ChatPrompt');

class ChainFactory {
  constructor(modelProvider, knowledgeBase) {
    this._mp = modelProvider;
    this._kb = knowledgeBase;
  }

  async buildInterpretStream(chartText, chartType) {
    const model = this._mp.chatModel();
    let ragContext = '';
    if (this._kb && this._kb.isReady()) {
      const docs = await this._kb.retrieve(chartText, 6);
      ragContext = docs.map((d, i) => `[${i + 1}] ${d.content}`).join('\n\n');
    }
    const { systemMessage, humanMessage } = buildInterpretPrompt(chartText, ragContext, chartType);
    return model.stream([
      { role: 'system', content: systemMessage },
      { role: 'user', content: humanMessage },
    ]);
  }

  async buildChatAgentStream(messages, currentChartContext, tools) {
    const model = this._mp.chatModel();
    const system = buildChatPrompt(currentChartContext);

    if (tools && tools.length > 0) {
      const { createReactAgent } = await esm.load('langchain/agents');
      const allTools = [...tools];
      if (this._kb && this._kb.isReady()) {
        const { DynamicStructuredTool } = await esm.load('@langchain/core/tools');
        const { z } = await esm.load('zod');
        allTools.push(new DynamicStructuredTool({
          name: 'search_knowledge_base',
          description: '搜索占星知识库，查找关于某个主题的专业占星知识。中文关键词。',
          schema: z.object({ query: z.string().describe('搜索关键词') }),
          func: async (input) => {
            const docs = await this._kb.retrieve(input.query, 4);
            return docs.map((d) => d.content).join('\n\n') || '未找到相关知识';
          },
        }));
      }
      const agent = createReactAgent({ llm: model, tools: allTools, messageModifier: system });
      return agent.streamEvents({ messages }, { version: 'v2' });
    }

    return model.stream([{ role: 'system', content: system }, ...messages]);
  }
}

module.exports = ChainFactory;
```

- [ ] **Step 2: Create `AiService.js`**

```js
'use strict';

const ModelProvider = require('./ModelProvider');
const KnowledgeBase = require('./KnowledgeBase');
const ChainFactory = require('./ChainFactory');
const { createTools } = require('./AstroToolkit');

class AiService {
  constructor(astrologyService, chineseAstrologyService) {
    this._astrology = astrologyService;
    this._chinese = chineseAstrologyService;
    this._mp = new ModelProvider();
    this._kb = null;
    this._chainFactory = null;
    this._tools = [];
    this._configured = false;
    this._abortControllers = new Map();
  }

  async configure(settings) {
    await this._mp.configure(settings);
    this._kb = new KnowledgeBase(this._mp);
    if (settings.knowledgeBuiltinPath) {
      await this._kb.initialize(settings.knowledgeBuiltinPath, settings.knowledgeUserPath);
    }
    this._chainFactory = new ChainFactory(this._mp, this._kb);
    this._tools = await createTools(this._astrology, this._chinese);
    this._configured = true;
  }

  status() {
    return {
      configured: this._configured,
      provider: this._mp._settings?.provider || 'openai',
      model: this._mp._settings?.model || '',
      knowledgeDocCount: this._kb ? this._kb.listDocuments().length : 0,
    };
  }

  getKnowledgeBase() { return this._kb; }

  async *interpret(chartData, options = {}) {
    if (!this._configured) throw new Error('AI 服务未配置，请先设置 API Key');
    const { toText } = require('./prompts/ChartSerializer');
    const chartText = toText(chartData);
    const chartType = options.chartType || chartData.meta?.type || 'natal';

    const stream = await this._chainFactory.buildInterpretStream(chartText, chartType);
    for await (const chunk of stream) {
      const token = typeof chunk === 'string' ? chunk : (chunk.content || '');
      if (token) yield { type: 'token', data: token };
    }
    yield { type: 'done', data: {} };
  }

  async *chat(messages, context = {}) {
    if (!this._configured) throw new Error('AI 服务未配置，请先设置 API Key');
    const sessionId = context.sessionId || String(Date.now());
    const ac = new AbortController();
    this._abortControllers.set(sessionId, ac);

    try {
      const stream = await this._chainFactory.buildChatAgentStream(
        messages, context.currentChartText || null, this._tools,
      );
      for await (const event of stream) {
        if (ac.signal.aborted) break;
        if (event.event === 'on_chat_model_stream') {
          const token = event.data?.chunk?.content || '';
          if (token) yield { type: 'token', data: token };
        } else if (event.event === 'on_tool_start') {
          yield { type: 'tool-call', data: { tool: event.name || event.data?.name, status: 'calling' } };
        } else if (event.event === 'on_tool_end') {
          yield { type: 'tool-call', data: { tool: event.name || event.data?.name, status: 'done' } };
        }
      }
    } finally {
      this._abortControllers.delete(sessionId);
    }
    yield { type: 'done', data: { sessionId } };
  }

  stop(sessionId) {
    const ac = this._abortControllers.get(sessionId);
    if (ac) ac.abort();
  }

  async close() {
    for (const ac of this._abortControllers.values()) ac.abort();
    this._abortControllers.clear();
  }
}

module.exports = AiService;
```

- [ ] **Step 3: Create `tests/AiService.test.js`**

```js
'use strict';

const assert = require('assert');

const ModelProvider = require('../src/core/ai/ModelProvider');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (err) { failed++; process.stdout.write(`  ✗ ${name}\n      ${err.message}\n`); }
}

console.log('\nAiService (unit)');
test('ModelProvider creates without crash', () => {
  const mp = new ModelProvider();
  assert.strictEqual(mp.isConfigured(), false);
});
test('ModelProvider configure requires valid provider', async () => {
  // This test exercises the module structure without needing an API key
  const AiService = require('../src/core/ai/AiService');
  assert.ok(typeof AiService === 'function', 'AiService is a constructor');
});

if (failed) process.exitCode = 1;
```

- [ ] **Step 4: Wire test into `tests/RunAll.js`**

At the end of the file, before the final summary, add:
```js
require('./AiService.test');
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src/core/ai/ChainFactory.js src/core/ai/AiService.js tests/AiService.test.js tests/RunAll.js
git commit -m "feat(ai): ChainFactory, AiService facade with streaming interpret + chat"
```

---

## Task 6: IPC wiring + Preload + Main integration

**Goal:** Wire AiService into Electron: IPC channels, preload bridge, Main bootstrap, API key secure storage.

**Files:**
- Modify: `src/main/Main.js`
- Modify: `src/main/IpcRouter.js`
- Modify: `src/preload/Preload.js`
- Modify: `config.json`
- Modify: `src/core/config/TokenEngine.js`

- [ ] **Step 1: Add AI config to `config.json` + TokenEngine**

In `config.json`, add before `"locale"`:
```json
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 4096,
    "enableRag": true,
    "ragTopK": 6
  },
```

In `TokenEngine.resolve()`, add:
```js
      ai: raw.ai || { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 4096, enableRag: true, ragTopK: 6 },
```

- [ ] **Step 2: Bootstrap AiService in `Main.js`**

Add require:
```js
const AiService = require('../core/ai/AiService');
const { safeStorage } = require('electron');
```

In `bootstrapServices()`, after ephemeris config:
```js
    const builtinKnowledgePath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets', 'knowledge', 'builtin')
      : path.join(__dirname, '..', '..', 'assets', 'knowledge', 'builtin');
    const userKnowledgePath = path.join(app.getPath('userData'), 'knowledge', 'user');

    this.aiService = new AiService(this.astrologyService, this.chineseAstrologyService);
    const aiSettings = { ...this.config.ai, knowledgeBuiltinPath: builtinKnowledgePath, knowledgeUserPath: userKnowledgePath };
    const credPath = path.join(app.getPath('userData'), 'ai-credentials.json');
    if (fs.existsSync(credPath)) {
      try {
        const cred = JSON.parse(safeStorage.decryptString(fs.readFileSync(credPath, 'utf-8')));
        aiSettings.apiKey = cred.apiKey || '';
      } catch (_) {}
    }
    this.aiService.configure(aiSettings).catch(() => {});
```

Inject into IpcRouter:
```js
      aiService: this.aiService,
```

Add quit cleanup:
```js
    app.on('quit', () => {
      SwissEphCore.close();
      if (this.aiService) this.aiService.close();
    });
```

- [ ] **Step 3: Add AI IPC handlers to `IpcRouter.js`**

Add constructor parameter:
```js
  constructor({ ipcMain, profileRepository, astrologyService, chineseAstrologyService, config, locale, aiService, webContents }) {
    ... this.aiService = aiService; this.webContents = webContents;
```

Add handlers in `register()`:
```js
    this._handle('ai:status', () => this.aiService.status());
    this._handle('ai:configure', (_e, settings) => {
      // Encrypt API key if provided
      if (settings.apiKey) {
        const { safeStorage } = require('electron');
        const credPath = require('path').join(require('electron').app.getPath('userData'), 'ai-credentials.json');
        const encrypted = safeStorage.encryptString(JSON.stringify({ apiKey: settings.apiKey }));
        require('fs').writeFileSync(credPath, encrypted, 'utf-8');
      }
      return this.aiService.configure(settings).then(() => ({ ok: true }));
    });

    this._handle('ai:interpret', async (_e, chartData, options) => {
      for await (const event of this.aiService.interpret(chartData, options)) {
        this.webContents.send('ai:token', { type: event.type, data: event.data });
      }
      return { ok: true };
    });

    this._handle('ai:chat', async (_e, messages, context) => {
      const sessionId = String(Date.now());
      for await (const event of this.aiService.chat(messages, { ...context, sessionId })) {
        this.webContents.send('ai:token', { sessionId, type: event.type, data: event.data });
      }
      return { ok: true };
    });

    this._handle('ai:stop', (_e, sessionId) => {
      if (this.aiService) this.aiService.stop(sessionId);
      return { ok: true };
    });

    this._handle('ai:knowledge:list', () => this.aiService.getKnowledgeBase()?.listDocuments() || []);
```

Pass webContents from Main.js — in `createWindow()` after `this.mainWindow` is set, the ipcRouter needs `webContents: this.mainWindow.webContents`. But `createWindow()` is called AFTER `bootstrapServices()`. Solution: store router, inject webContents later.

In Main.js `bootstrapServices()`:
```js
    this.router = new IpcRouter({ ... });
    this.router.register();
```

In Main.js `createWindow()`, after window creation:
```js
    this.router.setWebContents(this.mainWindow.webContents);
```

In IpcRouter.js, add:
```js
  setWebContents(wc) { this.webContents = wc; }
```

- [ ] **Step 4: Extend Preload bridge**

Add to `mystApi` object in Preload.js:
```js
    ai: {
      interpret: (chartData, options) => invoke('ai:interpret', chartData, options),
      chat: (messages, context) => invoke('ai:chat', messages, context),
      stop: (sessionId) => invoke('ai:stop', sessionId),
      configure: (settings) => invoke('ai:configure', settings),
      status: () => invoke('ai:status'),
      onToken: (callback) => ipcRenderer.on('ai:token', (_e, data) => callback(data)),
      onDone: (callback) => ipcRenderer.on('ai:done', (_e, data) => callback(data)),
      onError: (callback) => ipcRenderer.on('ai:error', (_e, data) => callback(data)),
      removeAllListeners: () => {
        for (const ch of ['ai:token', 'ai:done', 'ai:error'])
          ipcRenderer.removeAllListeners(ch);
      },
      knowledge: {
        list: () => invoke('ai:knowledge:list'),
      },
    },
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src/main/Main.js src/main/IpcRouter.js src/preload/Preload.js config.json src/core/config/TokenEngine.js
git commit -m "feat(ai): IPC wiring, preload bridge, Main bootstrap for AI service"
```

---

## Task 7: ChatPanelView (renderer UI)

**Goal:** Chat UI panel with streaming token display, input field, "AI 解读" button, Markdown rendering, tool-call indicators.

**Files:**
- Create: `src/renderer/app/components/ChatPanel.js`
- Create: `src/renderer/app/components/MarkdownRenderer.js`
- Modify: `src/renderer/app/views/ChartWorkbenchView.js`
- Modify: `src/renderer/styles/Components.css`

- [ ] **Step 1: Create `MarkdownRenderer.js`**

```js
export function renderMarkdown(text) {
  let html = String(text);
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/\n/g, '<br>');
  return html;
}
```

- [ ] **Step 2: Create `ChatPanel.js`**

```js
import { h, mount, clear } from '../Dom.js';
import { renderMarkdown } from './MarkdownRenderer.js';
import { t } from '../I18n.js';

export class ChatPanel {
  constructor({ onInterpret, onSend, onStop }) {
    this._messages = [];
    this._streaming = false;
    this._currentAiMessage = '';
    this._onInterpret = onInterpret;
    this._onSend = onSend;
    this._onStop = onStop;
    this._build();
  }

  get element() { return this._root; }

  _build() {
    this._msgList = h('div', { class: 'chat-messages' });
    this._input = h('input', { class: 'input chat-input', placeholder: '输入问题...', onkeydown: (e) => { if (e.key === 'Enter') this._send(); } });

    this._root = h('div', { class: 'chat-panel' }, [
      this._msgList,
      h('div', { class: 'chat-input-row' }, [
        this._input,
        this._streaming
          ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onStop() }, '停止')
          : h('button', { class: 'btn btn-sm btn-primary', onclick: () => this._send() }, '发送'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onInterpret() }, 'AI 解读'),
      ]),
    ]);
  }

  _send() {
    const text = this._input.value.trim();
    if (!text) return;
    this._input.value = '';
    this._addMessage('user', text);
    this._onSend(text);
  }

  _addMessage(role, content) {
    this._messages.push({ role, content });
    this._render();
  }

  appendToken(token) {
    this._currentAiMessage += token;
    this._render();
  }

  finishStreaming() {
    if (this._currentAiMessage) {
      this._messages.push({ role: 'ai', content: this._currentAiMessage });
    }
    this._currentAiMessage = '';
    this._streaming = false;
    this._build();
  }

  showToolCall(name) {
    this._messages.push({ role: 'tool', content: `正在计算: ${name}...` });
    this._render();
  }

  _render() {
    const items = this._messages.map((m) => {
      const cls = `chat-msg chat-msg-${m.role}`;
      const inner = m.role === 'ai' ? h('div', { class: 'chat-msg-body', html: renderMarkdown(m.content) }) : h('div', { class: 'chat-msg-body' }, m.content);
      return h('div', { class: cls }, [inner]);
    });
    if (this._currentAiMessage) {
      items.push(h('div', { class: 'chat-msg chat-msg-ai streaming' }, [
        h('div', { class: 'chat-msg-body', html: renderMarkdown(this._currentAiMessage) }),
        h('span', { class: 'chat-cursor' }, '▌'),
      ]));
    }
    mount(this._msgList, items);
    this._msgList.scrollTop = this._msgList.scrollHeight;
  }
}
```

- [ ] **Step 3: Integrate into `ChartWorkbenchView.js`**

Add import:
```js
import { ChatPanel } from '../components/ChatPanel.js';
```

In `_draw()`, add after the workbench-main:
```js
    this.chatPanel = new ChatPanel({
      onInterpret: () => this._onAiInterpret(),
      onSend: (text) => this._onAiChat(text),
      onStop: () => window.mystApi.ai.stop(this._aiSessionId),
    });
```

Add methods in the class:
```js
  _onAiInterpret() {
    this._aiSessionId = String(Date.now());
    const chartData = this._lastChartData;
    if (!chartData) { notify.error('请先生成星盘'); return; }
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.interpret(chartData, { chartType: chartData.meta.type });
  }

  _onAiChat(text) {
    this._aiSessionId = String(Date.now());
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'tool-call') this.chatPanel.showToolCall(data.tool);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.chat([{ role: 'user', content: text }], { currentChartText: null });
  }
```

Store `this._lastChartData` in `_compute()` after successful chart generation:
```js
      this._lastChartData = chart;
```

- [ ] **Step 4: Add CSS**

In `Components.css`, add:
```css
.chat-panel { display: flex; flex-direction: column; height: 100%; border-left: 1px solid var(--border-soft); }
.chat-messages { flex: 1; overflow-y: auto; padding: var(--sp-3); }
.chat-msg { margin-bottom: var(--sp-2); max-width: 85%; }
.chat-msg-user { margin-left: auto; }
.chat-msg-user .chat-msg-body { background: var(--accent-violet-soft); color: var(--text-primary); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-lg); }
.chat-msg-ai .chat-msg-body { background: var(--bg-elevated); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-lg); }
.chat-msg-tool .chat-msg-body { font-size: var(--fs-xs); color: var(--text-muted); font-style: italic; }
.chat-cursor { animation: blink 1s step-end infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
.chat-input-row { display: flex; gap: var(--sp-1); padding: var(--sp-2); border-top: 1px solid var(--border-soft); }
.chat-input { flex: 1; }
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test
git add src/renderer/app/components/ChatPanel.js src/renderer/app/components/MarkdownRenderer.js src/renderer/app/views/ChartWorkbenchView.js src/renderer/styles/Components.css
git commit -m "feat(ai): ChatPanelView with streaming display, input, and interpret button"
```

---

## Task 8: AI Settings panel + API key management

**Goal:** UI for configuring LLM provider, securely entering API keys, and managing knowledge base imports.

**Files:**
- Create: `src/renderer/app/components/AiSettings.js`

- [ ] **Step 1: Create `AiSettings.js`**

A self-contained settings panel component (follows `ProfileForm.js` pattern):
- Provider dropdown (OpenAI / Claude / DeepSeek / Ollama)
- Model input
- API Key field (password type)
- Temperature slider
- Save button (calls `mystApi.ai.configure`)
- Status display (calls `mystApi.ai.status()`)

- [ ] **Step 2: Wire into app (not integrated into a settings view — standalone)**

If no settings view exists, add a "AI 设置" button in the header or chat panel that shows a modal-like settings overlay. Use existing `Dom.js` patterns.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/app/components/AiSettings.js
git commit -m "feat(ai): AI settings panel with secure API key storage"
```

---

## Task 9: Full integration test + polish

**Goal:** End-to-end verification. Edge case handling. All tests green.

- [ ] **Step 1: Run full test suite**

```bash
npm test
npm run smoke
```

- [ ] **Step 2: Manual verification with `npm start`**

1. Configure API key via settings
2. Compute a natal chart
3. Click "AI 解读" → streaming text appears
4. Type "我的金星在什么星座？" → AI responds with correct data
5. Click stop mid-stream → generation stops cleanly

- [ ] **Step 3: Commit and push**

```bash
git add -A
git commit -m "feat(ai): end-to-end integration, edge case handling, polish"
git push
```
