# AI 占星顾问系统设计 · AI Astrology Advisor Design

> 日期：2026-06-20
> 分支：`feat/ai-base`
> 状态：待 review

## 0. 背景与动机

Myst 当前是一个**纯计算型**占星工作站：引擎精确产出星盘数据（Frame → ChartData DTO），渲染层忠实绘制，但**不提供任何解读**。用户看到"太阳在白羊座 15°23′ 第七宫"后，需要自行凭占星知识做分析。

**动机**：引入大语言模型（LLM），让系统能够：

1. **自动解读**——拿到 ChartData 后，结合占星知识库，生成专业级的中文分析报告（行星落座落宫含义、相位解读、格局分析、行运预测等）。
2. **交互问答**——用户针对已计算的星盘提问（"我的金星合海王意味着什么？""今年的土星行运对我事业有何影响？"），系统调用计算引擎获取精确数据，再由 LLM 结合知识库综合作答。
3. **知识增强**——通过 RAG（Retrieval-Augmented Generation）导入专业占星书籍、论文、案例库，让 LLM 回答基于权威资料而非纯训练数据幻觉。

**选型决策**：**LangChain.js**（`langchain` + `@langchain/core`）。理由：

| 考量 | LangChain.js |
|---|---|
| 生态 | Node.js 原生，与项目 CommonJS 兼容（ESM 可通过动态 import 桥接） |
| 模型抽象 | 统一 `BaseChatModel` 接口，支持 OpenAI / Claude / Ollama / 本地模型热切换 |
| RAG 工具链 | 内置 Document Loader → Text Splitter → Embeddings → VectorStore 全链路 |
| Tool Calling | 原生支持 LLM Function Calling / Tool Use，可将占星计算封装为 Tool |
| 流式输出 | `streamEvents` / `streamLog` 支持 SSE 式逐 token 推送，适合 Electron IPC |
| 社区 & 维护 | 活跃维护，文档完善，版本迭代快 |

**已排除的替代方案**：

- **直接调 OpenAI SDK**：可行但缺 RAG 工具链、Tool 抽象、模型切换能力，后续扩展成本高。
- **Python sidecar（FastAPI + LangChain Python）**：精度更高但引入跨语言 IPC、Python 运行时打包、进程管理复杂度，不符合"纯 Electron 桌面应用"的简洁定位。
- **LlamaIndex.TS**：RAG 更专注但 Tool Calling / Agent 生态不如 LangChain 成熟。

---

## 1. 架构总览

```
┌─────────────────────────── Renderer (sandboxed) ───────────────────────────┐
│  ChatPanelView ←→ ApiClient.ai.*                                           │
│    • 用户输入问题 / 选择"自动解读"                                            │
│    • 流式接收 LLM 回答（逐 token 渲染）                                      │
│    • 展示知识来源引用                                                        │
└────────┬───────────────────────────────────────────────────────────────────┘
         │ contextBridge (IPC)
┌────────┼──────────────────────── Main process ──────────────────────────────┐
│  IpcRouter                                                                   │
│    • ai:interpret  — 自动解读一张已计算的星盘                                 │
│    • ai:chat       — 用户自由问答（流式，含 tool-calling 循环）               │
│    • ai:configure  — 运行时切换模型 / API Key / 知识库                       │
│    • ai:status     — 查询 AI 服务状态（模型、知识库加载情况）                 │
│                                                                              │
│  src/core/ai/                                                                │
│    ┌──────────────────────────────────────────────────────────┐              │
│    │  AiService (Facade)                                      │              │
│    │    • interpret(chartData, options) → stream               │              │
│    │    • chat(messages, context) → stream                     │              │
│    │    • configure(settings)                                  │              │
│    │    • status()                                             │              │
│    └────────────┬─────────────────────────────────────────────┘              │
│                 │                                                             │
│    ┌────────────┴────────────────────────────────────────────┐               │
│    │  ChainFactory                                           │               │
│    │    • 构建 interpret chain（ChartData → 结构化 prompt）   │               │
│    │    • 构建 chat chain（RAG + Tool Calling agent）         │               │
│    └────────────┬──────────────┬──────────────┬──────────────┘               │
│                 │              │              │                               │
│    ┌────────────┴───┐  ┌──────┴───────┐  ┌───┴──────────────┐               │
│    │ ModelProvider   │  │ KnowledgeBase│  │ AstroToolkit     │               │
│    │ (LLM 适配)     │  │ (RAG 向量库) │  │ (占星计算工具集) │               │
│    │ OpenAI/Claude/  │  │ 文档加载     │  │ computeChart()   │               │
│    │ Ollama/...      │  │ 切分+嵌入    │  │ computeBazi()    │               │
│    │                 │  │ 相似度检索   │  │ referenceData()  │               │
│    └─────────────────┘  └──────────────┘  └──────────────────┘               │
│                                                                              │
│  src/core/astrology/ (已有，不改动)                                           │
│    AstrologyService.computeChart() ← AstroToolkit 调用                       │
│  src/core/chinese/ (已有，不改动)                                             │
│    ChineseAstrologyService.computeBaZi() ← AstroToolkit 调用                │
└──────────────────────────────────────────────────────────────────────────────┘
```

**关键设计原则**：

1. **AI 层是消费者，不侵入计算层**——`AiService` 调用已有的 `AstrologyService` / `ChineseAstrologyService` 获取数据，绝不修改引擎或 Frame 结构。占星计算的准确性由引擎保证，AI 层只做"翻译"和"综合"。
2. **`src/core/ai/` 不依赖 Electron**——与 `src/core/astrology/` 同级，纯 Node 可测。API Key 等敏感配置由组合根 `Main.js` 注入。
3. **流式输出是一等公民**——LLM 回答天然是流式的，IPC 层用 Electron 的 `webContents.send`（push）而非 `ipcMain.handle`（request-response）传递 token 流，渲染层逐 token 渲染，用户体验远优于等全量返回。
4. **模型可切换**——通过 `ModelProvider` 抽象，用户可在设置中选择 OpenAI / Claude / 本地 Ollama，无需改代码。API Key 存在 Electron `safeStorage` 中，不进 config.json。
5. **知识库可扩展**——用户可导入自己的占星 PDF/Markdown/TXT 资料，系统自动切分、嵌入、入库。内置一套基础占星知识作为开箱即用的底线。

---

## 2. 核心模块设计

### 2.1 AiService（门面）

```
src/core/ai/
  AiService.js           ← 门面：interpret / chat / configure / status
  ChainFactory.js        ← 构建 LangChain chain / agent
  ModelProvider.js        ← LLM 实例化 + 模型切换
  KnowledgeBase.js       ← RAG：文档加载 / 嵌入 / 向量检索
  AstroToolkit.js        ← LangChain Tool 封装（占星计算）
  prompts/
    InterpretPrompt.js   ← 星盘解读的系统 prompt 模板
    ChatPrompt.js        ← 问答的系统 prompt 模板
    ChartSerializer.js   ← ChartData DTO → LLM 友好的结构化文本
```

**职责边界**：

| 模块 | 职责 | 不做 |
|---|---|---|
| `AiService` | 对外唯一入口，编排 chain 调用，管理生命周期 | 不直接调 LangChain API |
| `ChainFactory` | 组装 prompt + model + retriever + tools 为可执行 chain | 不持有状态 |
| `ModelProvider` | `new ChatOpenAI()` / `new ChatAnthropic()` / `new ChatOllama()` 的工厂 | 不做 prompt 工程 |
| `KnowledgeBase` | 文档 CRUD → 切分 → 嵌入 → 存储 → 检索 | 不做 LLM 调用 |
| `AstroToolkit` | 将 `AstrologyService` / `ChineseAstrologyService` 包装为 LangChain `DynamicStructuredTool` | 不做领域逻辑 |

### 2.2 ModelProvider（多模型适配）

```js
// ModelProvider.js — 按配置实例化 LLM
class ModelProvider {
  constructor() {
    this._model = null;
    this._embeddings = null;
  }

  configure(settings) {
    // settings = { provider, model, apiKey, baseUrl, temperature, ... }
    // 按 provider 动态 import 对应 LangChain 集成包
  }

  /** @returns {BaseChatModel} 当前配置的 LLM 实例 */
  chatModel() { return this._model; }

  /** @returns {Embeddings} 当前配置的嵌入模型（RAG 用） */
  embeddings() { return this._embeddings; }
}
```

**支持的 provider**（第一期实现前两个，后续按需扩展）：

| Provider | LangChain 包 | 备注 |
|---|---|---|
| `openai` | `@langchain/openai` | GPT-4o / GPT-4o-mini，嵌入用 `text-embedding-3-small` |
| `anthropic` | `@langchain/anthropic` | Claude Sonnet / Haiku |
| `ollama` | `@langchain/ollama` | 本地部署，无需 API Key，离线可用 |
| `deepseek` | `@langchain/openai`（兼容接口） | DeepSeek-V3，中文占星场景性价比高 |

**API Key 安全**：

- **存储**：`Electron.safeStorage.encryptString(apiKey)` 加密后写入 `app.getPath('userData')/ai-credentials.json`。绝不明文写 config.json。
- **注入**：`Main.js` 启动时解密，通过 `AiService.configure({ apiKey })` 注入 core 层。core 层不碰 Electron API。
- **渲染层**：永远不接触 API Key。设置面板提交后走 IPC `ai:configure`，由 Main 加密存储。

### 2.3 KnowledgeBase（RAG 向量知识库）

**架构**：

```
用户导入文档 (PDF/MD/TXT)
       │
       ▼
  DocumentLoader (LangChain 内置)
       │  PDFLoader / TextLoader / DirectoryLoader
       ▼
  TextSplitter (RecursiveCharacterTextSplitter)
       │  chunk_size=1000, overlap=200
       │  中文占星文本需调参（按段落/章节优先切分）
       ▼
  Embeddings (ModelProvider.embeddings())
       │  text-embedding-3-small / local embedding
       ▼
  VectorStore
       │  第一期：HNSWLib (纯本地，零依赖外部服务)
       │  后续可选：Chroma / Pinecone
       ▼
  持久化到 app.getPath('userData')/knowledge/
```

**内置知识集**（开箱即用，随应用安装）：

```
assets/knowledge/
  builtin/
    planets-in-signs.md       ← 行星落座含义（10 行星 × 12 星座）
    planets-in-houses.md      ← 行星落宫含义（10 行星 × 12 宫）
    aspects-interpretation.md ← 主要相位解读
    house-meanings.md         ← 十二宫位含义
    chart-patterns.md         ← 常见格局（大十字、大三角、风筝等）
    retrograde-guide.md       ← 逆行含义
    transit-guide.md          ← 行运解读指南
    synastry-guide.md         ← 合盘解读指南
    bazi-basics.md            ← 八字基础知识（天干地支、五行生克）
    bazi-interpretation.md    ← 八字解读要点
```

**用户自定义知识**：

- 用户可通过设置面板导入 PDF / Markdown / TXT 文件。
- 导入后自动切分、嵌入、入库。
- 支持查看已导入文档列表、删除单个文档。
- 用户知识存储在 `userData/knowledge/user/`，与内置知识隔离。

**检索策略**：

```js
// 两阶段检索
const retriever = vectorStore.asRetriever({
  k: 6,                    // top-6 相关片段
  searchType: 'similarity', // 余弦相似度
  filter: { source: ... }, // 可按来源过滤
});
```

### 2.4 AstroToolkit（占星计算工具集）

将已有的占星引擎封装为 LangChain Tool，让 LLM 在对话中**按需调用计算引擎**获取精确数据，而非猜测或凭记忆回答。

```js
// AstroToolkit.js — 注册为 LangChain DynamicStructuredTool
const tools = [
  new DynamicStructuredTool({
    name: 'compute_natal_chart',
    description: '计算某人的本命星盘。输入出生时间和地点，返回行星位置、宫位、相位等完整数据。',
    schema: z.object({
      year: z.number(), month: z.number(), day: z.number(),
      hour: z.number(), minute: z.number(),
      latitude: z.number(), longitude: z.number(),
    }),
    func: async (input) => {
      const result = astrologyService.computeChart({
        type: 'natal',
        primary: { name: 'query', birthData: input, ... },
      });
      return ChartSerializer.toText(result);
    },
  }),

  new DynamicStructuredTool({
    name: 'compute_transit',
    description: '计算某人在指定日期的行运盘，分析当前天象对本命盘的影响。',
    schema: z.object({ /* natal data + target date */ }),
    func: async (input) => { /* ... */ },
  }),

  new DynamicStructuredTool({
    name: 'compute_bazi',
    description: '计算某人的八字命盘（四柱：年柱、月柱、日柱、时柱）。',
    schema: z.object({ /* birth data */ }),
    func: async (input) => { /* ... */ },
  }),

  new DynamicStructuredTool({
    name: 'compute_synastry',
    description: '计算两人之间的合盘（比较盘），分析关系相容性。',
    schema: z.object({ /* two people's birth data */ }),
    func: async (input) => { /* ... */ },
  }),
];
```

**关键决策**：

- Tool 返回的是**文本化的 ChartData**（由 `ChartSerializer.toText()` 转换），不是 JSON——LLM 更擅长理解"太阳在白羊座 15°23′ 第七宫（逆行）"而非 `{"key":"sun","longitude":15.38,...}`。
- **不把全部 20 种星盘类型都注册为 Tool**——第一期注册最常用的 5 种（natal / transit / synastry / solar return / bazi），避免 Tool 列表过长影响 LLM 选择准确度。后续按用户反馈扩展。
- Tool 内部直接调用已有的 `AstrologyService` / `ChineseAstrologyService`，**零重复实现**。

### 2.5 ChainFactory（链/Agent 构建）

两种主要 chain：

**1. Interpret Chain（自动解读）**

用户点击"AI 解读"后，系统拿着已计算好的 ChartData 生成解读报告。**不需要 Tool Calling**——数据已有，只需 RAG + prompt。

```
ChartData DTO
     │
     ▼ ChartSerializer.toText()
     │
     ▼ InterpretPrompt.build(chartText, chartType)
     │  系统 prompt: 你是专业占星师...
     │  + RAG 检索到的相关知识片段
     │  + 结构化星盘数据文本
     ▼
  LLM.stream()
     │
     ▼ 流式输出解读报告
```

**2. Chat Chain（交互问答 — ReAct Agent）**

用户提问后，LLM 自主决定是否需要调用计算工具获取数据，再结合知识库回答。**需要 Tool Calling + RAG**。

```
用户消息 + 对话历史
     │
     ▼ ChatPrompt.build(history, currentChart?)
     │  系统 prompt: 你是占星助手...
     │  + 当前打开的星盘上下文（如有）
     ▼
  AgentExecutor (ReAct 循环)
     │  LLM 决定：直接回答 or 调用 Tool
     │
     ├─► 调用 compute_natal_chart → 拿到数据 → 继续推理
     ├─► 调用 RAG retriever → 拿到知识片段 → 继续推理
     └─► 生成最终回答 → 流式输出
```

**对话历史管理**：

- 使用 LangChain 的 `BufferWindowMemory`（保留最近 20 轮对话）。
- 历史存在内存中，不持久化（隐私考量——用户星盘数据不应落盘到对话日志）。
- 切换档案或关闭应用时清空历史。

### 2.6 ChartSerializer（ChartData → LLM 文本）

将 ChartData DTO 转为 LLM 友好的结构化自然语言。这是**AI 层的核心适配器**——它决定了 LLM "看到"什么样的占星数据。

```js
// ChartSerializer.toText(chartData) 输出示例：

// 【本命星盘】张三 · 1990-01-15 14:30 北京
//
// ── 行星位置 ──
// ☉ 太阳　摩羯座 24°32′  第4宫
// ☽ 月亮　天秤座 08°17′  第1宫  (逆行)
// ☿ 水星　水瓶座 02°45′  第5宫
// ...
//
// ── 四轴 ──
// 上升: 天秤座 03°12′
// 天顶: 巨蟹座 05°28′
//
// ── 宫位 (Placidus) ──
// 第1宫: 天秤座 03°12′
// 第2宫: 天蝎座 01°45′
// ...
//
// ── 主要相位 ──
// ☉太阳 □四分 ☽月亮 (容许度 3.2°)
// ♀金星 △三分 ♃木星 (容许度 1.8°)
// ...
//
// ── 元素分布 ──
// 火:2  土:4  风:3  水:2
//
// ── 模式分布 ──
// 基本:3  固定:4  变动:4
```

**设计要点**：

- 用中文 + 占星符号（glyph），LLM 理解度最高。
- 包含度分秒精度——LLM 需要这个粒度来判断相位紧密度。
- 相位列出容许度，让 LLM 能评估相位强度。
- 元素/模式分布直接给出，减少 LLM 计算负担。

---

## 3. Prompt 工程

### 3.1 系统 Prompt 设计原则

- **角色设定**：资深占星师 + 命理师，精通西方占星与中式命理。
- **语言**：默认中文，跟随用户语言。
- **风格**：专业但易懂，避免过度宿命论，强调"星象是能量趋势而非命定"。
- **引用**：必须标注知识来源（"根据《xxx》..."），让用户可验证。
- **安全边界**：不做医疗/法律/投资建议，遇到此类问题明确声明。

### 3.2 Interpret Prompt 模板

```
你是一位专业的占星分析师，精通西方占星学与中式命理学。

你的任务是对以下星盘数据进行全面、专业的解读。

## 解读要求
1. **综合分析**：先给出整体性格画像（太阳/月亮/上升三位一体），再展开各行星的落座落宫含义。
2. **相位解读**：重点分析主要相位（合相、对分、三分、四分），说明行星间的能量互动。
3. **格局识别**：识别大十字、大三角、T 三角、风筝等特殊格局（如有）。
4. **宫位重点**：分析行星密集的宫位（stellium）及空宫的含义。
5. **逆行分析**：对逆行行星给出专门解读。
6. **实用建议**：基于星盘特征给出性格发展建议和生活方向提示。

## 知识参考
{rag_context}

## 星盘数据
{chart_text}

## 输出格式
使用清晰的层级标题，每个分析维度一个小节。分析应当深入但易懂，
避免过度使用专业术语，必要时加以解释。
```

### 3.3 Chat Prompt 模板

```
你是 Myst 占星工作站的 AI 助手。你精通西方占星学和中式命理学。

## 你的能力
- 解读用户的星盘数据（行星位置、相位、宫位等）
- 分析行运（transit）对本命盘的影响
- 解答占星学理论问题
- 提供中式八字命理分析
- 比较两人的合盘关系

## 你可以使用的工具
你有权调用计算引擎来获取精确的占星数据。当用户提供出生信息时，
请调用相应工具计算星盘，而不是凭记忆猜测行星位置。

## 当前上下文
{current_chart_context}

## 重要原则
- 始终基于精确计算的星盘数据分析，不要编造行星位置
- 引用知识库内容时标注来源
- 星象是能量趋势的描述，不是命运的判决。避免绝对化表述
- 不提供医疗、法律或投资建议。遇到相关问题时明确声明边界
- 保持开放和尊重的态度对待不同占星学派的观点
```

---

## 4. IPC 通道与流式传输

### 4.1 新增 IPC 通道

| 通道 | 方向 | 用途 |
|---|---|---|
| `ai:interpret` | invoke（request-response 启动，push 流式 token） | 自动解读星盘 |
| `ai:chat` | invoke（启动，push 流式 token） | 用户问答 |
| `ai:stop` | invoke | 中断当前 LLM 生成 |
| `ai:configure` | invoke | 更新 AI 设置（模型/Key） |
| `ai:status` | invoke | 查询 AI 服务状态 |
| `ai:knowledge:list` | invoke | 列出已导入的知识文档 |
| `ai:knowledge:import` | invoke | 导入新文档 |
| `ai:knowledge:remove` | invoke | 移除知识文档 |
| `ai:token` | push (main→renderer) | 流式推送 LLM 输出 token |
| `ai:tool-call` | push (main→renderer) | 通知渲染层"正在调用工具" |
| `ai:done` | push (main→renderer) | 生成结束信号 |
| `ai:error` | push (main→renderer) | 错误信号 |

### 4.2 流式传输机制

LLM 回答需要流式推送（逐 token），不能用 `ipcMain.handle` 的 request-response 模式（它只能返回一次）。设计方案：

```
Renderer                    Main
   │                          │
   │──── ai:chat (invoke) ───►│ 启动 chain，返回 sessionId
   │◄─── { ok, sessionId } ──│
   │                          │
   │◄──── ai:token (push) ───│ "根"
   │◄──── ai:token (push) ───│ "据"
   │◄──── ai:token (push) ───│ "星盘"
   │◄── ai:tool-call (push) ─│ { tool: 'compute_transit', status: 'calling' }
   │◄── ai:tool-call (push) ─│ { tool: 'compute_transit', status: 'done' }
   │◄──── ai:token (push) ───│ "分析"
   │◄──── ai:done (push) ────│ { sessionId, usage }
   │                          │
   │── ai:stop (invoke) ─────►│ （用户中断）
```

- **invoke 启动**：渲染层调 `ai:chat` / `ai:interpret`，Main 返回 `{ sessionId }` 后立即开始流式生成。
- **push 传输**：Main 通过 `mainWindow.webContents.send('ai:token', { sessionId, token })` 推送。
- **Preload 桥接**：Preload 注册 `ipcRenderer.on('ai:token', callback)` 并通过 `contextBridge` 暴露为 `mystApi.ai.onToken(callback)`。
- **中断**：用户点"停止"时调 `ai:stop`，Main 调用 `AbortController.abort()` 终止 LangChain stream。

### 4.3 Preload 扩展

```js
// Preload.js 新增
contextBridge.exposeInMainWorld('mystApi', {
  // ... 已有 ...

  ai: {
    interpret: (chartData, options) => invoke('ai:interpret', chartData, options),
    chat: (messages, context) => invoke('ai:chat', messages, context),
    stop: (sessionId) => invoke('ai:stop', sessionId),
    configure: (settings) => invoke('ai:configure', settings),
    status: () => invoke('ai:status'),

    // 流式事件监听
    onToken: (callback) => ipcRenderer.on('ai:token', (_e, data) => callback(data)),
    onToolCall: (callback) => ipcRenderer.on('ai:tool-call', (_e, data) => callback(data)),
    onDone: (callback) => ipcRenderer.on('ai:done', (_e, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('ai:error', (_e, data) => callback(data)),
    removeAllListeners: () => {
      for (const ch of ['ai:token', 'ai:tool-call', 'ai:done', 'ai:error']) {
        ipcRenderer.removeAllListeners(ch);
      }
    },

    // 知识库管理
    knowledge: {
      list: () => invoke('ai:knowledge:list'),
      import: (filePaths) => invoke('ai:knowledge:import', filePaths),
      remove: (docId) => invoke('ai:knowledge:remove', docId),
    },
  },
});
```

---

## 5. config 配置项

### 5.1 config.json 新增段

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.7,
    "maxTokens": 4096,
    "enableRag": true,
    "ragTopK": 6
  }
}
```

- **`provider`**：`"openai"` | `"anthropic"` | `"ollama"` | `"deepseek"`。
- **`model`**：模型 ID，按 provider 不同取值（如 `"gpt-4o"` / `"claude-sonnet-4-6"` / `"qwen2.5:7b"`）。
- **`temperature`**：0-1，占星解读建议 0.7（有创造性但不过于发散）。
- **`maxTokens`**：单次最大生成长度。
- **`enableRag`**：是否启用知识库增强。关闭后纯靠 LLM 训练知识。
- **`ragTopK`**：RAG 检索返回的 top-K 文档片段数。

**不在 config.json 中的设置**（安全原因）：

- `apiKey`：加密存储在 `userData/ai-credentials.json`。
- `baseUrl`（自定义 API 端点）：同上。

### 5.2 TokenEngine 透传

```js
// TokenEngine.resolve()
ai: raw.ai || { provider: 'openai', model: 'gpt-4o', temperature: 0.7, maxTokens: 4096, enableRag: true, ragTopK: 6 },
```

---

## 6. 渲染层 UI 设计

### 6.1 ChatPanelView（AI 对话面板）

在主界面右侧新增可折叠的 AI 面板（与星盘查看区域并排）：

```
┌─── ChartWorkbench ───────────────┬─── AI Panel ────────────────┐
│                                   │  ┌──────────────────────┐   │
│   [星盘 SVG 轮盘]                 │  │ 对话历史              │   │
│                                   │  │                      │   │
│   [数据表格]                      │  │  用户: 我的金星合海王  │   │
│                                   │  │  意味着什么？          │   │
│                                   │  │                      │   │
│                                   │  │  AI: 金星与海王星的   │   │
│                                   │  │  合相是一个充满浪漫   │   │
│                                   │  │  与理想化色彩的相位..│   │
│                                   │  │  ▌ (流式打字效果)     │   │
│                                   │  └──────────────────────┘   │
│                                   │  ┌──────────────────────┐   │
│                                   │  │ [输入框]     [发送]   │   │
│                                   │  └──────────────────────┘   │
│                                   │  [AI解读] [停止]            │
└───────────────────────────────────┴─────────────────────────────┘
```

**交互要素**：

- **"AI 解读"按钮**：一键对当前星盘生成全面解读。
- **输入框**：自由提问，支持 Enter 发送。
- **流式打字效果**：LLM token 逐个出现，带闪烁光标。
- **工具调用指示**：LLM 调用计算工具时显示"正在计算行运盘..."等提示。
- **停止按钮**：生成中可中断。
- **知识来源折叠**：引用的知识片段可展开查看原文。

### 6.2 AI 设置面板

在设置中新增 AI 配置区域：

- **模型选择**：下拉选 provider + model。
- **API Key 输入**：密码框，提交后加密存储，显示"已配置 ✓"。
- **Ollama 配置**：自定义 baseUrl（默认 `http://localhost:11434`）。
- **知识库管理**：已导入文档列表 + 导入按钮 + 删除按钮。
- **高级选项**：temperature / maxTokens / ragTopK 滑块。

---

## 7. 数据流总览

### 7.1 自动解读流程

```
用户点击"AI 解读"
       │
       ▼ 渲染层已有 chartData（之前 chart:compute 返回的）
       │
       ▼ ApiClient.ai.interpret(chartData, { chartType })
       │
       ▼ IPC → IpcRouter → AiService.interpret()
       │
       ├── ChartSerializer.toText(chartData) → chartText
       ├── KnowledgeBase.retrieve(chartText) → ragDocs
       ├── InterpretPrompt.build(chartText, ragDocs, chartType)
       └── ModelProvider.chatModel().stream(prompt)
              │
              ▼ 逐 token 推送 → ai:token → Preload → 渲染层
              │
              ▼ 完成 → ai:done
```

### 7.2 用户问答流程（含 Tool Calling）

```
用户输入: "帮我看看 2025 年的行运"
       │
       ▼ ApiClient.ai.chat([{ role:'user', content:'...' }], { currentChart })
       │
       ▼ IPC → IpcRouter → AiService.chat()
       │
       ├── ChatPrompt.build(history, currentChart?)
       └── AgentExecutor.stream()
              │
              ▼ LLM 判断需要计算行运盘
              │  → 调用 compute_transit tool
              │  → ai:tool-call 推送到渲染层("正在计算行运盘...")
              │  → AstrologyService.computeChart({ type:'transit', ... })
              │  → ChartSerializer.toText(result) 返回给 LLM
              │
              ▼ LLM 拿到行运数据 + RAG 知识
              │  → 生成综合分析
              │  → 逐 token 推送
              │
              ▼ 完成 → ai:done
```

---

## 8. 依赖清单

### 8.1 新增 npm 依赖

| 包 | 用途 | 大致体积 |
|---|---|---|
| `langchain` | 核心框架（chain / agent / memory） | ~2MB |
| `@langchain/core` | 基础抽象（BaseMessage / BaseChatModel） | ~1MB |
| `@langchain/openai` | OpenAI / DeepSeek 集成 | ~500KB |
| `@langchain/anthropic` | Claude 集成 | ~300KB |
| `@langchain/ollama` | Ollama 本地模型集成 | ~200KB |
| `@langchain/community` | HNSWLib 向量存储等社区集成 | ~1MB |
| `hnswlib-node` | 本地向量索引（高性能近似最近邻） | ~5MB (native) |
| `pdf-parse` | PDF 文档加载 | ~300KB |
| `zod` | Tool schema 定义（LangChain Tool Calling 依赖） | ~60KB |

### 8.2 不引入的依赖（明确排除）

- ❌ `chromadb` / `pinecone`：外部向量数据库，不符合"纯桌面应用"定位。
- ❌ `@langchain/community/vectorstores/faiss`：FAISS 编译复杂，HNSWLib 在本地场景足够。
- ❌ `openai`（直接 SDK）：通过 LangChain 抽象层使用，不直接依赖。

---

## 9. 安全与隐私

| 关切 | 措施 |
|---|---|
| API Key 泄露 | `safeStorage` 加密存储；渲染层永远不接触密钥 |
| 用户数据外传 | 星盘数据仅在 LLM API 调用时发送（用户明确触发）；本地 Ollama 模式零外传 |
| 对话记录隐私 | 对话历史仅在内存中，不持久化，关闭应用即清除 |
| 知识库数据 | 用户导入的文档存在本地 `userData/`，不上传任何服务 |
| 渲染层沙箱 | AI IPC 通道遵循现有安全模型（contextIsolation + preload 桥接） |

---

## 10. 不在本次范围内（明确排除）

- ❌ 多人协作 / 云端同步
- ❌ 语音输入/输出
- ❌ 图片识别（如识别手写星盘）
- ❌ 自动生成星盘图片并嵌入对话
- ❌ 付费/订阅系统
- ❌ Fine-tuning 模型
- ❌ 多语言 UI（目前仅中文 + 英文 label）
