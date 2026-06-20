# AI 侧边栏 + 上下文感知 + 设置面板 · Design Spec

> 日期：2026-06-20
> 分支：`feat/ai-sidebar`
> 状态：待 review

## 0. 背景与动机

当前 AI 组件存在以下问题：

1. **无设置 UI**：用户无法在界面中配置 API Key 和供应商，只能手动编辑 `config.json` + `ai-credentials.json`。
2. **AI 面板非全局**：ChatPanel 嵌在 `ChartWorkbenchView` 底部，仅在星盘页面可见，档案/八字/节气页面无法使用 AI。
3. **上下文不传递**：`chat()` 调用时传入空 `{}` 上下文，AI 不知道用户当前在看什么盘。
4. **IPC 事件不完整**：`ai:done` / `ai:error` 从未被推送，Preload 注册的监听器是死代码。
5. **知识库无管理 UI**：`knowledge.list()` 存在但从未被渲染层调用。

本设计解决以上全部问题。

---

## 1. 架构总览

```
┌─────────────────────────── App Shell ──────────────────────────────────────┐
│ ┌──────────┐ ┌─────────────────────────┐ ┌──────────────┐                  │
│ │ Sidebar  │ │    Main Content         │ │  AiSidebar   │                  │
│ │ (228px)  │ │     (1fr)               │ │   (380px)    │                  │
│ │          │ │                         │ │   可折叠      │                  │
│ │ ☰ 档案   │ │  [当前路由的视图]        │ │  对话面板     │                  │
│ │ ☉ 个人   │ │                         │ │  工具调用指示  │                  │
│ │ ☍ 合盘   │ │                         │ │              │                  │
│ │ ☯ 八字   │ │                         │ │  [输入框]     │                  │
│ │ ◇ 节气   │ │                         │ │  [发送][解读] │                  │
│ │ ⚙ 设置   │ │                         │ │              │                  │
│ └──────────┘ └─────────────────────────┘ └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**设计决策**：

1. **右侧可折叠面板**：AI 面板是 App shell 的一部分，全局可见，跨所有路由。折叠时 grid 两栏，展开时三栏。
2. **Agent 自主工具调用**：不维护全局自动注入的上下文状态。Agent 通过 Tool（`get_current_chart` / `get_active_profile`）主动查询当前上下文。渲染层在用户操作时通过 `ai:setContext` IPC 推送轻量上下文快照到 Main 进程。
3. **全局设置路由**：左侧导航新增 `⚙ 设置` 路由，AI 配置是其中的核心分区。

---

## 2. App Shell 布局改造

### 2.1 Grid 布局

`Layout.css` 的 `.app-shell` 从两栏改为三栏：

```css
.app-shell {
  display: grid;
  grid-template-columns: var(--sidebar-width, 228px) 1fr 380px;
  grid-template-rows: 100vh;
  height: 100vh;
}
```

折叠时通过 CSS class 切换：

```css
.app-shell.ai-collapsed {
  grid-template-columns: var(--sidebar-width, 228px) 1fr;
}
.app-shell.ai-collapsed .ai-sidebar { display: none; }
```

### 2.2 Header Toggle 按钮

`app-header` 右侧添加 AI toggle 按钮，点击切换 `.ai-collapsed` class。按钮显示 AI 图标（如 `✦`），激活时高亮。

### 2.3 App.js 改动

- `_buildShell()` 中创建 `AiSidebar` 实例，将其 DOM 元素作为第三个 grid child 挂载。
- 新增 `toggleAiSidebar()` 方法。
- `navigate()` / `store.subscribe()` 时更新 `currentContext` 并推送给 Main。

---

## 3. 上下文管线（Renderer → Main）

### 3.1 currentContext 对象

App.js 维护一个 `currentContext` 对象：

```js
{
  route: 'personal' | 'relationship' | 'chinese' | 'solarTerms' | 'profiles' | 'settings',
  activeProfile: { id, nameZh, birthData: { year, month, day, hour, minute, location } } | null,
  lastChartData: { ...ChartDataDTO } | null,
  chartType: 'natal' | 'transit' | 'synastry' | ... | null,
}
```

### 3.2 触发时机

| 事件 | 更新内容 |
|---|---|
| `navigate(route)` | `route` |
| `selectedPrimaryId` 变化 | `activeProfile` |
| `_compute()` 成功 | `lastChartData` + `chartType` |

### 3.3 IPC 通道

新增 `ai:setContext` 通道（invoke，renderer→main）：

```js
// Preload.js
setContext: (context) => invoke('ai:setContext', context),

// IpcRouter.js
this._handle('ai:setContext', (_e, context) => {
  this.ai.setContext(context);
  return { ok: true };
});
```

### 3.4 AiService 存储

`AiService` 新增 `setContext(context)` 方法，存储为 `this._context`。上下文工具从此读取。

---

## 4. 上下文工具（AstroToolkit 扩展）

在现有 4 个计算工具（natal / transit / synastry / bazi）基础上，新增 3 个上下文查询工具和 2 个计算工具。

### 4.1 上下文查询工具

这 3 个工具不需要用户输入参数，从 `AiService._context` 读取。

#### `get_current_context`

```js
new DynamicStructuredTool({
  name: 'get_current_context',
  description: '查询用户当前正在查看的页面和选中的档案信息。无需输入参数。返回当前路由、选中档案摘要、最后计算的星盘类型。',
  schema: z.object({}),  // 无参数
  func: async () => {
    const ctx = astrologyService._aiContext || {};
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
})
```

#### `get_current_chart`

```js
new DynamicStructuredTool({
  name: 'get_current_chart',
  description: '获取用户当前打开的星盘完整数据（行星位置、宫位、相位等）。无需输入参数。如果用户尚未计算任何星盘，返回提示。',
  schema: z.object({}),
  func: async () => {
    const ctx = astrologyService._aiContext || {};
    if (!ctx.lastChartData) return '用户尚未计算任何星盘。';
    return _serializeChart(ctx.lastChartData);
  },
})
```

#### `get_active_profile`

```js
new DynamicStructuredTool({
  name: 'get_active_profile',
  description: '获取当前选中档案的出生信息（姓名、出生日期时间、出生地经纬度）。无需输入参数。',
  schema: z.object({}),
  func: async () => {
    const ctx = astrologyService._aiContext || {};
    const p = ctx.activeProfile;
    if (!p) return '当前没有选中的档案。';
    const b = p.birthData || {};
    const loc = b.location || {};
    return `${p.nameZh || p.nameEn || '未命名'}，${b.year}年${b.month}月${b.day}日 ${b.hour}:${String(b.minute).padStart(2,'0')}，${loc.label || ''}（${loc.latitude}°N, ${loc.longitude}°E）`;
  },
})
```

**接线方式**：`AstroToolkit.createTools()` 增加参数 `aiService`（或直接传入 context getter），上下文工具通过闭包读取 `aiService.getContext()`。

### 4.2 新增计算工具

#### `compute_solar_return`

```js
new DynamicStructuredTool({
  name: 'compute_solar_return',
  description: '计算某人的太阳返照盘（Solar Return），分析指定年份的年运主题。需要出生数据和目标年份。',
  schema: z.object({
    ...birthSchema,
    targetYear: z.number().int().describe('返照年份'),
  }),
  func: async (input) => {
    const profile = _makeProfile('查询对象', input);
    const chart = astrologyService.computeChart({
      type: 'solarReturn',
      primary: profile,
      options: { year: input.targetYear },
    });
    return _serializeChart(chart);
  },
})
```

#### `compute_progressed`

```js
new DynamicStructuredTool({
  name: 'compute_progressed',
  description: '计算某人的次限推运盘（Secondary Progressions），分析生命历程的内在发展。需要出生数据和目标日期。',
  schema: z.object({
    ...birthSchema,
    targetYear: z.number().int().describe('目标年份'),
    targetMonth: z.number().int().min(1).max(12).describe('目标月份'),
    targetDay: z.number().int().min(1).max(31).describe('目标日期'),
  }),
  func: async (input) => {
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
  },
})
```

### 4.3 完整工具列表（9 个）

| # | Tool 名 | 类型 | 说明 |
|---|---|---|---|
| 1 | `compute_natal_chart` | 计算 | 本命盘 |
| 2 | `compute_transit` | 计算 | 行运盘 |
| 3 | `compute_synastry` | 计算 | 比较盘 |
| 4 | `compute_bazi` | 计算 | 八字 |
| 5 | `compute_solar_return` | 计算 | 太阳返照盘（新增） |
| 6 | `compute_progressed` | 计算 | 次限推运盘（新增） |
| 7 | `get_current_context` | 上下文 | 查询当前页面/档案/星盘类型（新增） |
| 8 | `get_current_chart` | 上下文 | 获取当前打开的星盘数据（新增） |
| 9 | `get_active_profile` | 上下文 | 获取选中档案的出生信息（新增） |

加上 `ChainFactory` 动态注入的 `search_knowledge`（RAG），Agent 共有 10 个工具可用。

---

## 5. AiSidebar 组件

### 5.1 职责

从 `ChartWorkbenchView` 中抽取 AI 面板逻辑，提升为全局 App 级组件。

### 5.2 结构

```
AiSidebar
├── Header: "AI 占星顾问" + 折叠按钮
├── StatusBanner: 未配置时显示"前往设置"链接
├── ChatPanel (复用现有组件)
│   ├── 消息列表 (用户 / AI / 工具调用)
│   ├── 输入框 + 发送按钮
│   └── "AI 解读"按钮 (当有 lastChartData 时可用)
└── (折叠时整个面板 display: none)
```

### 5.3 新文件

| 文件 | 职责 |
|---|---|
| `src/renderer/app/components/AiSidebar.js` | 全局 AI 侧边栏组件 |

### 5.4 ChatPanel 改造

现有 `ChatPanel` 基本不变，但 `onInterpret` / `onSend` 回调的调用方从 `ChartWorkbenchView` 改为 `AiSidebar`。

`AiSidebar` 负责：
- 调用 `mystApi.ai.status()` 检查配置状态，未配置时显示提示。
- `onInterpret` → 调用 `mystApi.ai.interpret(currentContext.lastChartData, ...)`。
- `onSend` → 调用 `mystApi.ai.chat(messages, {})`，Agent 自主调用工具。
- 注册 / 清理 `onToken` / `onDone` / `onError` 监听器。

### 5.5 ChartWorkbenchView 清理

移除以下内容：
- `chatCol` div 及其引用
- `_showChatPanel()` 方法
- `_onAiInterpret()` 方法
- `_onAiChat()` 方法
- `_aiSessionId` 属性
- `ChatPanel` import

ChartWorkbenchView 仅负责星盘计算和渲染，不再处理 AI。

---

## 6. 设置路由

### 6.1 新增路由

左侧导航新增 `⚙ 设置` 项：

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

### 6.2 SettingsView

**新文件**：`src/renderer/app/views/SettingsView.js`

**布局**：

```
┌── 设置 ──────────────────────────────┐
│                                      │
│  ── AI 配置 ──────────────────────    │
│  供应商: [OpenAI ▼]                   │
│  模型:   [gpt-4o          ]          │
│  API Key: [*************** ] 已配置✓  │
│  Temperature: ━━━●━━━ 0.7           │
│  Max Tokens:  ━━━●━━━ 4096          │
│  [保存配置]                           │
│                                      │
│  ── 知识库 ───────────────────────    │
│  内置文档 (10)                        │
│  • planets-in-signs.md                │
│  • planets-in-houses.md               │
│  ...                                 │
│  用户文档 (0)                         │
│  [导入文档]                           │
│                                      │
│  ── 状态 ────────────────────────    │
│  服务状态: ✓ 已配置                    │
│  供应商: OpenAI                      │
│  模型: gpt-4o                        │
│  知识库: 10 篇文档                    │
│                                      │
└──────────────────────────────────────┘
```

**交互**：

- 供应商下拉：OpenAI / Anthropic / DeepSeek / Ollama
- 模型输入：自由文本，默认值跟随供应商
- API Key：密码框，保存后显示"已配置 ✓"，不回显明文
- Temperature：range slider 0.0–1.0
- Max Tokens：range slider 512–8192
- 保存按钮：调用 `mystApi.ai.configure(settings)`
- 状态区：页面加载时调用 `mystApi.ai.status()` 刷新
- 知识库：调用 `mystApi.ai.knowledge.list()` 列出文档
- 导入文档：调用 `dialog.showOpenDialog()` → `ai:knowledge:import`

### 6.3 供应商/模型映射

| Provider | 模型选项 | API Key 必需 |
|---|---|---|
| OpenAI | gpt-4o, gpt-4o-mini | 是 |
| Anthropic | claude-sonnet-4-6, claude-haiku-4-5 | 是 |
| DeepSeek | deepseek-chat, deepseek-reasoner | 是 |
| Ollama | qwen2.5:7b, llama3.1:8b（用户可自定义） | 否 |

---

## 7. IPC 修复与新增

### 7.1 修复：ai:done / ai:error 推送

`IpcRouter.js` 中 `ai:interpret` 和 `ai:chat` 的 handler 在流结束后发送 `ai:done`，异常时发送 `ai:error`：

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

`ai:chat` 同理。

### 7.2 新增通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `ai:setContext` | invoke (renderer→main) | 推送当前上下文快照 |
| `ai:knowledge:import` | invoke | 导入知识文档（文件路径数组） |
| `ai:knowledge:remove` | invoke | 删除知识文档（docId） |

### 7.3 Preload 扩展

```js
ai: {
  // ... 已有 ...
  setContext: (context) => invoke('ai:setContext', context),
  onDone: (callback) => ipcRenderer.on('ai:done', (_e, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('ai:error', (_e, data) => callback(data)),
  knowledge: {
    list: () => invoke('ai:knowledge:list'),
    import: (filePaths) => invoke('ai:knowledge:import', filePaths),
    remove: (docId) => invoke('ai:knowledge:remove', docId),
  },
},
```

---

## 8. AiService 改动

### 8.1 setContext 方法

```js
setContext(context) {
  this._context = context;
}
```

### 8.2 AstroToolkit 接线

`createTools()` 增加参数，上下文工具通过闭包读取：

```js
async function createTools(astrologyService, chineseAstrologyService, aiService) {
  // ... 现有 4 个计算工具 ...
  // ... 新增 2 个计算工具 ...
  // ... 新增 3 个上下文工具（从 aiService._context 读取）...
}
```

`AiService.configure()` 中调用 `createTools(this._astrology, this._chinese, this)`。

### 8.3 KnowledgeBase 导入/删除

`KnowledgeBase.js` 新增：

```js
async importDocuments(filePaths) {
  // 对每个文件：load → split → embed → add to store
}

async removeDocument(docId) {
  // 从 store 中删除指定文档的所有 chunk
}
```

---

## 9. CSS 新增

### 9.1 AiSidebar 布局

```css
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
```

### 9.2 Header Toggle 按钮

```css
.ai-toggle-btn {
  /* 复用现有 .btn .btn-sm 样式 */
}
.ai-toggle-btn.is-active {
  background: var(--accent-violet-soft);
  color: var(--accent);
}
```

### 9.3 设置页

```css
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
}
.settings-row .input,
.settings-row .select {
  flex: 1;
}
.knowledge-list {
  max-height: 200px;
  overflow-y: auto;
  font-size: var(--fs-sm);
}
.knowledge-list-item {
  display: flex;
  justify-content: space-between;
  padding: var(--sp-1) 0;
  border-bottom: 1px solid var(--border-soft);
}
```

---

## 10. 文件清单

### 新增文件

| 文件 | 职责 |
|---|---|
| `src/renderer/app/components/AiSidebar.js` | 全局 AI 侧边栏组件 |
| `src/renderer/app/views/SettingsView.js` | 全局设置页（AI 配置 + 知识库管理） |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src/renderer/app/App.js` | 三栏布局、AiSidebar 挂载、toggle 逻辑、currentContext 管理、`ai:setContext` 推送、新增 settings 路由 |
| `src/renderer/styles/Layout.css` | `.app-shell` 三栏 grid + `.ai-collapsed` class |
| `src/renderer/styles/Components.css` | AiSidebar 样式、设置页样式、header toggle 按钮样式 |
| `src/renderer/app/views/ChartWorkbenchView.js` | 移除 AI 相关代码（chatCol / _showChatPanel / _onAiInterpret / _onAiChat / ChatPanel import） |
| `src/main/IpcRouter.js` | 新增 `ai:setContext` / `ai:knowledge:import` / `ai:knowledge:remove` 通道；修复 `ai:interpret` / `ai:chat` 发送 `ai:done` / `ai:error` |
| `src/preload/Preload.js` | 新增 `setContext` / `knowledge.import` / `knowledge.remove` / `onDone` / `onError` |
| `src/core/ai/AiService.js` | 新增 `setContext()` / `getContext()`；`createTools` 传入 aiService 引用 |
| `src/core/ai/AstroToolkit.js` | 新增 3 个上下文工具 + 2 个计算工具；`createTools` 增加 `aiService` 参数 |
| `src/core/ai/KnowledgeBase.js` | 新增 `importDocuments()` / `removeDocument()` |
| `src/main/Main.js` | IpcRouter 注入 webContents（修复 push 通道） |
| `locale/zh.json` | 新增设置页 + AI 侧边栏相关 i18n key |

---

## 11. 数据流总览

### 11.1 上下文更新流

```
用户切换页面 / 选档案 / 计算星盘
    │
    ▼ App.js 更新 currentContext
    │
    ▼ mystApi.ai.setContext(context)
    │
    ▼ IPC → IpcRouter → AiService.setContext()
    │
    ▼ 存入 this._context
    │
    ▼ Agent 调用 get_current_chart / get_active_profile
    │
    ▼ Tool 从 AiService._context 读取 → 返回给 LLM
```

### 11.2 AI 解读流

```
用户点击"AI 解读"
    │
    ▼ AiSidebar 调用 mystApi.ai.interpret(currentContext.lastChartData, ...)
    │
    ▼ IPC → IpcRouter → AiService.interpret()
    │
    ▼ ChartSerializer.toText() → RAG → prompt → LLM.stream()
    │
    ▼ 逐 token → ai:token → Preload → AiSidebar.appendToken()
    │
    ▼ 完成 → ai:done → AiSidebar.finishStreaming()
```

### 11.3 AI 对话流（含工具调用）

```
用户输入: "帮我看看今年的行运"
    │
    ▼ AiSidebar 调用 mystApi.ai.chat([{role:'user', content:'...'}], {})
    │
    ▼ IPC → IpcRouter → AiService.chat()
    │
    ▼ LLM 判断需要当前星盘数据
    │  → 调用 get_current_chart tool
    │  → ai:tool-call → AiSidebar.showToolCall('get_current_chart')
    │  → 返回星盘文本给 LLM
    │
    ▼ LLM 判断需要计算行运
    │  → 调用 compute_transit tool
    │  → ai:tool-call → AiSidebar.showToolCall('compute_transit')
    │  → 返回行运盘文本给 LLM
    │
    ▼ LLM 综合分析 → 逐 token 推送
    │
    ▼ 完成 → ai:done
```

---

## 12. 不在本次范围内

- ❌ 对话历史持久化（关闭应用即清除）
- ❌ 多会话管理（同一时间只有一个对话）
- ❌ 流式输出进度条 / token 计数
- ❌ 知识库文档在线编辑
- ❌ Ollama 自动检测本地模型列表
- ❌ 多语言 UI（目前仅中文）
