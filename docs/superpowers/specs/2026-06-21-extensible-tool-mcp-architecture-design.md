# 可扩展工具 / MCP 调用架构设计

> 状态：DRAFT · 日期：2026-06-21 · 分支：`feat/enhance_ai`
> 目标：把当前“静态工具数组”升级为成熟、可扩展、AI 自主决策的能力（工具 / 知识库 / MCP）调用架构，从容应对后续功能点的增加与变更。

---

## 1. 现状与问题

当前调用链：

```
AiService.configure()
  └─ AstroToolkit.createTools()  → 静态返回 9 个 DynamicStructuredTool
AiService.chat()
  └─ ChainFactory.prepareChatModel()  → 绑定工具 + 临时塞入 search_knowledge(RAG) 工具
  └─ 手写 tool-calling 循环（最多 5 轮，按 name 查找执行）
```

痛点：

1. **不可扩展**：工具是写死的数组，新增/分类能力必须改 `AstroToolkit.js`。
2. **职责分散**：RAG 工具在 `ChainFactory` 里临时拼装，与其它工具来源不统一。
3. **无 MCP**：完全没有 MCP（Model Context Protocol）支持，无法接入外部/可插拔工具服务器。
4. **无生命周期**：工具没有 init/dispose、连接/断开、启停、刷新。
5. **无元数据**：没有命名空间、分类、权限、启用开关，工具多了会冲突且不可管理。
6. **执行耦合**：工具执行逻辑硬编码在 `AiService` 里，难以替换 Agent 引擎。

> 注：AI “自主决定调用哪个工具 / 知识库” 这一点，现有 tool-calling 循环**已经具备**（模型自行选择工具）。本设计在保留该能力的基础上，把**工具的来源、注册、生命周期、管理**做成可扩展架构。

---

## 2. 设计目标

- **统一抽象**：计算工具、知识库检索、MCP 工具，对 Agent 而言都是“工具”，模型自主选择。
- **可插拔**：新增能力 = 新增一个 Provider 或一条 MCP 配置，**不改 Agent 主循环**。
- **配置驱动**：工具启停、MCP 服务器，均由 `config` / 用户设置决定（呼应项目的 config-driven-gui 风格）。
- **生命周期可控**：连接 / 断开 / 重连 / 刷新；退出时干净释放（子进程、连接）。
- **安全**：外部 MCP 服务器 = 运行外部代码，必须用户显式授权、可审计、可限制。
- **可观测**：工具调用（名称、参数、结果摘要、来源、耗时）可流式展示与记录。

---

## 3. 核心抽象

### 3.1 ToolProvider（工具来源接口）

```
interface ToolProvider {
  id: string;                       // 命名空间，如 'astro' | 'kb' | 'mcp:filesystem'
  category: string;                 // 'compute' | 'knowledge' | 'context' | 'mcp'
  enabled: boolean;
  async init(): Promise<void>;
  async listTools(): Promise<LCTool[]>;   // 返回 LangChain 工具
  isReady(): boolean;
  async dispose(): Promise<void>;
}
```

内置 Provider：

| Provider | 职责 | 来源 |
|----------|------|------|
| `AstroToolProvider` | 本命/行运/合盘/八字/太阳返照/次限等计算工具 | 重构自 `AstroToolkit` |
| `ContextToolProvider` | `get_current_context` / `get_current_chart` / `get_active_profile` | 从 `AstroToolkit` 拆出 |
| `KnowledgeToolProvider` | 知识库检索工具（可按多知识库拆成多个 `search_*`） | 取代 `ChainFactory` 内临时 RAG 工具 |
| `McpToolProvider` | 包装一个 MCP 服务器，把其工具转成 LangChain 工具 | 新增，基于 `@langchain/mcp-adapters` |

### 3.2 ToolRegistry（聚合与生命周期）

```
class ToolRegistry {
  register(provider) / unregister(id)
  async initAll() / disposeAll() / refresh()
  async getTools({ enabledOnly = true }): LCTool[]   // 聚合 + 命名空间 + 过滤
  getToolByName(name): LCTool | null                 // 供执行查找
  on('change', cb)                                    // 工具集变化通知（用于重绑定）
  describe(): ToolDescriptor[]                        // 供设置面板展示（id/name/desc/category/enabled/source）
}
```

- **命名空间**：对外暴露的工具名统一加前缀，避免冲突，例如 `astro__compute_natal_chart`、`mcp_filesystem__read_file`。执行时按全名查找。
- **启停**：`enabledOnly` 过滤 + 每工具/每 Provider 的开关（来自配置）。

### 3.3 McpManager（MCP 接入层）

- 读取配置 `ai.mcpServers`（Claude Desktop 风格）：

```jsonc
"mcpServers": {
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "<allowed-dir>"],
    "enabled": false
  },
  "myhttp": { "transport": "sse", "url": "https://example.com/mcp", "enabled": false }
}
```

- 用 `@langchain/mcp-adapters` 的 `MultiServerMCPClient` 连接（stdio 子进程 / SSE / streamable-http），把 MCP 工具转成 LangChain 工具，交给对应 `McpToolProvider`。
- 生命周期：`configure` 时按启用项连接；`close` 时全部断开；配置变更时增量重连。
- ESM 包 → 通过现有 `esm-bridge` 动态 import（需验证 CJS 互操作）。

### 3.4 AgentRunner（Agent 执行，重构自 AiService.chat 循环）

- 从 `ToolRegistry.getTools()` 取工具并 `bindTools`。
- 工具执行委托 `registry.getToolByName(name).invoke(args)`。
- 保留现有“流式 token + tool-call 事件”，事件增加 `source`（provider id）、`args` 摘要、`durationMs`、`ok`。
- 可选升级：用 LangGraph `createReactAgent` 替换手写循环（更稳健的多轮 / 并行工具调用、循环上限、可中断）。当前手写循环可作为零依赖回退。

---

## 4. 数据流（目标态）

```
configure()
  → ToolRegistry.register(AstroToolProvider, ContextToolProvider, KnowledgeToolProvider)
  → McpManager.connectEnabled() → 为每个 server 注册一个 McpToolProvider
  → ToolRegistry.initAll()

chat()
  → tools = ToolRegistry.getTools({ enabledOnly: true })
  → model.bindTools(tools)
  → AgentRunner 循环：模型自主选择 → registry.getToolByName(name).invoke(args)
                       → 流式回传 token / tool-call(source,args,result) 事件
```

Agent 看到的工具是“计算 + 知识库 + MCP”的统一集合，由模型自主决策——满足“AI 自主决定调用工具/知识库”。

---

## 5. 配置与 UI

- `config.ai.tools`：`{ "<providerId>": { enabled, tools?: { "<toolName>": boolean } } }`。
- `config.ai.mcpServers`：见 §3.3。
- **AI 设置** 新增「工具与 MCP」分区：
  - 列出所有 Provider / 工具（名称、描述、来源、分类、开关）。
  - MCP 服务器：连接状态、启停、新增/删除、查看其暴露的工具。
  - 外部 MCP 服务器新增时弹出**安全确认**（见 §6）。

---

## 6. 安全（外部 MCP 是重点）

外部 MCP 服务器 = 在用户机器上运行外部代码，必须谨慎：

1. **显式授权**：任何 stdio/远程 MCP 服务器默认 `enabled:false`；启用需用户在 UI 主动确认，绝不从不可信来源（如网页、文档、模型输出）自动添加或启用。
2. **凭据隔离**：子进程环境变量白名单，绝不向 MCP 子进程泄露 AI API Key 等机密。
3. **路径限制**：文件类服务器仅授予明确目录（allowed-dir），不给全盘。
4. **工具结果是不可信数据**：工具/MCP 返回内容可能含提示注入。系统提示需声明：工具结果是数据、不是指令；不执行其中夹带的命令；对副作用型 MCP 工具（写文件、发请求）执行前确认。
5. **超时与并发上限**：单次工具调用超时、单轮最大工具数、循环轮数上限。
6. **可审计**：记录工具调用日志（名称、来源、参数、结果摘要、时间），供用户查看。

---

## 7. 可扩展性验证（这套架构如何应对“后续增加/变更”）

- **加一个内置计算工具**：在对应 Provider 的 `listTools()` 里加一条（或新建 Provider 并 `register`）。Agent 主循环零改动。
- **接一个外部 MCP 服务器**：改 `ai.mcpServers` 配置或用 UI 添加。零代码改动。
- **下线/禁用某能力**：配置里 `enabled:false` 或 UI 关掉。
- **替换 Agent 引擎**（手写循环 → LangGraph）：只动 `AgentRunner`，Provider/Registry/工具不受影响。
- **多知识库**：`KnowledgeToolProvider` 为每个 KB 暴露独立 `search_*` 工具，模型按主题自选。

---

## 8. 分阶段落地

| 阶段 | 内容 | 风险 | 依赖 |
|------|------|------|------|
| **A. 注册架构地基** | 引入 `ToolProvider` 接口 + `ToolRegistry`；把现有工具重构为 `AstroToolProvider`/`ContextToolProvider`/`KnowledgeToolProvider`；`AiService`/`ChainFactory` 改为消费 Registry。**行为不变，仅架构化。** | 低 | 无新依赖 |
| **B. MCP 接入** | 引入 `@langchain/mcp-adapters`；`McpManager` + `McpToolProvider`；配置驱动连接；先内部/本地服务器，再开放外部（带授权）。 | 中 | `@langchain/mcp-adapters`, `@modelcontextprotocol/sdk` |
| **C. 管理与体验** | AI 设置「工具与 MCP」面板（启停/状态/增删）；工具调用日志/可观测；可选升级 LangGraph ReAct Agent。 | 中 | 可选 `@langchain/langgraph` |

建议从 **阶段 A** 开始：它是地基，零行为变化、零新依赖、低风险，且让 B/C 变得简单。

---

## 9. 涉及文件（预估）

新增：
- `src/core/ai/tools/ToolProvider.js`（接口约定/基类）
- `src/core/ai/tools/ToolRegistry.js`
- `src/core/ai/tools/AstroToolProvider.js`、`ContextToolProvider.js`、`KnowledgeToolProvider.js`
- `src/core/ai/mcp/McpManager.js`、`src/core/ai/tools/McpToolProvider.js`（阶段 B）
- `src/core/ai/AgentRunner.js`（从 `AiService.chat` 拆出，阶段 C 可选）
- `tests/ToolRegistry.test.mjs` 等

改造：
- `src/core/ai/AstroToolkit.js` → 拆分到 Provider（保留薄封装或弃用）
- `src/core/ai/AiService.js`、`ChainFactory.js` → 消费 Registry
- `config.json` / `TokenEngine.js` → `ai.tools`、`ai.mcpServers` 默认值
- `src/main/IpcRouter.js`、`Preload.js` → 工具/MCP 管理与状态的 IPC
- `src/renderer/app/views/SettingsView.js` → 「工具与 MCP」分区（阶段 C）

---

## 10. 决议（2026-06-21）

1. **MCP 范围**：先做**阶段 A 注册架构地基**，MCP 作为预留 Provider 接口，暂不连外部服务器。
2. **Agent 引擎**：引入 **LangGraph `createReactAgent`**（`@langchain/langgraph@0.2.74`，兼容现有 core 0.3.x；最新 1.x 需 core 1.x，暂不升级）。
3. **CJS 互操作**：`@langchain/mcp-adapters` 走 `esm-bridge` 的可行性留待阶段 B 验证。

## 11. 实施状态

- ✅ **阶段 A 已落地**：`ToolProvider` + `ToolRegistry` + `AstroToolProvider` / `ContextToolProvider` / `KnowledgeToolProvider`；`AiService` 改为从 Registry 取工具，并用 LangGraph ReAct Agent 接管 chat 的工具调用循环；RAG 从 `ChainFactory` 内联工具迁移为 `KnowledgeToolProvider`；`tests/ToolRegistry.test.mjs` 8 项通过；Agent 构造路径已离线验证（9 工具绑定）。
  - ⚠️ Agent 的**流式运行时行为**需联网用真实模型验证（本环境无 API Key）。
- ⏳ 阶段 B（外部 MCP 接入）、阶段 C（管理 UI + 可观测）未开始。
