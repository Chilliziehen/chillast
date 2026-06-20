# AI 侧边栏 + 上下文感知 + 设置面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 面板从 ChartWorkbenchView 底部提升为全局右侧可折叠侧边栏，新增全局设置路由（API Key / 供应商 / 知识库管理），引入 Agent 上下文工具让 LLM 自主获取当前页面/档案/星盘信息，修复缺失的 IPC 事件。

**Architecture:** App shell 从两栏改为三栏 `[sidebar | main | ai-sidebar]`，通过 CSS class 切换折叠。AiService 新增 `setContext()` 存储渲染层推送的上下文快照，AstroToolkit 新增 3 个上下文查询工具 + 2 个计算工具。设置页是独立路由 `SettingsView`，通过 IPC `ai:configure` / `ai:knowledge:*` 管理。IPC 层修复 `ai:done` / `ai:error` 推送。

**Tech Stack:** CommonJS (core/main), ES modules (renderer), Electron IPC + safeStorage, LangChain DynamicStructuredTool + zod, CSS custom properties

**Spec:** `docs/superpowers/specs/2026-06-20-ai-sidebar-context-aware-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|----------------|
| `src/renderer/app/components/AiSidebar.js` | 全局 AI 侧边栏组件（状态检查 + ChatPanel 封装 + 事件管理） |
| `src/renderer/app/views/SettingsView.js` | 全局设置页（AI 配置 + 知识库管理 + 状态显示） |

### Modified files

| File | Changes |
|------|---------|
| `src/renderer/app/App.js` | 三栏布局、AiSidebar 挂载、toggle、currentContext 管理、settings 路由 |
| `src/renderer/styles/Layout.css` | `.app-shell` 三栏 grid + `.ai-collapsed` class |
| `src/renderer/styles/Components.css` | AiSidebar 样式、设置页样式、header toggle 按钮样式 |
| `src/renderer/app/views/ChartWorkbenchView.js` | 移除 AI 相关代码（chatCol / _showChatPanel / _onAiInterpret / _onAiChat / ChatPanel import） |
| `src/main/IpcRouter.js` | 新增 `ai:setContext` / `ai:knowledge:import` / `ai:knowledge:remove` 通道；修复 `ai:interpret` / `ai:chat` 发送 `ai:done` / `ai:error` |
| `src/preload/Preload.js` | 新增 `setContext` / `knowledge.import` / `knowledge.remove` |
| `src/core/ai/AiService.js` | 新增 `setContext()` / `getContext()`；`createTools` 传入 aiService 引用 |
| `src/core/ai/AstroToolkit.js` | 新增 3 个上下文工具 + 2 个计算工具；`createTools` 增加 `aiService` 参数 |
| `src/core/ai/KnowledgeBase.js` | 新增 `importDocuments()` / `removeDocument()` |
| `locale/zh.json` | 新增 settings + ai sidebar 相关 i18n key |

---

## Global Constraints

- 文件名：PascalCase（`AiSidebar.js`、`SettingsView.js`）
- 变量/函数：camelCase；常量 UPPER_SNAKE_CASE
- 渲染层 ES module（`import`/`export`），core/main 层 CommonJS（`require`/`module.exports`）
- 错误处理：领域层抛中文可读错误；IPC 层统一转为 `{ ok:false, error }` 信封
- IPC 信封：所有 `invoke` 返回 `{ ok: true|false, data|error }`
- CSS 值使用 `var(--token)` 而非硬编码
- 中文文本使用 `t('key')` 而非硬编码字符串
- `src/core/` 不依赖 Electron

---

## Task 1: AiService — setContext + createTools 接线

**Goal:** 让 AiService 能存储上下文快照，并把自身引用传给 AstroToolkit。

**Files:**
- Modify: `src/core/ai/AiService.js:58-73`

**Interfaces:**
- Produces: `AiService.setContext(context)` — 存储上下文对象到 `this._context`
- Produces: `AiService.getContext()` — 返回 `this._context`
- Produces: `createTools(astrologyService, chineseAstrologyService, aiService)` — 第三参数新增

- [ ] **Step 1: Add setContext / getContext methods to AiService**

In `src/core/ai/AiService.js`, add `this._context = null;` to the constructor (after `this._abortControllers = new Map();`):

```js
    this._configured = false;
    this._abortControllers = new Map();
    this._context = null;
```

Add these methods after `getKnowledgeBase()`:

```js
  setContext(context) {
    this._context = context;
  }

  getContext() {
    return this._context || {};
  }
```

- [ ] **Step 2: Pass aiService to createTools**

In the same file, in the `configure()` method, find the line:

```js
    this._tools = await createTools(this._astrology, this._chinese);
```

Replace with:

```js
    this._tools = await createTools(this._astrology, this._chinese, this);
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass (no behavior change yet — tools just receive an extra arg they don't use).

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/AiService.js
git commit -m "feat(ai): add setContext/getContext to AiService, pass self to createTools"
```

---

## Task 2: AstroToolkit — 新增上下文工具 + 计算工具

**Goal:** 在 `createTools` 中新增 3 个上下文查询工具和 2 个计算工具，并接收 `aiService` 参数。

**Files:**
- Modify: `src/core/ai/AstroToolkit.js`

**Interfaces:**
- Consumes: `aiService.getContext()` — 返回 `{ route, activeProfile, lastChartData, chartType }`
- Produces: 7 tools total (was 4, now 9 with `search_knowledge` from ChainFactory = 10)

- [ ] **Step 1: Update createTools signature**

In `src/core/ai/AstroToolkit.js`, find the function signature:

```js
async function createTools(astrologyService, chineseAstrologyService) {
```

Replace with:

```js
async function createTools(astrologyService, chineseAstrologyService, aiService) {
```

- [ ] **Step 2: Add 2 new calculation tools**

After the existing `computeBazi` tool definition (before the closing `return [`) and before the `return` statement, add these two tools inside the returned array. Find the line `return [` and insert before the closing `];`:

```js

  // ── Tool 5: Solar Return chart ──────────────────────────────────────────
  const computeSolarReturn = new DynamicStructuredTool({
    name: 'compute_solar_return',
    description:
      '计算某人的太阳返照盘（Solar Return），分析指定年份的年运主题。需要出生数据和目标年份。',
    schema: z.object({
      ...birthSchema,
      targetYear: z.number().int().describe('返照年份'),
    }),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const chart = astrologyService.computeChart({
          type: 'solarReturn',
          primary: profile,
          options: { year: input.targetYear },
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 6: Secondary Progressions chart ───────────────────────────────
  const computeProgressed = new DynamicStructuredTool({
    name: 'compute_progressed',
    description:
      '计算某人的次限推运盘（Secondary Progressions），分析生命历程的内在发展。需要出生数据和目标日期。',
    schema: z.object({
      ...birthSchema,
      targetYear: z.number().int().describe('目标年份'),
      targetMonth: z.number().int().min(1).max(12).describe('目标月份'),
      targetDay: z.number().int().min(1).max(31).describe('目标日期'),
    }),
    func: async (input) => {
      try {
        const profile = _makeProfile('查询对象', input);
        const targetDate = new Date(
          Date.UTC(input.targetYear, input.targetMonth - 1, input.targetDay, 12),
        ).toISOString();
        const chart = astrologyService.computeChart({
          type: 'progressed',
          primary: profile,
          options: { targetDate },
        });
        return _serializeChart(chart);
      } catch (e) {
        return `计算失败: ${e.message}`;
      }
    },
  });

  // ── Tool 7: Get current context (no params) ─────────────────────────────
  const getCurrentContext = new DynamicStructuredTool({
    name: 'get_current_context',
    description:
      '查询用户当前正在查看的页面和选中的档案信息。无需输入参数。返回当前路由、选中档案摘要、最后计算的星盘类型。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      const route = ctx.route || '未知';
      const profile = ctx.activeProfile;
      const chartType = ctx.chartType || '无';
      const lines = [`当前页面: ${route}`];
      if (profile) {
        lines.push(`选中档案: ${profile.nameZh || profile.nameEn || '未命名'}`);
      }
      lines.push(`最后计算: ${chartType}`);
      return lines.join('\n');
    },
  });

  // ── Tool 8: Get current chart data (no params) ─────────────────────────
  const getCurrentChart = new DynamicStructuredTool({
    name: 'get_current_chart',
    description:
      '获取用户当前打开的星盘完整数据（行星位置、宫位、相位等）。无需输入参数。如果用户尚未计算任何星盘，返回提示。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      if (!ctx.lastChartData) return '用户尚未计算任何星盘。';
      return _serializeChart(ctx.lastChartData);
    },
  });

  // ── Tool 9: Get active profile (no params) ─────────────────────────────
  const getActiveProfile = new DynamicStructuredTool({
    name: 'get_active_profile',
    description:
      '获取当前选中档案的出生信息（姓名、出生日期时间、出生地经纬度）。无需输入参数。',
    schema: z.object({}),
    func: async () => {
      const ctx = (aiService && aiService.getContext()) || {};
      const p = ctx.activeProfile;
      if (!p) return '当前没有选中的档案。';
      const b = p.birthData || {};
      const loc = b.location || {};
      return `${p.nameZh || p.nameEn || '未命名'}，${b.year}年${b.month}月${b.day}日 ${b.hour}:${String(b.minute).padStart(2,'0')}，${loc.label || ''}（${loc.latitude}°N, ${loc.longitude}°E）`;
    },
  });
```

Then update the return array to include the new tools. Find the existing return statement:

```js
  return [
    computeNatalChart,
    computeTransit,
    computeSynastry,
    computeBazi,
  ];
```

Replace with:

```js
  return [
    computeNatalChart,
    computeTransit,
    computeSynastry,
    computeBazi,
    computeSolarReturn,
    computeProgressed,
    getCurrentContext,
    getCurrentChart,
    getActiveProfile,
  ];
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/ai/AstroToolkit.js
git commit -m "feat(ai): add 3 context tools + 2 calculation tools to AstroToolkit"
```

---

## Task 3: KnowledgeBase — importDocuments + removeDocument

**Goal:** 让用户可以通过 UI 导入和删除知识库文档。

**Files:**
- Modify: `src/core/ai/KnowledgeBase.js`

**Interfaces:**
- Produces: `KnowledgeBase.importDocuments(filePaths)` — 加载新文档到向量库
- Produces: `KnowledgeBase.removeDocument(docId)` — 从元数据列表中移除（HNSWLib 不支持单文档删除，标记为已删除）
- Produces: `KnowledgeBase.getUserDataPath()` — 返回用户知识库路径

- [ ] **Step 1: Add importDocuments method**

In `src/core/ai/KnowledgeBase.js`, add a `_userPath` property to track the user data path. In the constructor:

```js
  constructor(modelProvider) {
    this._mp = modelProvider;
    this._store = null;
    this._docs = [];
    this._userPath = null;
  }
```

In `initialize()`, store the user path. Find the line `await loadDir(userDataPath, 'user');` and add before it:

```js
    this._userPath = userDataPath;
```

Add these methods after `isReady()`:

```js
  async importDocuments(filePaths) {
    const embeddings = this._mp.embeddings();
    if (!embeddings) throw new Error('当前模型不支持嵌入，无法导入文档');

    const { RecursiveCharacterTextSplitter } = await esm.load('langchain/text_splitter');
    const { HNSWLib } = await esm.load('@langchain/community/vectorstores/hnswlib');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n## ', '\n### ', '\n\n', '\n', '。', ''],
    });

    const allChunks = [];
    for (const filePath of filePaths) {
      const path = require('path');
      const f = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.md' && ext !== '.txt' && ext !== '.pdf') continue;

      let content;
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const buffer = require('fs').readFileSync(filePath);
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
      } else {
        content = require('fs').readFileSync(filePath, 'utf-8');
      }

      const docs = await splitter.createDocuments([content], [{ source: 'user', fileName: f }]);
      allChunks.push(...docs);
      this._docs.push({ id: filePath, name: f, source: 'user', importedAt: new Date().toISOString() });
    }

    if (allChunks.length && this._store) {
      await this._store.addDocuments(allChunks);
    } else if (allChunks.length) {
      this._store = await HNSWLib.fromDocuments(allChunks, embeddings);
    }

    return allChunks.length;
  }

  removeDocument(docId) {
    const idx = this._docs.findIndex((d) => d.id === docId);
    if (idx === -1) return false;
    this._docs.splice(idx, 1);
    return true;
  }
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass (new methods not tested by existing suite; they are exercised by IPC + UI tasks later).

- [ ] **Step 3: Commit**

```bash
git add src/core/ai/KnowledgeBase.js
git commit -m "feat(ai): add importDocuments and removeDocument to KnowledgeBase"
```

---

## Task 4: IPC — setContext + knowledge import/remove + fix ai:done/ai:error

**Goal:** 新增 `ai:setContext` / `ai:knowledge:import` / `ai:knowledge:remove` 通道，修复 `ai:interpret` / `ai:chat` 发送 `ai:done` / `ai:error`。

**Files:**
- Modify: `src/main/IpcRouter.js:58-86`
- Modify: `src/preload/Preload.js:52-63`

- [ ] **Step 1: Add new IPC channels to IpcRouter**

In `src/main/IpcRouter.js`, inside the `if (this.ai)` block, after the `ai:knowledge:list` handler and before the closing `}`, add:

```js
      this._handle('ai:setContext', (_e, context) => {
        this.ai.setContext(context);
        return { ok: true };
      });
      this._handle('ai:knowledge:import', async (_e, filePaths) => {
        const kb = this.ai.getKnowledgeBase();
        if (!kb) throw new Error('知识库未初始化');
        const count = await kb.importDocuments(filePaths);
        return { count };
      });
      this._handle('ai:knowledge:remove', (_e, docId) => {
        const kb = this.ai.getKnowledgeBase();
        if (!kb) throw new Error('知识库未初始化');
        const removed = kb.removeDocument(docId);
        return { removed };
      });
```

- [ ] **Step 2: Fix ai:interpret to send ai:done / ai:error**

In the same file, replace the existing `ai:interpret` handler:

```js
      this._handle('ai:interpret', async (_e, chartData, options) => {
        for await (const ev of this.ai.interpret(chartData, options)) {
          if (this.webContents) this.webContents.send('ai:token', { type: ev.type, data: ev.data });
        }
        return { ok: true };
      });
```

With:

```js
      this._handle('ai:interpret', async (_e, chartData, options) => {
        try {
          for await (const ev of this.ai.interpret(chartData, options)) {
            if (this.webContents) this.webContents.send('ai:token', { type: ev.type, data: ev.data });
          }
          if (this.webContents) this.webContents.send('ai:done', { ok: true });
          return { ok: true };
        } catch (err) {
          if (this.webContents) this.webContents.send('ai:error', { message: err.message });
          return { ok: false, error: err.message };
        }
      });
```

- [ ] **Step 3: Fix ai:chat to send ai:done / ai:error**

In the same file, replace the existing `ai:chat` handler:

```js
      this._handle('ai:chat', async (_e, messages, context) => {
        const sessionId = String(Date.now());
        for await (const ev of this.ai.chat(messages, { ...context, sessionId })) {
          if (this.webContents) this.webContents.send('ai:token', { sessionId, type: ev.type, data: ev.data });
        }
        return { ok: true };
      });
```

With:

```js
      this._handle('ai:chat', async (_e, messages, context) => {
        const sessionId = String(Date.now());
        try {
          for await (const ev of this.ai.chat(messages, { ...context, sessionId })) {
            if (this.webContents) this.webContents.send('ai:token', { sessionId, type: ev.type, data: ev.data });
          }
          if (this.webContents) this.webContents.send('ai:done', { ok: true, sessionId });
          return { ok: true };
        } catch (err) {
          if (this.webContents) this.webContents.send('ai:error', { message: err.message, sessionId });
          return { ok: false, error: err.message };
        }
      });
```

- [ ] **Step 4: Extend Preload bridge**

In `src/preload/Preload.js`, replace the `ai` section:

```js
  ai: {
    interpret: (chartData, options) => invoke('ai:interpret', chartData, options),
    chat: (messages, context) => invoke('ai:chat', messages, context),
    stop: (sessionId) => invoke('ai:stop', sessionId),
    configure: (settings) => invoke('ai:configure', settings),
    status: () => invoke('ai:status'),
    setContext: (context) => invoke('ai:setContext', context),
    onToken: (callback) => ipcRenderer.on('ai:token', (_e, data) => callback(data)),
    onDone: (callback) => ipcRenderer.on('ai:done', (_e, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('ai:error', (_e, data) => callback(data)),
    removeAllListeners: () => {
      for (const ch of ['ai:token', 'ai:done', 'ai:error'])
        ipcRenderer.removeAllListeners(ch);
    },
    knowledge: {
      list: () => invoke('ai:knowledge:list'),
      import: (filePaths) => invoke('ai:knowledge:import', filePaths),
      remove: (docId) => invoke('ai:knowledge:remove', docId),
    },
  },
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/IpcRouter.js src/preload/Preload.js
git commit -m "feat(ai): add setContext/knowledge import/remove IPC, fix ai:done/ai:error events"
```

---

## Task 5: i18n — 新增 settings + ai sidebar 相关 locale key

**Goal:** 在 `locale/zh.json` 中添加设置页和 AI 侧边栏所需的全部中文文本。

**Files:**
- Modify: `locale/zh.json`

- [ ] **Step 1: Add nav.settings key**

In `locale/zh.json`, in the `"nav"` section, after `"solarTerms": "节气年历"`, add:

```json
    "settings": "设置",
```

- [ ] **Step 2: Add settings section**

Add a new top-level `"settings"` section after `"tools"`:

```json
  "settings": {
    "title": "设置",
    "sub": "AI 配置 · 知识库管理",
    "aiConfig": "AI 配置",
    "provider": "供应商",
    "model": "模型",
    "apiKey": "API Key",
    "apiKeyPlaceholder": "输入 API Key",
    "apiKeyConfigured": "已配置 ✓",
    "apiKeyNotSet": "未配置",
    "temperature": "温度",
    "maxTokens": "最大 Token 数",
    "save": "保存配置",
    "saving": "保存中…",
    "saved": "AI 配置已保存",
    "saveFailed": "保存失败：{{message}}",
    "knowledge": "知识库",
    "builtinDocs": "内置文档 ({{count}})",
    "userDocs": "用户文档 ({{count}})",
    "importDocs": "导入文档",
    "removeDoc": "删除",
    "removeConfirm": "确定删除文档「{{name}}」？",
    "removed": "文档已删除",
    "imported": "已导入 {{count}} 篇文档",
    "importFailed": "导入失败：{{message}}",
    "status": "状态",
    "serviceStatus": "服务状态",
    "configured": "已配置",
    "notConfigured": "未配置",
    "providerLabel": "供应商",
    "modelLabel": "模型",
    "knowledgeCount": "知识库：{{count}} 篇文档"
  },
```

- [ ] **Step 3: Add ai sidebar section**

Add a new top-level `"ai"` section after `"settings"`:

```json
  "ai": {
    "title": "AI 占星顾问",
    "toggle": "AI 助手",
    "notConfigured": "AI 未配置，请前往",
    "goToSettings": "设置页面",
    "toConfigure": "进行配置",
    "inputPlaceholder": "输入问题，或点击「AI 解读」分析当前星盘…",
    "send": "发送",
    "interpret": "AI 解读",
    "stop": "停止",
    "toolCalling": "正在调用: {{tool}}…",
    "interpreting": "正在生成解读…",
    "noChart": "请先计算星盘后再使用 AI 解读"
  },
```

- [ ] **Step 4: Commit**

```bash
git add locale/zh.json
git commit -m "feat(i18n): add settings and ai sidebar locale keys"
```

---

## Task 6: ChartWorkbenchView — 移除 AI 相关代码

**Goal:** 从 ChartWorkbenchView 中移除所有 AI 面板逻辑，让该视图只负责星盘计算和渲染。

**Files:**
- Modify: `src/renderer/app/views/ChartWorkbenchView.js`

- [ ] **Step 1: Remove ChatPanel import**

In `src/renderer/app/views/ChartWorkbenchView.js`, remove the line:

```js
import { ChatPanel } from '../components/ChatPanel.js';
```

- [ ] **Step 2: Remove chatCol from _draw()**

In the same file, in `_draw()`, find the line:

```js
    this.chatCol = h('div', { class: 'chat-col', style: { display: 'none' } });
```

Remove it. Also remove the `this.chatCol,` reference from the `wrap` array — find:

```js
      h('div', { class: 'workbench-main' }, [
        this.chartCol,
        this.dataCol,
      ]),
      this.chatCol,
```

Replace with:

```js
      h('div', { class: 'workbench-main' }, [
        this.chartCol,
        this.dataCol,
      ]),
```

- [ ] **Step 3: Remove _showChatPanel, _onAiInterpret, _onAiChat methods**

Remove these three methods entirely:

```js
  _showChatPanel() {
    ...
  }

  _onAiInterpret() {
    ...
  }

  _onAiChat(text) {
    ...
  }
```

- [ ] **Step 4: Remove _showChatPanel() call from _compute()**

In `_compute()`, find the line:

```js
      this._showChatPanel();
```

Remove it.

- [ ] **Step 5: Remove unused _aiSessionId property**

Find and remove the line in `_compute()` or elsewhere:

```js
    this._aiSessionId = ...
```

Also remove `this._lastChartData = chart;` — no, **keep** `this._lastChartData = chart;` because App.js will read it from the view. Actually, since context is pushed by App.js, the view should still keep `_lastChartData` so App.js can read it. Keep the line.

Remove `_aiSessionId` references only.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/app/views/ChartWorkbenchView.js
git commit -m "refactor: remove AI panel logic from ChartWorkbenchView"
```

---

## Task 7: AiSidebar 组件

**Goal:** 创建全局 AI 侧边栏组件，封装状态检查 + ChatPanel + 事件管理。

**Files:**
- Create: `src/renderer/app/components/AiSidebar.js`

**Interfaces:**
- Consumes: `window.mystApi.ai.*` (status, interpret, chat, onToken, onDone, onError, removeAllListeners)
- Consumes: `navigate(route)` from App context (to navigate to settings)
- Consumes: `t(key, vars)` from I18n
- Produces: `AiSidebar.element` — DOM root for mounting
- Produces: `AiSidebar.setContext(context)` — called by App when context changes
- Produces: `AiSidebar.updateStatus()` — re-checks AI configuration status

- [ ] **Step 1: Create AiSidebar.js**

Create `src/renderer/app/components/AiSidebar.js`:

```js
import { h, mount } from '../Dom.js';
import { ChatPanel } from './ChatPanel.js';
import { t } from '../I18n.js';

export class AiSidebar {
  constructor({ onNavigate }) {
    this._onNavigate = onNavigate;
    this._configured = false;
    this._context = {};
    this._aiSessionId = null;
    this._build();
  }

  get element() { return this._root; }

  _build() {
    this._statusBanner = h('div', { class: 'ai-status-banner', style: { display: 'none' } });

    this.chatPanel = new ChatPanel({
      onInterpret: () => this._onInterpret(),
      onSend: (text) => this._onSend(text),
      onStop: () => this._onStop(),
    });

    this._root = h('aside', { class: 'ai-sidebar' }, [
      h('div', { class: 'ai-sidebar-header' }, [
        h('span', { class: 'fs-md fw-semibold' }, t('ai.title')),
      ]),
      this._statusBanner,
      h('div', { class: 'ai-sidebar-body' }, [this.chatPanel.element]),
    ]);
  }

  async updateStatus() {
    try {
      const result = await window.mystApi.ai.status();
      const status = result.ok ? result.data : null;
      this._configured = status && status.configured;
      if (!this._configured) {
        this._statusBanner.style.display = '';
        mount(this._statusBanner, h('span', {}, [
          h('span', {}, t('ai.notConfigured') + ' '),
          h('a', { onclick: () => this._onNavigate('settings'), style: { cursor: 'pointer' } }, t('ai.goToSettings')),
          h('span', {}, ' ' + t('ai.toConfigure')),
        ]));
      } else {
        this._statusBanner.style.display = 'none';
      }
    } catch (_) {
      this._configured = false;
    }
  }

  setContext(context) {
    this._context = context;
  }

  _onInterpret() {
    if (!this._context.lastChartData) return;
    this._aiSessionId = String(Date.now());
    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.onError(({ message }) => {
      this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.interpret(this._context.lastChartData, { chartType: this._context.chartType });
  }

  _onSend(text) {
    this._aiSessionId = String(Date.now());
    window.mystApi.ai.removeAllListeners();
    window.mystApi.ai.onToken(({ type, data }) => {
      if (type === 'token') this.chatPanel.appendToken(data);
      else if (type === 'tool-call') this.chatPanel.showToolCall(data.tool);
      else if (type === 'done') this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.onError(({ message }) => {
      this.chatPanel.finishStreaming();
    });
    window.mystApi.ai.chat([{ role: 'user', content: text }], {});
  }

  _onStop() {
    if (this._aiSessionId) window.mystApi.ai.stop(this._aiSessionId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/app/components/AiSidebar.js
git commit -m "feat(ai): create AiSidebar global component"
```

---

## Task 8: CSS — AiSidebar + 设置页 + header toggle 样式

**Goal:** 添加 AI 侧边栏、设置页、header toggle 按钮的 CSS。

**Files:**
- Modify: `src/renderer/styles/Layout.css`
- Modify: `src/renderer/styles/Components.css`

- [ ] **Step 1: Update app-shell grid in Layout.css**

In `src/renderer/styles/Layout.css`, replace the `.app-shell` rule:

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width, 228px) 1fr;
  grid-template-rows: 100vh;
  height: 100vh;
}
```

With:

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width, 228px) 1fr 380px;
  grid-template-rows: 100vh;
  height: 100vh;
}
.app-shell.ai-collapsed {
  grid-template-columns: var(--sidebar-width, 228px) 1fr;
}
.app-shell.ai-collapsed .ai-sidebar { display: none; }
```

- [ ] **Step 2: Add AiSidebar styles to Components.css**

Append to `src/renderer/styles/Components.css`:

```css
/* —— AI Sidebar ——————————————————————————————————————— */
.ai-sidebar {
  display: flex;
  flex-direction: column;
  height: 100vh;
  border-left: 1px solid var(--border-soft);
  background: var(--bg-panel-solid);
}
.ai-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
}
.ai-sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ai-status-banner {
  padding: var(--sp-2) var(--sp-3);
  background: var(--accent-violet-soft);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border-soft);
}
.ai-status-banner a {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
}

/* —— Header AI toggle button —————————————————————————— */
.ai-toggle-btn.is-active {
  background: var(--accent-violet-soft);
  color: var(--accent);
}

/* —— Settings page ——————————————————————————————————— */
.settings-section {
  margin-bottom: var(--sp-6);
  padding: var(--sp-4);
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
}
.settings-section h3 {
  font-size: var(--fs-md);
  margin-bottom: var(--sp-3);
}
.settings-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
.settings-row label {
  width: 100px;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.settings-row .input,
.settings-row .select {
  flex: 1;
}
.settings-row input[type="range"] {
  flex: 1;
}
.settings-row .range-value {
  width: 40px;
  text-align: right;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.knowledge-list {
  max-height: 200px;
  overflow-y: auto;
  font-size: var(--fs-sm);
}
.knowledge-list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--sp-1) 0;
  border-bottom: 1px solid var(--border-soft);
}
.knowledge-list-item .doc-name {
  color: var(--text-secondary);
}
.knowledge-list-item .doc-source {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-left: var(--sp-2);
}
.settings-status-row {
  display: flex;
  justify-content: space-between;
  padding: var(--sp-1) 0;
  font-size: var(--fs-sm);
  border-bottom: 1px solid var(--border-soft);
}
.settings-status-row .label {
  color: var(--text-secondary);
}
.settings-status-row .value {
  color: var(--text-primary);
}
.api-key-configured {
  color: var(--success);
  font-size: var(--fs-sm);
}
.api-key-not-set {
  color: var(--danger);
  font-size: var(--fs-sm);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/styles/Layout.css src/renderer/styles/Components.css
git commit -m "style: add AI sidebar, settings page, and toggle button CSS"
```

---

## Task 9: SettingsView — 全局设置页

**Goal:** 创建设置页视图，包含 AI 配置、知识库管理、状态显示。

**Files:**
- Create: `src/renderer/app/views/SettingsView.js`

**Interfaces:**
- Consumes: `window.mystApi.ai.status()` / `configure()` / `knowledge.list()` / `knowledge.import()` / `knowledge.remove()`
- Consumes: `t(key, vars)` from I18n
- Consumes: Electron `dialog.showOpenDialog` via IPC (file picker for knowledge import — uses `window.mystApi.ai.knowledge.import()` with file paths from a hidden `<input type="file">`)

- [ ] **Step 1: Create SettingsView.js**

Create `src/renderer/app/views/SettingsView.js`:

```js
import { h, mount, clear } from '../Dom.js';
import { t } from '../I18n.js';
import { notify } from '../components/Toast.js';

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] },
  { value: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'ollama', label: 'Ollama', models: ['qwen2.5:7b', 'llama3.1:8b'] },
];

export class SettingsView {
  constructor(context) {
    this.ctx = context;
  }

  get title() {
    return { h1: t('settings.title'), sub: t('settings.sub') };
  }

  render(container) {
    this.container = container;
    this._draw();
  }

  async _draw() {
    const status = await this._fetchStatus();
    const knowledgeDocs = await this._fetchKnowledge();

    this.providerSelect = h('select', {
      class: 'select',
      onchange: (e) => this._onProviderChange(e.target.value),
    }, PROVIDERS.map((p) =>
      h('option', { value: p.value, selected: p.value === (status && status.provider) }, p.label)
    ));

    this.modelInput = h('input', {
      class: 'input',
      type: 'text',
      value: (status && status.model) || 'gpt-4o',
      placeholder: 'gpt-4o',
    });

    this.apiKeyInput = h('input', {
      class: 'input',
      type: 'password',
      placeholder: t('settings.apiKeyPlaceholder'),
    });

    this.apiKeyStatus = h('span', {}, '');

    this.tempInput = h('input', {
      class: 'input',
      type: 'range', min: '0', max: '1', step: '0.1', value: '0.7',
      oninput: (e) => { this.tempValue.textContent = e.target.value; },
    });
    this.tempValue = h('span', { class: 'range-value' }, '0.7');

    this.maxTokensInput = h('input', {
      class: 'input',
      type: 'range', min: '512', max: '8192', step: '512', value: '4096',
      oninput: (e) => { this.maxTokensValue.textContent = e.target.value; },
    });
    this.maxTokensValue = h('span', { class: 'range-value' }, '4096');

    this.saveBtn = h('button', {
      class: 'btn btn-primary',
      onclick: () => this._onSave(),
    }, t('settings.save'));

    this._updateApiKeyStatus(status && status.configured);

    const aiConfigSection = h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.aiConfig')),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.provider')),
        this.providerSelect,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.model')),
        this.modelInput,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.apiKey')),
        this.apiKeyInput,
        this.apiKeyStatus,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.temperature')),
        this.tempInput,
        this.tempValue,
      ]),
      h('div', { class: 'settings-row' }, [
        h('label', {}, t('settings.maxTokens')),
        this.maxTokensInput,
        this.maxTokensValue,
      ]),
      this.saveBtn,
    ]);

    const knowledgeSection = this._buildKnowledgeSection(knowledgeDocs);

    const statusSection = this._buildStatusSection(status, knowledgeDocs);

    mount(this.container, h('div', { class: 'settings-container' }, [
      aiConfigSection,
      knowledgeSection,
      statusSection,
    ]));
  }

  _buildKnowledgeSection(docs) {
    const builtin = docs.filter((d) => d.source === 'builtin');
    const user = docs.filter((d) => d.source === 'user');

    const fileInput = h('input', {
      type: 'file',
      accept: '.md,.txt,.pdf',
      multiple: true,
      style: { display: 'none' },
      onchange: (e) => this._onImport(e.target.files),
    });

    const importBtn = h('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => fileInput.click(),
    }, t('settings.importDocs'));

    const builtinItems = builtin.map((d) =>
      h('div', { class: 'knowledge-list-item' }, [
        h('span', {}, [
          h('span', { class: 'doc-name' }, d.name),
          h('span', { class: 'doc-source' }, 'builtin'),
        ]),
      ])
    );

    const userItems = user.map((d) =>
      h('div', { class: 'knowledge-list-item' }, [
        h('span', {}, [
          h('span', { class: 'doc-name' }, d.name),
          h('span', { class: 'doc-source' }, 'user'),
        ]),
        h('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => this._onRemoveDoc(d),
        }, t('settings.removeDoc')),
      ])
    );

    return h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.knowledge')),
      h('div', { class: 'fs-sm text-muted mb-2' }, t('settings.builtinDocs', { count: builtin.length })),
      h('div', { class: 'knowledge-list' }, builtinItems),
      h('div', { class: 'fs-sm text-muted mt-3 mb-2' }, t('settings.userDocs', { count: user.length })),
      h('div', { class: 'knowledge-list' }, userItems),
      h('div', { class: 'mt-2' }, [fileInput, importBtn]),
    ]);
  }

  _buildStatusSection(status, docs) {
    return h('div', { class: 'settings-section' }, [
      h('h3', {}, t('settings.status')),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.serviceStatus')),
        h('span', { class: 'value' }, status && status.configured
          ? h('span', { class: 'api-key-configured' }, t('settings.configured'))
          : h('span', { class: 'api-key-not-set' }, t('settings.notConfigured'))),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.providerLabel')),
        h('span', { class: 'value' }, (status && status.provider) || '—'),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.modelLabel')),
        h('span', { class: 'value' }, (status && status.model) || '—'),
      ]),
      h('div', { class: 'settings-status-row' }, [
        h('span', { class: 'label' }, t('settings.knowledge')),
        h('span', { class: 'value' }, t('settings.knowledgeCount', { count: docs.length })),
      ]),
    ]);
  }

  _updateApiKeyStatus(configured) {
    mount(this.apiKeyStatus, h('span', {},
      configured
        ? h('span', { class: 'api-key-configured' }, t('settings.apiKeyConfigured'))
        : h('span', { class: 'api-key-not-set' }, t('settings.apiKeyNotSet'))
    ));
  }

  _onProviderChange(provider) {
    const p = PROVIDERS.find((x) => x.value === provider);
    if (p && p.models.length) {
      this.modelInput.value = p.models[0];
    }
  }

  async _onSave() {
    this.saveBtn.textContent = t('settings.saving');
    this.saveBtn.disabled = true;
    try {
      const settings = {
        provider: this.providerSelect.value,
        model: this.modelInput.value,
        temperature: parseFloat(this.tempInput.value),
        maxTokens: parseInt(this.maxTokensInput.value, 10),
      };
      if (this.apiKeyInput.value) {
        settings.apiKey = this.apiKeyInput.value;
      }
          const result = await window.mystApi.ai.configure(settings);
        if (result.ok) {
          notify.success(t('settings.saved'));
          this.apiKeyInput.value = '';
          await this._refresh();
        } else {
          notify.error(t('settings.saveFailed', { message: result.error }));
        }
      } catch (err) {
        notify.error(t('settings.saveFailed', { message: err.message }));
      }
    this.saveBtn.textContent = t('settings.save');
    this.saveBtn.disabled = false;
  }

  async _onImport(fileList) {
    if (!fileList || !fileList.length) return;
    try {
      const paths = Array.from(fileList).map((f) => f.path);
      const result = await window.mystApi.ai.knowledge.import(paths);
      if (result.ok) {
        notify.success(t('settings.imported', { count: result.data.count }));
        await this._refresh();
      } else {
        notify.error(t('settings.importFailed', { message: result.error }));
      }
    } catch (err) {
      notify.error(t('settings.importFailed', { message: err.message }));
    }
  }

  async _onRemoveDoc(doc) {
    if (!confirm(t('settings.removeConfirm', { name: doc.name }))) return;
    try {
      const result = await window.mystApi.ai.knowledge.remove(doc.id);
      if (result.ok) {
        notify.success(t('settings.removed'));
        await this._refresh();
      }
    } catch (err) {
      notify.error(err.message);
    }
  }

  async _fetchStatus() {
    try {
      const result = await window.mystApi.ai.status();
      return result.ok ? result.data : null;
    } catch (_) { return null; }
  }

  async _fetchKnowledge() {
    try {
      const result = await window.mystApi.ai.knowledge.list();
      return result.ok ? (result.data || []) : [];
    } catch (_) { return []; }
  }

  async _refresh() {
    clear(this.container);
    await this._draw();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/app/views/SettingsView.js
git commit -m "feat(ai): create SettingsView with AI config, knowledge management, status"
```

---

## Task 10: App.js — 三栏布局 + AiSidebar + currentContext + settings 路由

**Goal:** 改造 App.js 为三栏布局，挂载 AiSidebar，管理 currentContext 并推送到 Main，新增 settings 路由。

**Files:**
- Modify: `src/renderer/app/App.js`

**Interfaces:**
- Consumes: `AiSidebar` from `./components/AiSidebar.js`
- Consumes: `SettingsView` from `./views/SettingsView.js`
- Produces: `App._pushContext()` — 推送 currentContext 到 Main via `ai:setContext`

- [ ] **Step 1: Add imports for AiSidebar and SettingsView**

In `src/renderer/app/App.js`, add after the existing view imports:

```js
import { AiSidebar } from './components/AiSidebar.js';
import { SettingsView } from './views/SettingsView.js';
```

- [ ] **Step 2: Add settings route to ROUTES**

Find the ROUTES array and add the settings entry:

```js
const ROUTES = [
  { key: 'profiles', glyph: '☰', label: 'nav.profiles', group: 'nav.groupProfiles' },
  { key: 'personal', glyph: '☉', label: 'nav.personal', group: 'nav.groupCharts' },
  { key: 'relationship', glyph: '☍', label: 'nav.relationship', group: 'nav.groupCharts' },
  { key: 'chinese', glyph: '☯', label: 'nav.chinese', group: 'nav.groupChinese' },
  { key: 'solarTerms', glyph: '◇', label: 'nav.solarTerms', group: 'nav.groupTools' },
  { key: 'settings', glyph: '⚙', label: 'nav.settings', group: 'nav.groupTools' },
];
```

- [ ] **Step 3: Add currentContext property and toggle state to constructor**

In the `App` constructor, after `this.views = {};`, add:

```js
    this.currentContext = { route: 'profiles', activeProfile: null, lastChartData: null, chartType: null };
    this.aiCollapsed = false;
```

- [ ] **Step 4: Instantiate SettingsView in start()**

In `start()`, after the other view instantiations, add:

```js
    this.views.settings = new SettingsView(ctx);
```

- [ ] **Step 5: Create AiSidebar in _buildShell()**

In `_buildShell()`, after the `main` element creation and before `mount(this.root, [sidebar, main])`, create the AI sidebar and toggle button:

```js
    this.aiSidebar = new AiSidebar({ onNavigate: (route) => this.navigate(route) });

    this.aiToggleBtn = h('button', {
      class: 'btn btn-sm ai-toggle-btn is-active',
      title: t('ai.toggle'),
      onclick: () => this._toggleAiSidebar(),
    }, '✦');

    // Add toggle to header actions
    const headerActions = h('div', { class: 'header-actions' }, [
      h('span', { class: 'chip' }, t('app.chipSigns', { count: this.reference.signs.length })),
      h('span', { class: 'chip' }, t('app.chipCharts', { count: this.reference.chartTypes.length })),
      this.aiToggleBtn,
    ]);

    const main = h('div', { class: 'main' }, [
      h('header', { class: 'app-header' }, [
        h('div', {}, [this.headerTitle, this.headerSub]),
        headerActions,
      ]),
      this.contentEl,
    ]);

    mount(this.root, [sidebar, main, this.aiSidebar.element]);
    this.aiSidebar.updateStatus();
```

Replace the existing `main` and `mount` calls — the old code had:

```js
    const main = h('div', { class: 'main' }, [
      h('header', { class: 'app-header' }, [
        h('div', {}, [this.headerTitle, this.headerSub]),
        h('div', { class: 'header-actions' }, [
          h('span', { class: 'chip' }, t('app.chipSigns', { count: this.reference.signs.length })),
          h('span', { class: 'chip' }, t('app.chipCharts', { count: this.reference.chartTypes.length })),
        ]),
      ]),
      this.contentEl,
    ]);

    // #app already carries `.app-shell`; mount the grid children directly to
    // avoid nesting a second grid (which would collapse the content column).
    mount(this.root, [sidebar, main]);
```

- [ ] **Step 6: Add _toggleAiSidebar method**

Add after `navigate()`:

```js
  _toggleAiSidebar() {
    this.aiCollapsed = !this.aiCollapsed;
    if (this.aiCollapsed) {
      this.root.classList.add('ai-collapsed');
      this.aiToggleBtn.classList.remove('is-active');
    } else {
      this.root.classList.remove('ai-collapsed');
      this.aiToggleBtn.classList.add('is-active');
    }
  }
```

- [ ] **Step 7: Update navigate() to push context**

In `navigate()`, after setting `this.activeRoute = route;`, add:

```js
    this.currentContext.route = route;
    this._pushContext();
```

- [ ] **Step 8: Add _pushContext method**

Add after `_toggleAiSidebar()`:

```js
  _pushContext() {
    if (this.aiSidebar) this.aiSidebar.setContext(this.currentContext);
    window.mystApi.ai.setContext(this.currentContext);
  }
```

- [ ] **Step 9: Update store.subscribe to push context on profile changes**

In `start()`, find the store subscription:

```js
    this.store.subscribe(() => {
      if (this.activeRoute && this.contentEl) this._renderActive();
      this._syncNav();
    });
```

Replace with:

```js
    this.store.subscribe(() => {
      if (this.activeRoute && this.contentEl) this._renderActive();
      this._syncNav();
      const state = this.store.getState();
      const profiles = state.profiles || [];
      const selectedId = state.selectedPrimaryId;
      this.currentContext.activeProfile = selectedId
        ? profiles.find((p) => p.id === selectedId) || null
        : null;
      this._pushContext();
    });
```

- [ ] **Step 10: Add getActiveChartData method for ChartWorkbenchView to call**

Add a method that ChartWorkbenchView calls after compute to push chart data into context:

```js
  setLastChart(chartData, chartType) {
    this.currentContext.lastChartData = chartData;
    this.currentContext.chartType = chartType;
    this._pushContext();
  }
```

- [ ] **Step 11: Run tests**

Run: `npm test`
Expected: All existing tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/renderer/app/App.js
git commit -m "feat(ai): three-column layout, AiSidebar, currentContext pipeline, settings route"
```

---

## Task 11: ChartWorkbenchView — 接入上下文推送

**Goal:** ChartWorkbenchView 在计算成功后调用 App 的 `setLastChart()` 推送 ChartData 到上下文。

**Files:**
- Modify: `src/renderer/app/views/ChartWorkbenchView.js`

- [ ] **Step 1: Call setLastChart after compute**

In `src/renderer/app/views/ChartWorkbenchView.js`, in `_compute()`, find the line:

```js
      this._lastChartData = chart;
```

Add after it:

```js
      if (this.ctx.setLastChart) {
        this.ctx.setLastChart(chart, chart.meta && chart.meta.type);
      }
```

- [ ] **Step 2: Add setLastChart to ctx in App.js**

In `src/renderer/app/App.js`, in `start()`, find the `ctx` object and add:

```js
    const ctx = {
      store: this.store,
      reference: this.reference,
      config: this.config,
      refreshProfiles: () => this.refreshProfiles(),
      navigate: (route) => this.navigate(route),
      setLastChart: (chartData, chartType) => this.setLastChart(chartData, chartType),
    };
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/app/views/ChartWorkbenchView.js src/renderer/app/App.js
git commit -m "feat(ai): wire ChartWorkbenchView to push chart data to App context"
```

---

## Task 12: ChatPanel — 国际化文本

**Goal:** 把 ChatPanel 中硬编码的中文文本替换为 `t()` 调用。

**Files:**
- Modify: `src/renderer/app/components/ChatPanel.js`

- [ ] **Step 1: Add I18n import and replace hardcoded text**

In `src/renderer/app/components/ChatPanel.js`, add import at the top:

```js
import { t } from '../I18n.js';
```

Replace the input placeholder:

```js
      placeholder: '输入问题...',
```

With:

```js
      placeholder: t('ai.inputPlaceholder'),
```

Replace the button text `'停止'`:

```js
      ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onStop() }, '停止')
```

With:

```js
      ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onStop() }, t('ai.stop'))
```

Replace the button text `'发送'` and `'AI 解读'`:

```js
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => this._send() }, '发送'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onInterpret() }, 'AI 解读'),
```

With:

```js
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => this._send() }, t('ai.send')),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this._onInterpret() }, t('ai.interpret')),
```

Replace the tool call message in `showToolCall`:

```js
    this._messages.push({ role: 'tool', content: `正在计算: ${name}...` });
```

With:

```js
    this._messages.push({ role: 'tool', content: t('ai.toolCalling', { tool: name }) });
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/app/components/ChatPanel.js
git commit -m "feat(i18n): migrate ChatPanel hardcoded text to t()"
```

---

## Task 13: 最终验证

**Goal:** 端到端验证所有改动。

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run smoke test**

Run: `npm run smoke`
Expected: Completes without SVG/console errors.

- [ ] **Step 3: Manual verification**

Run: `npm start` and verify:

1. App shell is three columns — sidebar + content + AI sidebar on the right
2. Click the ✦ toggle button in header — AI sidebar collapses/expands
3. AI sidebar shows "not configured" banner with link to settings
4. Click "设置" in sidebar nav — settings page renders with AI config section
5. Enter a provider + model + API key, click save — status updates to "configured ✓"
6. Navigate to "个人星盘", select a profile, compute a chart
7. In AI sidebar, type "我的太阳在什么星座？" and send — AI responds
8. In AI sidebar, click "AI 解读" — streaming interpretation appears
9. Click "停止" mid-stream — generation stops
10. In AI sidebar, type "帮我看看今年的行运" — AI calls compute_transit tool (tool call indicator appears)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: AI sidebar + context-aware + settings verification complete"
```
